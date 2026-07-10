import { generateScript } from "./lib/groq.js";
import { textToVideo } from "./lib/replicate.js";
import { textToSpeech } from "./lib/elevenlabs.js";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function generateAssets(jobId, env) {
  const job = await env.DB.prepare("SELECT * FROM job_demands WHERE id = ?").bind(jobId).first();
  if (!job || !job.script_json) return;
  const script = JSON.parse(job.script_json);
  const assets = [];

  try {
    for (const scene of script.scenes) {
      const videoUrl = await textToVideo(env, {
        prompt: scene.visual_description,
        aspectRatio: job.aspect_ratio,
        durationSeconds: scene.duration_seconds,
      });

      let audioKey = null;
      if (scene.voiceover_line) {
        const audioBuffer = await textToSpeech(env, scene.voiceover_line);
        audioKey = `jobs/${jobId}/scene-${scene.scene_number}.mp3`;
        await env.MEDIA.put(audioKey, audioBuffer, {
          httpMetadata: { contentType: "audio/mpeg" },
        });
      }

      assets.push({
        scene_number: scene.scene_number,
        video_url: videoUrl,
        audio_key: audioKey,
        on_screen_text: scene.on_screen_text,
        duration_seconds: scene.duration_seconds,
      });
    }

    await env.DB.prepare(
      "UPDATE job_demands SET assets_json = ?, status = 'assets_ready', render_error = NULL, updated_at = datetime('now') WHERE id = ?"
    )
      .bind(JSON.stringify(assets), jobId)
      .run();
  } catch (err) {
    await env.DB.prepare(
      "UPDATE job_demands SET status = 'failed', render_error = ?, updated_at = datetime('now') WHERE id = ?"
    )
      .bind(err.message, jobId)
      .run();
  }
}

async function renderVideo(jobId, env) {
  const job = await env.DB.prepare("SELECT * FROM job_demands WHERE id = ?").bind(jobId).first();
  if (!job || !job.assets_json) return;
  const assets = JSON.parse(job.assets_json);

  const payload = {
    jobId: Number(jobId),
    aspectRatio: job.aspect_ratio,
    callbackUrl: `${env.PUBLIC_BASE_URL}/api/internal/jobs/${jobId}/render-complete`,
    scenes: assets.map((a) => ({
      sceneNumber: a.scene_number,
      videoUrl: a.video_url,
      onScreenText: a.on_screen_text,
      audioUrl: a.audio_key ? `${env.PUBLIC_BASE_URL}/media/${a.audio_key}` : null,
      durationSeconds: a.duration_seconds,
    })),
  };

  try {
    const resp = await fetch(`${env.RENDER_SERVICE_URL}/render`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-render-token": env.RENDER_SERVICE_TOKEN,
      },
      body: JSON.stringify(payload),
    });
    if (!resp.ok) {
      throw new Error(`Render service error ${resp.status}: ${await resp.text()}`);
    }
  } catch (err) {
    await env.DB.prepare(
      "UPDATE job_demands SET status = 'failed', render_error = ?, updated_at = datetime('now') WHERE id = ?"
    )
      .bind(err.message, jobId)
      .run();
  }
}

async function handleMedia(request, env, url) {
  const key = decodeURIComponent(url.pathname.slice("/media/".length));
  const obj = await env.MEDIA.get(key);
  if (!obj) return new Response("Not found", { status: 404 });

  return new Response(obj.body, {
    headers: {
      "content-type": obj.httpMetadata?.contentType || "application/octet-stream",
      "cache-control": "public, max-age=31536000",
    },
  });
}

