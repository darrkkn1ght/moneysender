import fs from "node:fs/promises";

// Use a fresh cookie - we'll need the user to update this
const COOKIE = "ll_vid=e2c5139529b14929bd43; ll_session=778892b94ea1f4c36ffde880a8bc6ea0bbd0618c651b69fe4659bcf488de52b8; ll_dev=165o5s0h0y6i4x6k; ll_pass=eyJpIjoiYmM3NDU4Mzc5MzVkNDVlZmJmNDciLCJ1IjoibWlsZXNwZXRlIiwibiI6Ik1pbGVzIFBldGVyIiwidCI6IlRVVkdqWXdLU3MyaFI5VEYiLCJlIjoxNzkxNTQ0ODQ4MTAzfQ.oxLDmu3-MgFQ7M1ybgW20DshT9nixQa9uwb_kI_m1V8";

const BASE = "https://lagoslife.app/api";
const BASE2 = "https://lagoslife.eliysites.com/api";

// Try all possible Whot/game-related endpoints
const ENDPOINTS = [
  // Direct game endpoints
  { path: "/whot", method: "GET" },
  { path: "/whot/state", method: "GET" },
  { path: "/whot/play", method: "GET" },
  { path: "/game", method: "GET" },
  { path: "/game/whot", method: "GET" },
  { path: "/games", method: "GET" },
  { path: "/play", method: "GET" },
  { path: "/cards", method: "GET" },
  { path: "/snooker", method: "GET" },
  // World endpoint (seen in network tab screenshot)  
  { path: "/world", method: "GET" },
  { path: "/world", method: "POST", body: {} },
  // Save state (has game state)
  { path: "/save", method: "GET" },
  // Venue / location endpoints  
  { path: "/venue", method: "GET" },
  { path: "/venue", method: "POST", body: { id: "ojuelegba" } },
  { path: "/venue", method: "POST", body: { id: "snookerSpot" } },
  // Action endpoints
  { path: "/action", method: "GET" },
  { path: "/action", method: "POST", body: { action: "playSnooker" } },
  { path: "/action", method: "POST", body: { action: "playWhot" } },
  // Multiplayer endpoints
  { path: "/match", method: "GET" },
  { path: "/match/whot", method: "GET" },
  { path: "/challenge", method: "GET" },
  // Politics
  { path: "/politics", method: "GET" },
  // Music
  { path: "/music", method: "GET" },
];

async function probe(base) {
  console.log(`\n========= Probing ${base} =========\n`);
  const results = {};

  for (const ep of ENDPOINTS) {
    const url = `${base}${ep.path}`;
    try {
      const opts = {
        method: ep.method,
        headers: {
          "accept": "application/json",
          "content-type": "application/json",
          "cookie": COOKIE,
          "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
        }
      };
      if (ep.body) opts.body = JSON.stringify(ep.body);

      const resp = await fetch(url, opts);
      const ct = resp.headers.get("content-type") || "";
      let data;
      if (ct.includes("json")) {
        data = await resp.json();
      } else {
        const txt = await resp.text();
        data = txt.substring(0, 300);
      }

      const summary = typeof data === "object" ? JSON.stringify(data).substring(0, 200) : String(data).substring(0, 200);
      const status = resp.status;
      
      if (status === 200 || status === 201) {
        console.log(`✅ [${status}] ${ep.method} ${ep.path} => ${summary}`);
      } else if (status === 405 || status === 400) {
        console.log(`⚠️  [${status}] ${ep.method} ${ep.path} => ${summary}`);
      } else {
        console.log(`❌ [${status}] ${ep.method} ${ep.path}`);
      }

      results[`${ep.method} ${ep.path}`] = { status, data };
    } catch (err) {
      console.log(`💥 [ERR] ${ep.method} ${ep.path}: ${err.message}`);
    }
  }
  return results;
}

async function main() {
  console.log("===================================================");
  console.log("  WHOT GAME API DISCOVERY - LagosLife");
  console.log("===================================================");

  const r1 = await probe(BASE);
  const r2 = await probe(BASE2);

  const combined = { lagoslife_app: r1, eliysites: r2 };
  await fs.writeFile("./whot_discovery.json", JSON.stringify(combined, null, 2));
  console.log("\n✅ Results saved to whot_discovery.json");
}

main().catch(console.error);
