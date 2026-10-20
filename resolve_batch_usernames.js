const COOKIE = "ll_dev=2l08616a3s395t0d; ll_vid=102f439367af4102b904; ll_session=7905085c7b02a4e840a338dd3484f8995d019cd955fdf7d8f1c2a7ba846d1ee0; ll_pass=eyJpIjoiYmM3NDU4Mzc5MzVkNDVlZmJmNDciLCJ1IjoibWlsZXNwZXRlIiwibiI6Ik1pbGVzIFBldGVyIiwidCI6IlJPZXdwcjRWTlVNRE9uLUkiLCJlIjoxNzkyNDA0OTAyODk1fQ.wyQw5T4rXT32ZYfwVpvzddrsOPc4qM50CFHT6W-awrQ";

const usernames = [
  "Big_stephani",
  "tasticeofx",
  "Kaizen_77",
  "Maryjoydaniel",
  "Xorx_eko",
  "Andreanoe",
  "faeesal",
  "Engr_kenny"
];

async function resolveAll() {
  const resolved = [];
  for (const raw of usernames) {
    const cleanUser = raw.replace(/^@/, "").trim();
    const url = `https://lagoslife.app/api/players?q=${encodeURIComponent(cleanUser)}`;
    const res = await fetch(url, {
      headers: { "cookie": COOKIE, "accept": "application/json" }
    });
    const data = await res.json().catch(() => ({}));
    const players = data.players || [];
    const exact = players.find(p => (p.username || "").toLowerCase() === cleanUser.toLowerCase()) || players[0];

    if (exact) {
      resolved.push({ username: exact.username, id: exact.id, name: exact.name, original: raw });
      console.log(`✅ [Resolved] ${raw} -> ID: ${exact.id} (@${exact.username}, "${exact.name}")`);
    } else {
      console.log(`❌ [Failed to resolve] ${raw}`);
    }
  }
  return resolved;
}

resolveAll();
