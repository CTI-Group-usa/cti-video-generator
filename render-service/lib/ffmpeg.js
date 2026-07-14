import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const DIMENSIONS = {
  "16:9": { width: 1920, height: 1080 },
  "9:16": { width: 1080, height: 1920 },
};

const FONT_PATH = process.env.FONT_PATH || "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";
// Pixabay License (royalty-free, no attribution required, commercial use allowed as part
// of a larger creative work) - see https://pixabay.com/service/license-summary/
const BACKGROUND_MUSIC_PATH = fileURLToPath(new URL("../assets/background-music.mp3", import.meta.url));
const BACKGROUND_MUSIC_VOLUME = 0.15;

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited with code ${code}: ${stderr.slice(-2000)}`));
    });
    proc.on("error", reject);
  });
}

async function download(url, destPath) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Failed to download ${url}: ${resp.status}`);
  fs.writeFileSync(destPath, Buffer.from(await resp.arrayBuffer()));
}

function escapeDrawtext(text) {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/'/g, "’") // swap apostrophes for a safe unicode char to sidestep ffmpeg quoting rules
    .replace(/%/g, "\\%");
}

const MAX_CHARS_PER_LINE = 22;

function wrapLines(text, maxCharsPerLine = MAX_CHARS_PER_LINE) {
  const words = text.split(" ");
  const lines = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxCharsPerLine && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

async function processScene({ videoPath, audioPath, outPath, width, height, durationSeconds, onScreenText }) {
  // tpad guarantees the video stream covers the full scene duration even if the
  // source clip came back shorter than requested (freezes the last frame instead
  // of ending early); the trailing -t then trims everything to the exact length.
  const filters = [
    `scale=${width}:${height}:force_original_aspect_ratio=increase`,
    `crop=${width}:${height}`,
    `tpad=stop_mode=clone:stop_duration=${durationSeconds}`,
  ];

  if (onScreenText) {
    // One drawtext filter per wrapped line plus a separate background drawbox,
    // rather than a single multi-line drawtext - embedding a literal newline in
    // the text option is unreliable across ffmpeg builds (stray glyphs / literal "n").
    const lines = wrapLines(onScreenText);
    const safeFontPath = FONT_PATH.replace(/:/g, "\\:");
    // fontsize is capped by both frame height and the width needed to fit
    // MAX_CHARS_PER_LINE at a rough 0.58 width-per-char ratio for a bold sans font.
    const fontsize = Math.max(
      24,
      Math.min(Math.round(height * 0.045), Math.floor((width * 0.9) / (MAX_CHARS_PER_LINE * 0.58)))
    );
    const lineHeight = Math.round(fontsize * 1.3);
    const blockHeight = lines.length * lineHeight + 20;
    const marginBottom = Math.round(height * 0.1);
    const boxTop = height - marginBottom - blockHeight;

    filters.push(`drawbox=x=0:y=${boxTop}:w=${width}:h=${blockHeight}:color=black@0.55:t=fill`);
    lines.forEach((line, i) => {
      const safeLine = escapeDrawtext(line);
      const y = boxTop + 10 + i * lineHeight;
      filters.push(
        `drawtext=fontfile=${safeFontPath}:text='${safeLine}':fontcolor=white:fontsize=${fontsize}:x=(w-text_w)/2:y=${y}`
      );
    });
  }

  const args = ["-y", "-i", videoPath];
  if (audioPath) {
    args.push("-i", audioPath);
  } else {
    args.push("-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100");
  }

  args.push(
    "-vf",
    filters.join(","),
    // apad pads audio with silence if it's shorter than the video/target duration;
    // no -shortest here on purpose, so a short voiceover clip no longer truncates the scene.
    // -ar/-ac force every scene to the same audio format regardless of source (Piper
    // voiceover vs. anullsrc silence use different rates/channels) - concatenating
    // scenes with mismatched audio formats via stream-copy corrupts the merged duration.
    "-af",
    "apad",
    "-ar",
    "44100",
    "-ac",
    "2",
    "-t",
    String(durationSeconds),
    "-map",
    "0:v:0",
    "-map",
    "1:a:0",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-c:a",
    "aac",
    outPath
  );

  await run("ffmpeg", args);
}

async function concatScenes(scenePaths, outPath) {
  const listPath = `${outPath}.txt`;
  const listContent = scenePaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n");
  fs.writeFileSync(listPath, listContent);
  await run("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", outPath]);
}

async function mixBackgroundMusic(inputPath, outPath) {
  // -stream_loop -1 repeats the track for videos longer than it; amix's
  // duration=first caps the mixed output to the narration/video track's length
  // regardless, so it never extends the video.
  await run("ffmpeg", [
    "-y",
    "-i",
    inputPath,
    "-stream_loop",
    "-1",
    "-i",
    BACKGROUND_MUSIC_PATH,
    "-filter_complex",
    `[1:a]volume=${BACKGROUND_MUSIC_VOLUME}[bgm];[0:a][bgm]amix=inputs=2:duration=first:dropout_transition=0[aout]`,
    "-map",
    "0:v:0",
    "-map",
    "[aout]",
    "-c:v",
    "copy",
    "-c:a",
    "aac",
    outPath,
  ]);
}

export async function renderJob({ jobId, aspectRatio, scenes }) {
  const dims = DIMENSIONS[aspectRatio] || DIMENSIONS["16:9"];
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), `render-${jobId}-`));

  const ordered = [...scenes].sort((a, b) => a.sceneNumber - b.sceneNumber);
  const scenePaths = [];

  for (const scene of ordered) {
    const rawVideoPath = path.join(workDir, `scene-${scene.sceneNumber}-raw.mp4`);
    await download(scene.videoUrl, rawVideoPath);

    let audioPath = null;
    if (scene.audioUrl) {
      audioPath = path.join(workDir, `scene-${scene.sceneNumber}-audio.wav`);
      await download(scene.audioUrl, audioPath);
    }

    const outPath = path.join(workDir, `scene-${scene.sceneNumber}-final.mp4`);
    await processScene({
      videoPath: rawVideoPath,
      audioPath,
      outPath,
      width: dims.width,
      height: dims.height,
      durationSeconds: scene.durationSeconds,
      onScreenText: scene.onScreenText,
    });
    scenePaths.push(outPath);
  }

  const concatPath = path.join(workDir, "concat.mp4");
  await concatScenes(scenePaths, concatPath);

  const finalPath = path.join(workDir, "final.mp4");
  await mixBackgroundMusic(concatPath, finalPath);
  return finalPath;
}

export function cleanupWorkDir(finalPath) {
  fs.rmSync(path.dirname(finalPath), { recursive: true, force: true });
}
