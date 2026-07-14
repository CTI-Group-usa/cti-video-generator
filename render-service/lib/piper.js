import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const VOICE = process.env.PIPER_VOICE || "en_US-lessac-medium";
const DATA_DIR = process.env.PIPER_DATA_DIR || "/opt/piper-voices";

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`piper exited with code ${code}: ${stderr.slice(-2000)}`));
    });
    proc.on("error", reject);
  });
}

export async function textToSpeech(text) {
  const outPath = path.join(os.tmpdir(), `piper-${Date.now()}-${Math.random().toString(36).slice(2)}.wav`);
  try {
    await run("python3", ["-m", "piper", "-m", VOICE, "--data-dir", DATA_DIR, "-f", outPath, "--", text]);
    return fs.readFileSync(outPath);
  } finally {
    if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
  }
}
