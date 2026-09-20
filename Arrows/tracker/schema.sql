-- One row per finished level / puzzle (won or lost), shared by every CHIR game.
-- Column meaning by game:                 arrows                      dial (Dial-A-Hit)
--   level ...................... level number                track number in the round (1-5)
--   score ...................... points banked (0 = loss)    points for that puzzle (0 = miss / pass)
--   bank ....................... money after the level       round score so far (can be negative)
--   mode ....................... "classic" | "risk"          "timed" | "relaxed"
--   arrows ..................... arrows in the puzzle        letters in the answer
--   seconds .................... solve time                  seconds used (incl. bought time)
--   bumps ...................... bumps                       guesses made
CREATE TABLE IF NOT EXISTS plays (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  ts       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')), -- UTC, set by the server
  ip       TEXT,                     -- CF-Connecting-IP as seen by Cloudflare
  country  TEXT,                     -- two-letter code Cloudflare attaches to every request
  game     TEXT    NOT NULL DEFAULT 'arrows', -- which game sent the row: "arrows" | "dial"
  version  TEXT    NOT NULL,         -- game version, e.g. "v36" or "v7"
  level    INTEGER NOT NULL,
  score    INTEGER NOT NULL,
  bank     INTEGER,
  mode     TEXT    NOT NULL,
  won      INTEGER NOT NULL,         -- 1 = cleared / solved, 0 = lost / out of tries / passed
  arrows   INTEGER,
  seconds  INTEGER,
  bumps    INTEGER,
  radio    INTEGER                   -- 1 if CHIR was playing when the level ended
);
CREATE INDEX IF NOT EXISTS plays_ts ON plays (ts);
CREATE INDEX IF NOT EXISTS plays_ip ON plays (ip);
CREATE INDEX IF NOT EXISTS plays_game ON plays (game);

-- Already have the table from before the `game` column existed? Run this once instead:
--   ALTER TABLE plays ADD COLUMN game TEXT NOT NULL DEFAULT 'arrows';
--   CREATE INDEX IF NOT EXISTS plays_game ON plays (game);
