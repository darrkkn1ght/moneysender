import fs from "node:fs/promises";

const COOKIE = "ll_dev=2l08616a3s395t0d; ll_vid=102f439367af4102b904; ll_session=7905085c7b02a4e840a338dd3484f8995d019cd955fdf7d8f1c2a7ba846d1ee0; ll_pass=eyJpIjoiYmM3NDU4Mzc5MzVkNDVlZmJmNDciLCJ1IjoibWlsZXNwZXRlIiwibiI6Ik1pbGVzIFBldGVyIiwidCI6IlJPZXdwcjRWTlVNRE9uLUkiLCJlIjoxNzkyNDA0OTAyODk1fQ.wyQw5T4rXT32ZYfwVpvzddrsOPc4qM50CFHT6W-awrQ";

async function main() {
  console.log("=== Checking /api/save for current room & party state ===");
  const saveRes = await fetch("https://lagoslife.app/api/save", {
    headers: { "cookie": COOKIE, "accept": "application/json", "user-agent": "Mozilla/5.0" }
  });
  const saveData = await saveRes.json();
  await fs.writeFile("./save_inspect_miles.json", JSON.stringify(saveData, null, 2));
  console.log("Save keys:", Object.keys(saveData));
  if (saveData.game) {
    console.log("Game keys:", Object.keys(saveData.game));
    console.log("Game room/house:", saveData.game.room, saveData.game.house, saveData.game.party);
  }

  console.log("=== Checking HTML of app ===");
  const pageRes = await fetch("https://lagoslife.app/", {
    headers: { "cookie": COOKIE, "user-agent": "Mozilla/5.0" }
  });
  const html = await pageRes.text();
  const scriptMatches = [...html.matchAll(/src="(\/_next\/static\/chunks\/[^"]+)"/g)].map(m => m[1]);
  console.log(`Found ${scriptMatches.length} script chunks`);

  const interestingPhrases = ["let them in", "door", "bell", "knock", "visitor", "invite", "party", "house", "admit", "accept"];
  const foundAPIs = new Set();
  const foundPhrases = [];

  for (const s of scriptMatches) {
    try {
      const r = await fetch("https://lagoslife.app" + s);
      const text = await r.text();
      
      const apis = text.match(/\/api\/[a-zA-Z0-9_\-\/]+/g) || [];
      for (const a of apis) {
        if (/house|door|party|room|guest|visit|knock|bell|enter|admit|accept|player/i.test(a)) {
          foundAPIs.add(a);
        }
      }

      for (const phrase of ["let them in", "let in", "doorbell", "knock", "party", "admit", "at the door", "waiting outside", "rings the bell"]) {
        const idx = text.toLowerCase().indexOf(phrase);
        if (idx !== -1) {
          foundPhrases.push({
            script: s,
            phrase,
            snippet: text.substring(Math.max(0, idx - 150), Math.min(text.length, idx + 250))
          });
        }
      }
    } catch (e) {
      console.error("Error fetching", s, e.message);
    }
  }

  console.log("=== Found Interesting APIs ===");
  console.log([...foundAPIs]);

  console.log(`=== Found ${foundPhrases.length} Phrase Snippets ===`);
  await fs.writeFile("./door_snippets.json", JSON.stringify(foundPhrases, null, 2));
  for (const p of foundPhrases.slice(0, 10)) {
    console.log(`\n--- [${p.phrase}] in ${p.script} ---`);
    console.log(p.snippet);
  }
}

main().catch(console.error);
