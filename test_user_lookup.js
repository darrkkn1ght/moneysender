const COOKIE = "ll_dev=2l08616a3s395t0d; ll_vid=102f439367af4102b904; ll_session=7905085c7b02a4e840a338dd3484f8995d019cd955fdf7d8f1c2a7ba846d1ee0; ll_pass=eyJpIjoiYmM3NDU4Mzc5MzVkNDVlZmJmNDciLCJ1IjoibWlsZXNwZXRlIiwibiI6Ik1pbGVzIFBldGVyIiwidCI6IlJPZXdwcjRWTlVNRE9uLUkiLCJlIjoxNzkyNDA0OTAyODk1fQ.wyQw5T4rXT32ZYfwVpvzddrsOPc4qM50CFHT6W-awrQ";

const targetUsernames = [
  "Big_stephani",
  "tasticeofx",
  "Kaizen_77",
  "Maryjoydaniel",
  "Xorx_eko",
  "Andreanoe",
  "faeesal",
  "Engr_kenny"
];

async function testEndpoints() {
  // 1. Fetch /api/players
  console.log("Fetching /api/players...");
  const pRes = await fetch("https://lagoslife.app/api/players", {
    headers: { "cookie": COOKIE, "accept": "application/json" }
  });
  console.log("/api/players status:", pRes.status);
  const pData = await pRes.json().catch(() => ({}));
  const players = pData.players || pData || [];
  console.log("Total players returned:", Array.isArray(players) ? players.length : Object.keys(players));

  if (Array.isArray(players) && players.length > 0) {
    console.log("Sample player:", players[0]);
    for (const p of players) {
      const u = (p.username || p.name || "").toLowerCase().replace(/^@/, "");
      for (const t of targetUsernames) {
        if (u === t.toLowerCase().replace(/^@/, "")) {
          console.log(`FOUND in /players: ${t} -> ${p.id || p.uid || p._id}`);
        }
      }
    }
  }

  // 2. Try searching by username endpoint
  for (const t of ["tasticeofx", "Kaizen_77", "faeesal"]) {
    for (const path of [`/api/players?q=${t}`, `/api/search?q=${t}`, `/api/users/${t}`, `/api/user?username=${t}`, `/api/messages?with=${t}`]) {
      const r = await fetch(`https://lagoslife.app${path}`, {
        headers: { "cookie": COOKIE, "accept": "application/json" }
      });
      console.log(`Path ${path} -> ${r.status}`);
      if (r.status === 200) {
        const d = await r.json().catch(() => ({}));
        console.log(`  Data:`, JSON.stringify(d).slice(0, 200));
      }
    }
  }
}

testEndpoints();
