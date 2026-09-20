// CHIR games usage tracker (Runway Arrows + Dial-A-Hit share one table).
//   POST /event          JSON body from a game → one row in D1. `game` picks the game
//                        ("arrows" is assumed when missing, so the older Arrows build still works).
//   GET  /stats[?game=]  small JSON summary (plays today / total, top scores) for a quick look;
//                        add ?game=dial or ?game=arrows to look at one game only.
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
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

const json = (data, status, headers) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", ...headers } });

const int = (v, lo, hi) => { const n = Number(v); return Number.isFinite(n) && n >= lo && n <= hi ? Math.round(n) : null; };

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const headers = cors(request, env);

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });

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
