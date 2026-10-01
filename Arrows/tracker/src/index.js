// CHIR games usage tracker (Runway Arrows + Dial-A-Hit share one table) + Dial-A-Hit puzzle feed.
//   POST /event          JSON body from a game → one row in D1. `game` picks the game
//                        ("arrows" is assumed when missing, so the older Arrows build still works).
//   GET  /stats[?game=]  small JSON summary (plays today / total, top scores) for a quick look;
//                        add ?game=dial or ?game=arrows to look at one game only.
//   GET  /puzzles?genre=rock&decade=80s
//                        Dial-A-Hit puzzle list built from Last.fm's top tracks for those tags,
//                        cleaned so every answer can be dialed on a keypad. Needs the LASTFM_KEY
//                        secret (`npx wrangler secret put LASTFM_KEY`). Cached at the edge for a day.
//   POST /query          {"sql": "SELECT …"} → {columns, rows} for the GameStats page. Needs
//                        "Authorization: Bearer <ADMIN_KEY>" (`npx wrangler secret put ADMIN_KEY`).
//                        Read-only: one SELECT / WITH statement, at most MAX_ROWS rows back.
// Everything else → 404. IP and date are taken from the request, never from the client.

const MAX_BODY = 2048;

// Each game's allowed modes; the first is the fallback when the client sends something odd.
const GAMES = {
  arrows: ["classic", "risk"],
  dial: ["timed", "relaxed"],
};

function cors(request, env) {
  const origin = request.headers.get("Origin") || "";
  const allowed = (env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim());
  const ok = allowed.includes(origin) || allowed.includes("*");
  return {
    "Access-Control-Allow-Origin": ok ? origin : allowed[0] || "",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

const json = (data, status, headers) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", ...headers } });

const int = (v, lo, hi) => { const n = Number(v); return Number.isFinite(n) && n >= lo && n <= hi ? Math.round(n) : null; };

/* ---------------- Read-only queries (GameStats page) ---------------- */

const MAX_SQL = 4000, MAX_ROWS = 1000;
const WRITES = /\b(insert|update|delete|replace|drop|alter|create|attach|detach|pragma|vacuum|reindex|analyze|returning|savepoint|release|rollback|commit|begin)\b/i;

// Compare the bearer token with ADMIN_KEY without leaking where they differ.
async function authorized(request, env) {
  const key = env.ADMIN_KEY || "";
  const got = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!key || !got) return false;
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([crypto.subtle.digest("SHA-256", enc.encode(key)), crypto.subtle.digest("SHA-256", enc.encode(got))]);
  return crypto.subtle.timingSafeEqual(a, b);
}

// null if the statement is a single read; otherwise why not. Strings and comments are blanked
// first so a word like 'delete' inside a quoted value doesn't trip the check.
function readOnlyProblem(sql) {
  const bare = sql
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/"(?:[^"]|"")*"/g, '""')
    .replace(/--[^\n]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .trim()
    .replace(/;\s*$/, "");
  if (!/^(select|with)\b/i.test(bare)) return "only SELECT (or WITH … SELECT) queries are allowed";
  if (bare.includes(";")) return "one statement at a time";
  const w = bare.match(WRITES);
  if (w) return "'" + w[1].toUpperCase() + "' isn't allowed here — this page is read-only";
  return null;
}

/* ---------------- Puzzle feed (Last.fm) ---------------- */

// What the game may ask for → the Last.fm tag to fetch. null = no filter on that axis.
const GENRES = {
  any: null, rock: "rock", "classic-rock": "classic rock", pop: "pop", country: "country",
  folk: "folk", soul: "soul", metal: "metal", "hip-hop": "hip-hop", punk: "punk", blues: "blues",
  dance: "dance", indie: "indie", canadian: "canadian",
};
const DECADES = { any: null, "60s": "60s", "70s": "70s", "80s": "80s", "90s": "90s", "2000s": "00s", "2010s": "2010s" };
const ANY_ANY_TAGS = ["70s", "80s", "90s", "00s"];   // "surprise me" draws from these
const FEED_TTL = 86400;                               // seconds; both the Last.fm fetch and our response
const MAX_SONGS = 240, MAX_ARTISTS = 80;              // most-listened first, so these are the recognizable ones
const MAX_LETTERS = 24, MAX_WORDS = 5, MAX_WORD = 11; // what fits on the game's LCD

// Display form of a title for clues: drop "(feat. X)" / " - Remaster" tails, keep the rest as is.
const tidy = (raw) => String(raw || "").replace(/\s*[\(\[][^)\]]*[\)\]]/g, "").replace(/\s+-\s+.*$/, "").trim() || String(raw || "");