async function handleApi(request, env, ctx, url) {
  const parts = url.pathname.split("/").filter(Boolean); // ["api", "jobs", ":id", ...] or ["api", "internal", "jobs", ":id", ...]

  // POST /api/jobs
  if (request.method === "POST" && parts.length === 2 && parts[1] === "jobs") {
    const body = await request.json();
    const required = ["category", "client_name", "role"];
    for (const field of required) {
      if (!body[field]) return json({ error: `Missing field: ${field}` }, 400);
    }
    if (body.aspect_ratio && !["16:9", "9:16"].includes(body.aspect_ratio)) {
      return json({ error: "aspect_ratio must be 16:9 or 9:16" }, 400);
    }

    const result = await env.DB.prepare(
      `INSERT INTO job_demands
        (category, client_name, role, salary, contract_length, location, benefits, requirements, application_deadline, extra_notes, aspect_ratio, duration_target)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        body.category,
        body.client_name,
        body.role,
        body.salary || null,
        body.contract_length || null,
        body.location || null,
        body.benefits || null,
        body.requirements || null,
        body.application_deadline || null,
        body.extra_notes || null,
        body.aspect_ratio || "16:9",
        Number(body.duration_target) || 50
      )
      .run();

    return json({ id: result.meta.last_row_id }, 201);
  }

  // GET /api/jobs
  if (request.method === "GET" && parts.length === 2 && parts[1] === "jobs") {
    const { results } = await env.DB.prepare(
      "SELECT * FROM job_demands ORDER BY created_at DESC"
    ).all();
    return json(results);
  }

  // GET /api/jobs/:id
  if (request.method === "GET" && parts.length === 3 && parts[1] === "jobs") {
    const id = parts[2];
    const row = await env.DB.prepare("SELECT * FROM job_demands WHERE id = ?")
      .bind(id)
      .first();
    if (!row) return json({ error: "Not found" }, 404);
    return json(row);
  }

  // POST /api/jobs/:id/generate-script
  if (
    request.method === "POST" &&
    parts.length === 4 &&
    parts[1] === "jobs" &&
    parts[3] === "generate-script"
  ) {
    const id = parts[2];
    const job = await env.DB.prepare("SELECT * FROM job_demands WHERE id = ?")
      .bind(id)
      .first();
    if (!job) return json({ error: "Not found" }, 404);

    try {
      const script = await generateScript(job, env);
      await env.DB.prepare(
        "UPDATE job_demands SET script_json = ?, status = 'script_ready', updated_at = datetime('now') WHERE id = ?"
      )
        .bind(JSON.stringify(script), id)
        .run();
      return json({ id: Number(id), script });
    } catch (err) {
      return json({ error: err.message }, 502);
    }
  }

  // POST /api/jobs/:id/generate-assets
  if (
    request.method === "POST" &&
    parts.length === 4 &&
    parts[1] === "jobs" &&
    parts[3] === "generate-assets"
  ) {
    const id = parts[2];
    const job = await env.DB.prepare("SELECT * FROM job_demands WHERE id = ?")
      .bind(id)
      .first();
    if (!job) return json({ error: "Not found" }, 404);
    if (!job.script_json) return json({ error: "Generate the script first" }, 400);

    await env.DB.prepare(
      "UPDATE job_demands SET status = 'generating_assets', render_error = NULL, updated_at = datetime('now') WHERE id = ?"
    )
      .bind(id)
      .run();
    ctx.waitUntil(generateAssets(id, env));
    return json({ id: Number(id), status: "generating_assets" });
  }

  // POST /api/jobs/:id/render
  if (
    request.method === "POST" &&
    parts.length === 4 &&
    parts[1] === "jobs" &&
    parts[3] === "render"
  ) {
    const id = parts[2];
    const job = await env.DB.prepare("SELECT * FROM job_demands WHERE id = ?")
      .bind(id)
      .first();
    if (!job) return json({ error: "Not found" }, 404);
    if (!job.assets_json) return json({ error: "Generate assets first" }, 400);

    await env.DB.prepare(
      "UPDATE job_demands SET status = 'rendering', render_error = NULL, updated_at = datetime('now') WHERE id = ?"
    )
      .bind(id)
      .run();
    ctx.waitUntil(renderVideo(id, env));
    return json({ id: Number(id), status: "rendering" });
  }

  // POST /api/internal/jobs/:id/render-complete (called by the Fly render service)
  if (
    request.method === "POST" &&
    parts.length === 5 &&
    parts[1] === "internal" &&
    parts[2] === "jobs" &&
    parts[4] === "render-complete"
  ) {
    if (request.headers.get("x-render-token") !== env.RENDER_SERVICE_TOKEN) {
      return json({ error: "Unauthorized" }, 401);
    }

    const id = parts[3];
    const body = await request.json();

    if (body.error) {
      await env.DB.prepare(
        "UPDATE job_demands SET status = 'failed', render_error = ?, updated_at = datetime('now') WHERE id = ?"
      )
        .bind(body.error, id)
        .run();
      return json({ ok: true });
    }

    const videoUrl = `${env.PUBLIC_BASE_URL}/media/${body.videoKey}`;
    await env.DB.prepare(
      "UPDATE job_demands SET status = 'ready', video_url = ?, render_error = NULL, updated_at = datetime('now') WHERE id = ?"
    )
      .bind(videoUrl, id)
      .run();
    return json({ ok: true });
  }

  return json({ error: "Not found" }, 404);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/media/")) {
      return handleMedia(request, env, url);
    }
    if (url.pathname.startsWith("/api/")) {
      return handleApi(request, env, ctx, url);
    }
    return env.ASSETS.fetch(request);
  },
};
