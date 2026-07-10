DROP TABLE IF EXISTS job_demands;

CREATE TABLE job_demands (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL,          -- cruise | property | hotel | other
  client_name TEXT NOT NULL,       -- property / cruise line name
  role TEXT NOT NULL,
  salary TEXT,
  contract_length TEXT,
  location TEXT,
  benefits TEXT,
  requirements TEXT,
  application_deadline TEXT,
  extra_notes TEXT,
  aspect_ratio TEXT NOT NULL DEFAULT '16:9',    -- 16:9 | 9:16
  duration_target INTEGER NOT NULL DEFAULT 50,  -- seconds, 45-60
  status TEXT NOT NULL DEFAULT 'draft',
  -- draft | script_ready | generating_assets | assets_ready | rendering | ready | failed
  script_json TEXT,
  assets_json TEXT,      -- per-scene generated image/video/audio urls
  render_error TEXT,
  video_url TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
