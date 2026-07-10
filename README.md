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
3. **Asset generation** (`POST /api/jobs/:id/generate-assets`, runs in the background via
   `ctx.waitUntil`): for each scene, Higgsfield turns the `visual_description` into a
   still image (`higgsfield-ai/soul/standard`) and then animates it into a short video
   clip (`higgsfield-ai/dop/standard`); ElevenLabs turns `voiceover_line` into narration
   audio, stored in R2.
4. **Render** (`POST /api/jobs/:id/render`): the Worker hands scene clip/audio URLs off to
   a small Fly.io service (`render-service/`) that downloads them, burns in the exact
   on-screen text captions with ffmpeg, concatenates all scenes, and uploads the final
   MP4 to R2. It calls back `POST /api/internal/jobs/:id/render-complete` when done.
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
| `HIGGSFIELD_KEY_ID` / `HIGGSFIELD_KEY_SECRET` | Higgsfield API dashboard |
| `ELEVENLABS_API_KEY` | elevenlabs.io |
| `RENDER_SERVICE_TOKEN` | any random string — shared secret between the Worker and the Fly render service (must match `RENDER_SERVICE_TOKEN` set on Fly, see below) |

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

- Higgsfield clip length may not exactly match the requested scene duration; ffmpeg
  freezes the last frame to pad video short of the target and cuts anything longer, so
  total video length may drift slightly from the requested 45-60s.
- No retry/backoff on individual Higgsfield/ElevenLabs calls within a job — if one scene
  fails, the whole job's asset generation fails and needs to be retried from the UI.
