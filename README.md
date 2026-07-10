# CTI Video Generator

Standalone tool for CTI Group: enter a job demand (property/cruise line, role, salary,
contract length, etc.) and generate a cinematic recruitment marketing video from it.

## Phase 1 (this scaffold)
- Cloudflare Worker + D1 for storing job demands
- Form UI to enter job demand data
- `/api/jobs/:id/generate-script` calls Claude to turn the data into a scene-by-scene
  video script (headline, on-screen text, voiceover lines, durations) — no data is
  invented, every number/name must match what was entered

## Phase 2 (not built yet)
- Remotion project with cinematic scene templates (cruise, property, hotel, generic)
- Voiceover generation (e.g. ElevenLabs) from the script's `voiceover_line`s
- Server-side render (Remotion Lambda or a small render box — Workers can't run Chromium)
- Store rendered MP4 in R2, surface a download/share link in the UI

## Local setup
```
npm install
cp .dev.vars.example .dev.vars   # fill in ANTHROPIC_API_KEY
wrangler d1 create cti-video-generator   # copy the returned database_id into wrangler.toml
npm run db:init                          # apply schema.sql locally
npm run dev
```

## Deploy
```
npm run db:init:remote   # apply schema.sql to the remote D1 database (once)
npm run deploy
```
Then set the `ANTHROPIC_API_KEY` secret on the deployed Worker:
```
wrangler secret put ANTHROPIC_API_KEY
```
