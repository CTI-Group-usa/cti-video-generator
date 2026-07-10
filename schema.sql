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
  status TEXT NOT NULL DEFAULT 'draft',   -- draft | script_ready | rendering | ready
  script_json TEXT,
  video_url TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
