# CTI Video Generator

Standalone tool for CTI Group: enter a job demand (property/cruise line, role, salary,
contract length, etc.) and generate a finished cinematic recruitment marketing video
(45-60s, 16:9 or 9:16) from it.

## How it works

1. **Form → D1**: job demand data is saved via the Cloudflare Worker (`src/worker.js`).
2. **Script generation** (`POST /api/jobs/:id/generate-script`): Groq (`llama-3.3-70b-versatile`)
   turns the job data into a scene-by-scene storyboard — headline, on-screen text,
   voiceover lines, per-scene durations summing to the requested video length. No data
   is invented; every number/name must match what was entered.
3. **Asset generation** (`POST /api/jobs/:id/generate-assets`): the Worker hands the script's
   scenes off to the Fly.io service (`render-service/`), which for each scene calls
   Replicate (`kwaivgi/kling-v2.5-turbo-pro`) to turn `visual_description` directly into a
   short video clip (single-step text-to-video), and runs Piper (self-hosted, CPU-only TTS
   baked into the Docker image) to turn `voiceover_line` into narration audio, stored in R2.
   It calls back `POST /api/internal/jobs/:id/assets-complete` when done. This runs on Fly
   rather than in the Worker because a multi-scene loop with multi-minute video generations
   per scene exceeds what Cloudflare Workers' `ctx.waitUntil` can reliably run to completion.
4. **Render** (`POST /api/jobs/:id/render`): the Worker hands scene clip/audio URLs off to
   the same Fly.io service, which downloads them, burns in the exact on-screen text captions
   with ffmpeg, concatenates all scenes, and uploads the final MP4 to R2. It calls back
   `POST /api/internal/jobs/:id/render-complete` when done.
5. The frontend polls job status and shows a player once `status = "ready"`.

## Local setup
```
npm install
cp .dev.vars.example .dev.vars   # fill in the secrets below
wrangler d1 create cti-video-generator   # copy the returned database_id into wrangler.toml
npm run db:init                          # apply schema.sql locally
npm run dev
```

## Secrets (Worker)

Set these with `wrangler secret put <NAME>` on the deployed Worker (or in `.dev.vars` locally):

| Secret | Where to get it |
|---|---|
| `GROQ_API_KEY` | console.groq.com |
| `RENDER_SERVICE_TOKEN` | any random string — shared secret between the Worker and the Fly render service (must match `RENDER_SERVICE_TOKEN` set on Fly, see below) |

`REPLICATE_API_TOKEN` lives on the Fly render service, not the Worker — see below. TTS
(Piper) is self-hosted on the render service itself, no external API key needed.

`PUBLIC_BASE_URL` and `RENDER_SERVICE_URL` are plain (non-secret) vars in `wrangler.toml`.

## Deploy the Worker
```
npm run db:init:remote   # apply schema.sql to the remote D1 database (once)
npm run deploy
```

## Deploy the render service (Fly.io)

The render service needs ffmpeg + Chromium-class compute that Cloudflare Workers can't
run, so it's a separate small app in `render-service/`.

```
cd render-service
fly launch --no-deploy   # creates the app, keep the name in fly.toml (cti-video-render) or update RENDER_SERVICE_URL in wrangler.toml to match
fly secrets set RENDER_SERVICE_TOKEN=<same value as the Worker secret>
fly secrets set REPLICATE_API_TOKEN=<from replicate.com/account/api-tokens>
fly secrets set R2_ACCOUNT_ID=<Cloudflare account ID>
fly secrets set R2_ACCESS_KEY_ID=<R2 API token access key ID>
fly secrets set R2_SECRET_ACCESS_KEY=<R2 API token secret>
fly secrets set R2_BUCKET_NAME=cti-video-generator-media
fly deploy
```

The R2 API token (S3-compatible access key, distinct from the Worker's R2 binding) is
created in the Cloudflare dashboard: R2 → Manage API Tokens → Create API Token
(Object Read & Write, scoped to the `cti-video-generator-media` bucket).

## Known limitations (v1)

- Kling v2.5 Turbo Pro only generates 5s or 10s clips; the render service always trims/pads
  to the scene's exact requested duration regardless, so total video length still lands on
  the requested 45-60s, but clips may be stretched/frozen more than with a model offering
  arbitrary durations.
- No retry/backoff on individual Replicate calls within a job — if one scene fails, the
  whole job's asset generation fails and needs to be retried from the UI.
- Piper's default voice (`en_US-lessac-medium`) is a single fixed English voice; change
  `PIPER_VOICE` (and add the matching `python3 -m piper.download_voices` call to the
  Dockerfile) to use a different one.
- Replicate video generation is not free — budget roughly $2.80-5.60 for an 8-scene video
  at current kling-v2.5-turbo-pro pricing ($0.35/5s, $0.70/10s clip).