// Turn a title or artist into something dialable, or null if it can't be.
// Drops "(feat. X)", "[Remastered]", " - Live" tails; strips accents and the punctuation a
// phone keypad ignores; refuses digits, &, $ and anything else with no letters behind it.
function dialable(raw) {
  let t = String(raw || "");
  t = t.replace(/\s*[\(\[][^)\]]*[\)\]]/g, "");
  t = t.replace(/\s+-\s+.*$/, "");
  t = t.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  t = t.replace(/['\u2019\u2018.,!?:;"*]/g, "");
  t = t.replace(/[-\u2013\u2014/]/g, " ").replace(/\s+/g, " ").trim().toUpperCase();
  if (t.length < 3 || !/^[A-Z ]+$/.test(t)) return null;
  const words = t.split(" ");
  if (words.length > MAX_WORDS || words.some((w) => w.length > MAX_WORD)) return null;
  if (t.replace(/ /g, "").length > MAX_LETTERS) return null;
  return t;
}

async function lastfmTopTracks(tag, env) {
  const u = "https://ws.audioscrobbler.com/2.0/?method=tag.gettoptracks&limit=500&format=json" +
    "&tag=" + encodeURIComponent(tag) + "&api_key=" + env.LASTFM_KEY;
  const r = await fetch(u, { cf: { cacheTtl: FEED_TTL, cacheEverything: true }, headers: { "User-Agent": "CHIR Dial-A-Hit (chir.fm)" } });
  if (!r.ok) throw new Error("last.fm " + r.status);
  const j = await r.json();
  const list = (j.tracks && j.tracks.track) || [];
  return list.map((t) => ({ title: t.name, artist: (t.artist && t.artist.name) || "" })).filter((t) => t.title && t.artist);
}

const trackKey = (t) => (t.artist + "|" + t.title).toLowerCase();

async function puzzleFeed(genreId, decadeId, env) {
  if (!env.LASTFM_KEY) throw new Error("LASTFM_KEY secret is not set");
  const gTag = GENRES[genreId], dTag = DECADES[decadeId];
  let tracks, note = null, labelGenre = gTag;
  if (gTag && dTag) {
    // Last.fm can't intersect tags server-side, so fetch both lists and keep what's in both.
    const [g, d] = await Promise.all([lastfmTopTracks(gTag, env), lastfmTopTracks(dTag, env)]);
    const inDecade = new Set(d.map(trackKey));
    tracks = g.filter((t) => inDecade.has(trackKey(t)));
    if (tracks.length < 40) { tracks = d; labelGenre = null; note = "Not many tracks are tagged both " + gTag + " and " + dTag + " — this round is all " + dTag + "."; }
  } else if (gTag || dTag) {
    tracks = await lastfmTopTracks(gTag || dTag, env);
  } else {
    // Round-robin the decades so "anything" isn't just one era's list.
    const lists = await Promise.all(ANY_ANY_TAGS.map((t) => lastfmTopTracks(t, env)));
    tracks = [];
    for (let i = 0; i < 500; i++) for (const l of lists) if (l[i]) tracks.push(l[i]);
  }

  const label = [decadeId !== "any" ? decadeId : "", labelGenre || ""].filter(Boolean).join(" ");
  const seen = new Set(), songs = [], artists = new Map();
  for (const t of tracks) {
    const a = dialable(t.artist);
    if (a && !artists.has(a)) artists.set(a, { answer: a, category: "Artist", clue: "Known for " + tidy(t.title) + (label ? " \u00b7 " + label : "") });
    const sTitle = dialable(t.title);
    if (!sTitle || seen.has(sTitle) || sTitle === a) continue;
    seen.add(sTitle);
    songs.push({ answer: sTitle, category: "Song Title", clue: "by " + t.artist + (label ? " \u00b7 " + label : "") });
  }
  return {
    genre: genreId, decade: decadeId, label, note,
    source: "Last.fm tag charts", fetched: new Date().toISOString(),
    puzzles: songs.slice(0, MAX_SONGS).concat([...artists.values()].slice(0, MAX_ARTISTS)),
  };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const headers = cors(request, env);

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });

    if (request.method === "GET" && url.pathname === "/puzzles") {
      // Public data, so any origin may read it; cached at the edge per genre/decade for a day.
      const open = { ...headers, "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=" + FEED_TTL };
      const genre = GENRES.hasOwnProperty(url.searchParams.get("genre")) ? url.searchParams.get("genre") : "any";
      const decade = DECADES.hasOwnProperty(url.searchParams.get("decade")) ? url.searchParams.get("decade") : "any";
      const cacheKey = new Request(url.origin + "/puzzles?genre=" + genre + "&decade=" + decade);
      const cache = caches.default;
      const hit = await cache.match(cacheKey);
      if (hit) return hit;
      try {
        const res = json(await puzzleFeed(genre, decade, env), 200, open);
        ctx.waitUntil(cache.put(cacheKey, res.clone()));
        return res;
      } catch (e) {
        return json({ error: String(e.message || e), puzzles: [] }, 502, open);
      }
    }

    if (request.method === "POST" && url.pathname === "/event") {
      const raw = await request.text();
      if (raw.length > MAX_BODY) return json({ error: "too large" }, 413, headers);
      let b;
      try { b = JSON.parse(raw); } catch { return json({ error: "bad json" }, 400, headers); }

      const game = GAMES[b.game] ? b.game : "arrows";
      const modes = GAMES[game];
      const row = {
        ip: request.headers.get("CF-Connecting-IP") || null,
        country: (request.cf && request.cf.country) || null,
        game,
        version: String(b.version || "").slice(0, 16),
        level: int(b.level, 1, 100000),
        score: int(b.score, -1000000, 1000000),
        bank: int(b.bank, -100000000, 100000000),
        mode: modes.includes(b.mode) ? b.mode : modes[0],
        won: b.won ? 1 : 0,
        arrows: int(b.arrows, 0, 10000),
        seconds: int(b.seconds, 0, 86400),
        bumps: int(b.bumps, 0, 10000),
        radio: b.radio ? 1 : 0,
        contact: String(b.contact || "").trim().slice(0, 120) || null,   // contest entry (Dial-A-Hit); never returned by /stats
      };
      if (!row.version || row.level === null || row.score === null) return json({ error: "missing fields" }, 400, headers);

      await env.DB.prepare(
        `INSERT INTO plays (ip, country, game, version, level, score, bank, mode, won, arrows, seconds, bumps, radio, contact)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)`
      ).bind(row.ip, row.country, row.game, row.version, row.level, row.score, row.bank, row.mode, row.won, row.arrows, row.seconds, row.bumps, row.radio, row.contact).run();

      return json({ ok: true }, 200, headers);
    }

    if (request.method === "POST" && url.pathname === "/query") {
      if (!(await authorized(request, env))) return json({ error: "wrong or missing admin key" }, 401, headers);
      let b;
      try { b = JSON.parse(await request.text()); } catch { return json({ error: "bad json" }, 400, headers); }
      const sql = String((b && b.sql) || "").trim();
      if (!sql || sql.length > MAX_SQL) return json({ error: "sql missing or too long" }, 400, headers);
      const problem = readOnlyProblem(sql);
      if (problem) return json({ error: problem }, 400, headers);
      try {
        const started = Date.now();
        const [columns, ...rows] = await env.DB.prepare(sql).raw({ columnNames: true });
        return json({ columns: columns || [], rows: rows.slice(0, MAX_ROWS), total: rows.length, truncated: rows.length > MAX_ROWS, ms: Date.now() - started }, 200, headers);
      } catch (e) {
        return json({ error: String(e.message || e).replace(/^D1_ERROR:\s*/, "") }, 400, headers);
      }
    }

    if (request.method === "GET" && url.pathname === "/stats") {
      // Optional ?game=arrows|dial narrows every figure to one game; otherwise it's everything.
      const g = url.searchParams.get("game");
      const where = GAMES[g] ? `WHERE game = '${g}'` : "";
      const and = GAMES[g] ? `AND game = '${g}'` : "";
      const [byGame, totals, today, top, richest] = await Promise.all([
        env.DB.prepare(`SELECT game, COUNT(*) AS plays, COUNT(DISTINCT ip) AS players, SUM(won) AS wins FROM plays GROUP BY game`).all(),
        env.DB.prepare(`SELECT COUNT(*) AS plays, COUNT(DISTINCT ip) AS players, SUM(won) AS wins, MAX(level) AS top_level FROM plays ${where}`).first(),
        env.DB.prepare(`SELECT COUNT(*) AS plays, COUNT(DISTINCT ip) AS players FROM plays WHERE ts >= strftime('%Y-%m-%dT00:00:00Z', 'now') ${and}`).first(),
        env.DB.prepare(`SELECT ts, game, level, score, bank, mode, version, country FROM plays WHERE won = 1 ${and} ORDER BY score DESC LIMIT 10`).all(),
        // Latest balance per player (by IP), highest first.
        env.DB.prepare(`SELECT ip, country, game, bank, ts FROM plays WHERE id IN (SELECT MAX(id) FROM plays WHERE bank IS NOT NULL ${and} GROUP BY ip) ORDER BY bank DESC LIMIT 10`).all(),
      ]);
      return json({ game: GAMES[g] ? g : "all", by_game: byGame.results, totals, today, top_scores: top.results, richest_players: richest.results }, 200, headers);
    }

    return json({ error: "not found" }, 404, headers);
  },
};
