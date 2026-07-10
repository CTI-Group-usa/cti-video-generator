const BASE_URL = "https://platform.higgsfield.ai";
const POLL_INTERVAL_MS = 3000;
const MAX_POLL_ATTEMPTS = 60; // ~3 minutes per asset

function authHeader(env) {
  return `Key ${env.HIGGSFIELD_KEY_ID}:${env.HIGGSFIELD_KEY_SECRET}`;
}

async function submit(env, modelPath, input) {
  const resp = await fetch(`${BASE_URL}/${modelPath}`, {
    method: "POST",
    headers: {
      Authorization: authHeader(env),
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify(input),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Higgsfield submit error ${resp.status} (${modelPath}): ${text}`);
  }

  const data = await resp.json();
  const requestId = data.request_id ?? data.id;
  if (!requestId) throw new Error(`Higgsfield submit response missing request_id: ${JSON.stringify(data)}`);
  return requestId;
}

async function pollUntilComplete(env, requestId) {
  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    const resp = await fetch(`${BASE_URL}/requests/${requestId}/status`, {
      headers: { Authorization: authHeader(env), accept: "application/json" },
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Higgsfield status error ${resp.status}: ${text}`);
    }

    const data = await resp.json();

    if (data.status === "completed") return data;
    if (data.status === "failed") throw new Error(`Higgsfield generation failed: ${data.error || "unknown error"}`);
    if (data.status === "nsfw") throw new Error("Higgsfield flagged the generated content as NSFW");

    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }

  throw new Error(`Higgsfield generation timed out after ${MAX_POLL_ATTEMPTS} polls (request ${requestId})`);
}

export async function textToImage(env, { prompt, aspectRatio, resolution = "720p" }) {
  const requestId = await submit(env, "higgsfield-ai/soul/standard", {
    prompt,
    aspect_ratio: aspectRatio,
    resolution,
  });
  const result = await pollUntilComplete(env, requestId);
  const imageUrl = result.images?.[0]?.url;
  if (!imageUrl) throw new Error(`Higgsfield text-to-image completed with no image url: ${JSON.stringify(result)}`);
  return imageUrl;
}

export async function imageToVideo(env, { imageUrl, prompt, durationSeconds }) {
  const requestId = await submit(env, "higgsfield-ai/dop/standard", {
    image_url: imageUrl,
    prompt,
    duration: durationSeconds,
  });
  const result = await pollUntilComplete(env, requestId);
  const videoUrl = result.video?.url;
  if (!videoUrl) throw new Error(`Higgsfield image-to-video completed with no video url: ${JSON.stringify(result)}`);
  return videoUrl;
}
