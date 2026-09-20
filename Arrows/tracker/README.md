# CHIR games tracker (Cloudflare Worker + D1)

One Worker and one `plays` table shared by **Runway Arrows** and **Dial-A-Hit**. Records one
row per finished level or puzzle: date/time (UTC), player IP, country, which game (`game`
column: `arrows` or `dial`), version, level/track, score, bank/round score, mode, win/loss,
arrows/letters, seconds, bumps/guesses, and whether CHIR was playing. `schema.sql` has the
column-by-column meaning for each game.

## One-time setup (about five minutes, all free tier)

Run these from this folder (`Arrows/tracker`). Each `npx wrangler …` command uses the
wrangler that ships with npm — nothing to install.

1. Sign in — this opens your browser; approve it there:

       npx wrangler login

2. Create the database:

       npx wrangler d1 create runway-arrows

   The output ends with a `database_id = "…"` line. Paste that id into `wrangler.toml`
   in place of `PASTE-THE-ID-FROM-wrangler-d1-create-HERE`.

3. Create the table:

       npx wrangler d1 execute runway-arrows --remote --file=schema.sql

4. Deploy the Worker:

       npx wrangler deploy

   The output shows the Worker's URL, like `https://runway-tracker.<your-subdomain>.workers.dev`.

5. Put that URL into the game: open `../index.html`, find `const TRACK_URL = ""` near the
   top of the script and set it to the Worker URL. Re-upload `index.html` to GitHub Pages.

## Checking it works

- `curl https://runway-tracker.<your-subdomain>.workers.dev/stats` — plays today / total, top scores.
- Browse rows in the Cloudflare dashboard: Storage & Databases → D1 → runway-arrows → Explore data.
- Or from here: `npx wrangler d1 execute runway-arrows --remote --command "SELECT * FROM plays ORDER BY id DESC LIMIT 20"`

## Adding Dial-A-Hit to an existing database (do this once)

The table needs the new `game` column, then the Worker needs redeploying:

    npx wrangler d1 execute runway-arrows --remote --command "ALTER TABLE plays ADD COLUMN game TEXT NOT NULL DEFAULT 'arrows'; CREATE INDEX IF NOT EXISTS plays_game ON plays (game)"
    npx wrangler deploy

Existing rows are marked `arrows` automatically. Then add the site Dial-A-Hit is served
from to `ALLOWED_ORIGINS` in `wrangler.toml` if it isn't already there, and set
`trackUrl` in the game's `CONFIG` to the Worker URL.

Look at one game at a time: `curl "https://runway-tracker.<your-subdomain>.workers.dev/stats?game=dial"`

## If you created the table before the `bank` column existed

    npx wrangler d1 execute runway-arrows --remote --command "ALTER TABLE plays ADD COLUMN bank INTEGER"

## Notes

- The games only send: game, version, level, score, bank, mode, won, arrows, seconds, bumps, radio.
  IP, country and timestamp are added by the Worker from the request itself, so they
  can't be spoofed by the client.
- `ALLOWED_ORIGINS` in `wrangler.toml` lists the sites allowed to post. `null` is what a
  browser sends for a page opened straight from a file (the .command launcher).
- Free-tier limits (2026): Workers 100,000 requests/day; D1 100,000 writes and 5,000,000
  reads/day, 5 GB storage. One row per finished level is nowhere near any of these.
- IP addresses are personal data. If the game ever has players outside your circle,
  consider storing a hashed IP instead (one-line change in `src/index.js`).
