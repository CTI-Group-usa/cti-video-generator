const CLAUDE_MODEL = "claude-sonnet-5";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function scriptPrompt(job) {
  return `You are writing the storyboard script for a short (30-45 second) cinematic recruitment marketing video. The video will be assembled from template scenes, so every number and name you output MUST exactly match the source data below - do not invent, round, or omit any of it.

Source data:
- Category: ${job.category}
- Client / property / cruise line name: ${job.client_name}
- Role: ${job.role}
- Salary: ${job.salary || "not specified"}
- Contract length: ${job.contract_length || "not specified"}
- Location: ${job.location || "not specified"}
- Benefits: ${job.benefits || "not specified"}
- Requirements: ${job.requirements || "not specified"}
- Application deadline: ${job.application_deadline || "not specified"}
- Extra notes: ${job.extra_notes || "none"}

Respond with ONLY valid JSON (no markdown fences, no commentary) matching this shape:
{
  "headline": "short punchy on-screen title",
  "cta": "final call-to-action line",
  "scenes": [
    {
      "scene_number": 1,
      "visual_description": "what the background footage should show (for picking a stock/template clip)",
      "on_screen_text": "exact text overlay for this scene, or empty string",
      "voiceover_line": "narration line for this scene, or empty string",
      "duration_seconds": 5
    }
  ]
}

Aim for 5-8 scenes. Make sure the role, client name, salary, contract length, and deadline each appear as on_screen_text in at least one scene, worded exactly as given.`;
}

async function generateScript(job, env) {
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 2048,
      messages: [{ role: "user", content: scriptPrompt(job) }],
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Claude API error ${resp.status}: ${text}`);
  }

  const data = await resp.json();
  const text = data.content?.[0]?.text ?? "";
  return JSON.parse(text);
}

async function handleApi(request, env, url) {
  const parts = url.pathname.split("/").filter(Boolean); // ["api", "jobs", ":id", ...]

  // POST /api/jobs
  if (request.method === "POST" && parts.length === 2 && parts[1] === "jobs") {
    const body = await request.json();
    const required = ["category", "client_name", "role"];
    for (const field of required) {
      if (!body[field]) return json({ error: `Missing field: ${field}` }, 400);
    }

    const result = await env.DB.prepare(
      `INSERT INTO job_demands
        (category, client_name, role, salary, contract_length, location, benefits, requirements, application_deadline, extra_notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
        body.extra_notes || null
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

  return json({ error: "Not found" }, 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      return handleApi(request, env, url);
    }
    return env.ASSETS.fetch(request);
  },
};
