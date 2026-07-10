const BASE_URL = "https://api.replicate.com/v1";
const POLL_INTERVAL_MS = 4000;
const MAX_POLL_ATTEMPTS = 180; // ~12 minutes per asset - fine here, no Workers duration limit

// kling-v2.5-turbo-pro: $0.35/5s vs kling-v2.1-master's $0.80/5s - less than half the
// cost for a still-strong text-to-video model.
const TEXT_TO_VIDEO_MODEL = "kwaivgi/kling-v2.5-turbo-pro";

function authHeader() {
  return `Bearer ${process.env.REPLICATE_API_TOKEN}`;
}

async function createPrediction(modelPath, input) {
  const resp = await fetch(`${BASE_URL}/models/${modelPath}/predictions`, {
    method: "POST",
    headers: {
      Authorization: authHeader(),
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

async function pollUntilComplete(prediction) {
  let current = prediction;

  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    if (current.status === "succeeded") return current;
    if (current.status === "failed") throw new Error(`Replicate generation failed: ${current.error || "unknown error"}`);
    if (current.status === "canceled") throw new Error("Replicate generation was canceled");

    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

    const resp = await fetch(current.urls.get, {
      headers: { Authorization: authHeader() },
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

// Kling v2.1 Master only supports 5s or 10s clips - the render step already
// trims/pads every scene to its exact requested duration, so we just pick the closer.
function nearestSupportedDuration(seconds) {
  return seconds <= 7 ? 5 : 10;
}

export async function textToVideo({ prompt, aspectRatio, durationSeconds }) {
  const prediction = await createPrediction(TEXT_TO_VIDEO_MODEL, {
    prompt,
    aspect_ratio: aspectRatio,
    duration: nearestSupportedDuration(durationSeconds),
  });
  const result = await pollUntilComplete(prediction);
  const videoUrl = firstOutput(result);
  if (!videoUrl) throw new Error(`Replicate text-to-video completed with no output: ${JSON.stringify(result)}`);
  return videoUrl;
}
