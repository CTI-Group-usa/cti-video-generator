const BASE_URL = "https://api.replicate.com/v1";
const POLL_INTERVAL_MS = 4000;
const MAX_POLL_ATTEMPTS = 90; // ~6 minutes per asset

const TEXT_TO_IMAGE_MODEL = "black-forest-labs/flux-schnell";
const IMAGE_TO_VIDEO_MODEL = "kwaivgi/kling-v2.1";

function authHeader(env) {
  return `Bearer ${env.REPLICATE_API_TOKEN}`;
}

async function createPrediction(env, modelPath, input) {
  const resp = await fetch(`${BASE_URL}/models/${modelPath}/predictions`, {
    method: "POST",
    headers: {
      Authorization: authHeader(env),
      "content-type": "application/json",
    },
    body: JSON.stringify({ input }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Replicate submit error ${resp.status} (${modelPath}): ${text}`);
  }

  return resp.json();
}

async function pollUntilComplete(env, prediction) {
  let current = prediction;

  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    if (current.status === "succeeded") return current;
    if (current.status === "failed") throw new Error(`Replicate generation failed: ${current.error || "unknown error"}`);
    if (current.status === "canceled") throw new Error("Replicate generation was canceled");

    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

    const resp = await fetch(current.urls.get, {
      headers: { Authorization: authHeader(env) },
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Replicate status error ${resp.status}: ${text}`);
    }
    current = await resp.json();
  }

  throw new Error(`Replicate generation timed out after ${MAX_POLL_ATTEMPTS} polls (prediction ${current.id})`);
}

function firstOutput(result) {
  return Array.isArray(result.output) ? result.output[0] : result.output;
}

// Kling v2.1 only supports 5s or 10s clips - the render service already trims/pads
// every scene to its exact requested duration, so we just pick the closer of the two.
function nearestSupportedDuration(seconds) {
  return seconds <= 7 ? 5 : 10;
}

export async function textToImage(env, { prompt, aspectRatio }) {
  const prediction = await createPrediction(env, TEXT_TO_IMAGE_MODEL, {
    prompt,
    aspect_ratio: aspectRatio,
    output_format: "png",
  });
  const result = await pollUntilComplete(env, prediction);
  const imageUrl = firstOutput(result);
  if (!imageUrl) throw new Error(`Replicate text-to-image completed with no output: ${JSON.stringify(result)}`);
  return imageUrl;
}

export async function imageToVideo(env, { imageUrl, prompt, durationSeconds }) {
  const prediction = await createPrediction(env, IMAGE_TO_VIDEO_MODEL, {
    image: imageUrl,
    prompt,
    duration: nearestSupportedDuration(durationSeconds),
  });
  const result = await pollUntilComplete(env, prediction);
  const videoUrl = firstOutput(result);
  if (!videoUrl) throw new Error(`Replicate image-to-video completed with no output: ${JSON.stringify(result)}`);
  return videoUrl;
}
