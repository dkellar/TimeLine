-- One row per finished level (won or lost).
CREATE TABLE IF NOT EXISTS plays (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  ts       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')), -- UTC, set by the server
  ip       TEXT,                     -- CF-Connecting-IP as seen by Cloudflare
  country  TEXT,                     -- two-letter code Cloudflare attaches to every request
  version  TEXT    NOT NULL,         -- game version, e.g. "v36"
  level    INTEGER NOT NULL,
  score    INTEGER NOT NULL,         -- points banked (0 for a loss)
  bank     INTEGER,                  -- player's money after this level (can be negative)
  mode     TEXT    NOT NULL,         -- "classic" | "risk"
  won      INTEGER NOT NULL,         -- 1 = level cleared, 0 = out of bows / bankrupt
  arrows   INTEGER,                  -- arrows in the puzzle
  seconds  INTEGER,                  -- solve time
  bumps    INTEGER,
  radio    INTEGER                   -- 1 if CHIR was playing when the level ended
);
CREATE INDEX IF NOT EXISTS plays_ts ON plays (ts);
CREATE INDEX IF NOT EXISTS plays_ip ON plays (ip);
