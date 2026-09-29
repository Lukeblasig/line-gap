// Pulls the PrizePicks board and pushes standard lines to the Line Gap worker.
// Runs in GitHub Actions. Needs repo secrets WORKER_URL and PUSH_TOKEN.
const PP_URL = "https://api.prizepicks.com/projections?per_page=10000&single_stat=true&game_mode=pickem";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";
const { WORKER_URL, PUSH_TOKEN } = process.env;
if (!WORKER_URL || !PUSH_TOKEN) { console.error("Missing WORKER_URL or PUSH_TOKEN secret"); process.exit(1); }

async function push(payload) {
  const r = await fetch(`${WORKER_URL.replace(/\/$/, "")}/push-pp`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${PUSH_TOKEN}` },
    body: JSON.stringify(payload),
  });
  console.log("Worker replied:", r.status, await r.text());
  if (!r.ok) process.exit(1);
}

function parse(j) {
  const inc = {};
  for (const x of j.included || []) inc[`${x.type}:${x.id}`] = x;
  const out = [];
  for (const p of j.data || []) {
    if (p.type !== "projection") continue;
    const a = p.attributes || {};
    if ((a.odds_type || "standard").toLowerCase() !== "standard") continue; // no demons/goblins
    const rel = p.relationships || {};
    const pl = inc[`new_player:${rel.new_player?.data?.id}`]?.attributes || {};
    if (pl.combo) continue;
    const line = parseFloat(a.line_score);
    if (!Number.isFinite(line)) continue;
    out.push({
      name: pl.display_name || pl.name || "",
      match: pl.team && a.description ? `${pl.team} vs ${a.description}` : (a.description || pl.team || ""),
      leagueRaw: inc[`league:${rel.league?.data?.id}`]?.attributes?.name || pl.league || "",
      stat: a.stat_display_name || a.stat_type || "",
      line, start: a.start_time || null, promo: !!a.is_promo,
    });
  }
  return out;
}

let res;
try {
  res = await fetch(PP_URL, { headers: {
    "User-Agent": UA, Accept: "application/json", "Accept-Language": "en-US,en;q=0.9",
    Referer: "https://app.prizepicks.com/", Origin: "https://app.prizepicks.com" } });
} catch (e) {
  await push({ error: `network error: ${e.message}` }); process.exit(0);
}
if (!res.ok) {
  console.log("PrizePicks status:", res.status);
  await push({ error: `PrizePicks HTTP ${res.status} (blocked GitHub's IP)` });
  process.exit(0);
}
const rows = parse(await res.json());
console.log(`Parsed ${rows.length} standard lines`);
await push(rows.length ? { rows } : { error: "PrizePicks returned 0 lines" });
