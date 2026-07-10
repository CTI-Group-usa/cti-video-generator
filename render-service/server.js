import express from "express";
import { renderJob, cleanupWorkDir } from "./lib/ffmpeg.js";
import { uploadFile } from "./lib/r2.js";

const app = express();
app.use(express.json({ limit: "2mb" }));

app.get("/health", (req, res) => res.json({ ok: true }));

app.use((req, res, next) => {
  if (req.headers["x-render-token"] !== process.env.RENDER_SERVICE_TOKEN) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
});

app.post("/render", (req, res) => {
  const { jobId, aspectRatio, scenes, callbackUrl } = req.body;
  if (!jobId || !aspectRatio || !Array.isArray(scenes) || !callbackUrl) {
    return res.status(400).json({ error: "Missing jobId, aspectRatio, scenes, or callbackUrl" });
  }

  res.status(202).json({ accepted: true });
  processInBackground({ jobId, aspectRatio, scenes, callbackUrl });
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

async function processInBackground({ jobId, aspectRatio, scenes, callbackUrl }) {
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
