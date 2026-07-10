import express from "express";
import { renderJob, cleanupWorkDir } from "./lib/ffmpeg.js";
import { uploadFile, uploadBuffer } from "./lib/r2.js";
import { textToVideo } from "./lib/replicate.js";
import { textToSpeech } from "./lib/elevenlabs.js";

const app = express();
app.use(express.json({ limit: "2mb" }));

app.get("/health", (req, res) => res.json({ ok: true }));

app.use((req, res, next) => {
  if (req.headers["x-render-token"] !== process.env.RENDER_SERVICE_TOKEN) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
});

app.post("/generate-assets", (req, res) => {
  const { jobId, aspectRatio, scenes, callbackUrl } = req.body;
  if (!jobId || !aspectRatio || !Array.isArray(scenes) || !callbackUrl) {
    return res.status(400).json({ error: "Missing jobId, aspectRatio, scenes, or callbackUrl" });
  }

  res.status(202).json({ accepted: true });
  generateAssetsInBackground({ jobId, aspectRatio, scenes, callbackUrl });
});

app.post("/render", (req, res) => {
  const { jobId, aspectRatio, scenes, callbackUrl } = req.body;
  if (!jobId || !aspectRatio || !Array.isArray(scenes) || !callbackUrl) {
    return res.status(400).json({ error: "Missing jobId, aspectRatio, scenes, or callbackUrl" });
  }

  res.status(202).json({ accepted: true });
  renderInBackground({ jobId, aspectRatio, scenes, callbackUrl });
});

async function notifyCallback(callbackUrl, body) {
  try {
    await fetch(callbackUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-render-token": process.env.RENDER_SERVICE_TOKEN,
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    console.error("Failed to notify callback:", err);
  }
}

async function generateAssetsInBackground({ jobId, aspectRatio, scenes, callbackUrl }) {
  const assets = [];
  try {
    for (const scene of scenes) {
      const videoUrl = await textToVideo({
        prompt: scene.visualDescription,
        aspectRatio,
        durationSeconds: scene.durationSeconds,
      });

      let audioKey = null;
      if (scene.voiceoverLine) {
        const audioBuffer = await textToSpeech(scene.voiceoverLine);
        audioKey = `jobs/${jobId}/scene-${scene.sceneNumber}.mp3`;
        await uploadBuffer(audioBuffer, audioKey, "audio/mpeg");
      }

      assets.push({
        scene_number: scene.sceneNumber,
        video_url: videoUrl,
        audio_key: audioKey,
        on_screen_text: scene.onScreenText,
        duration_seconds: scene.durationSeconds,
      });
    }

    await notifyCallback(callbackUrl, { assets });
  } catch (err) {
    console.error(`Asset generation failed for job ${jobId}:`, err);
    await notifyCallback(callbackUrl, { error: err.message });
  }
}

async function renderInBackground({ jobId, aspectRatio, scenes, callbackUrl }) {
  let finalPath;
  try {
    finalPath = await renderJob({ jobId, aspectRatio, scenes });
    const videoKey = `jobs/${jobId}/final.mp4`;
    await uploadFile(finalPath, videoKey, "video/mp4");
    await notifyCallback(callbackUrl, { videoKey });
  } catch (err) {
    console.error(`Render failed for job ${jobId}:`, err);
    await notifyCallback(callbackUrl, { error: err.message });
  } finally {
    if (finalPath) cleanupWorkDir(finalPath);
  }
}

const port = process.env.PORT || 8080;
app.listen(port, () => console.log(`Render service listening on :${port}`));
