const COOKIE = "ll_dev=2l08616a3s395t0d; ll_vid=102f439367af4102b904; ll_session=7905085c7b02a4e840a338dd3484f8995d019cd955fdf7d8f1c2a7ba846d1ee0; ll_pass=eyJpIjoiYmM3NDU4Mzc5MzVkNDVlZmJmNDciLCJ1IjoibWlsZXNwZXRlIiwibiI6Ik1pbGVzIFBldGVyIiwidCI6IlJPZXdwcjRWTlVNRE9uLUkiLCJlIjoxNzkyNDA0OTAyODk1fQ.wyQw5T4rXT32ZYfwVpvzddrsOPc4qM50CFHT6W-awrQ";

async function main() {
  // 1. Check room messages
  try {
    const res = await fetch("https://lagoslife.app/api/room?host=bc745837935d45efbf47&since=0", {
      headers: { cookie: COOKIE, accept: "application/json", "user-agent": "Mozilla/5.0" }
    });
    const data = await res.json();
    console.log("Room messages count:", (data.messages || []).length);
    for (const m of (data.messages || [])) {
      console.log(`[ROOM MSG] from: ${m.from} username: ${m.username} text: ${m.text}`);
    }
  } catch (e) {
    console.error("Room error:", e.message);
  }

  // 2. Query players API with retry for 'mumbas'
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      console.log(`Searching players?q=mumbas (attempt ${attempt})...`);
      const res = await fetch("https://lagoslife.app/api/players?q=mumbas", {
        headers: { cookie: COOKIE, accept: "application/json", "user-agent": "Mozilla/5.0" }
      });
      const data = await res.json();
      console.log("Players search result:", JSON.stringify(data));
      break;
    } catch (e) {
      console.log("Fetch error:", e.message);
      await new Promise(r => setTimeout(r, 2000));
    }
  }
}

main();
