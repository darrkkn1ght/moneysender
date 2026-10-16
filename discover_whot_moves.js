import fs from "node:fs/promises";

const COOKIE = "ll_vid=e2c5139529b14929bd43; ll_session=778892b94ea1f4c36ffde880a8bc6ea0bbd0618c651b69fe4659bcf488de52b8; ll_dev=165o5s0h0y6i4x6k; ll_pass=eyJpIjoiYmM3NDU4Mzc5MzVkNDVlZmJmNDciLCJ1IjoibWlsZXNwZXRlIiwibiI6Ik1pbGVzIFBldGVyIiwidCI6IlRVVkdqWXdLU3MyaFI5VEYiLCJlIjoxNzkxNTQ0ODQ4MTAzfQ.oxLDmu3-MgFQ7M1ybgW20DshT9nixQa9uwb_kI_m1V8";

const BASE = "https://lagoslife.app/api";

// First, get the active game state
async function apiCall(path, method = "GET", body = null) {
  const opts = {
    method,
    headers: {
      "accept": "application/json",
      "content-type": "application/json",
      "cookie": COOKIE,
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
    }
  };
  if (body) opts.body = JSON.stringify(body);
  
  const resp = await fetch(`${BASE}${path}`, opts);
  const ct = resp.headers.get("content-type") || "";
  let data;
  if (ct.includes("json")) {
    data = await resp.json();
  } else {
    data = (await resp.text()).substring(0, 300);
  }
  return { status: resp.status, data };
}

async function main() {
  console.log("====================================");
  console.log("  WHOT GAME MOVE API DISCOVERY");
  console.log("====================================\n");

  // Step 1: Get current games
  console.log("1. Fetching /api/games ...");
  const gamesResp = await apiCall("/games");
  if (gamesResp.status !== 200) {
    console.log("❌ Failed to get games:", gamesResp.status);
    return;
  }

  const activeGame = gamesResp.data.mine?.find(g => g.status === "playing");
  if (!activeGame) {
    console.log("No active Whot game found.");
    console.log("Available games:", JSON.stringify(gamesResp.data.mine?.map(g => ({
      id: g.id, status: g.status, game: g.game, result: g.result
    })), null, 2));
    return;
  }

  console.log(`\n✅ Active game found: ${activeGame.id}`);
  console.log(`   Opponent: ${activeGame.seats[0].username} vs ${activeGame.seats[1].username}`);
  console.log(`   My seat: ${activeGame.me}`);
  console.log(`   Current turn: ${activeGame.state.turn} (0-indexed seat)`);
  console.log(`   My hand: ${JSON.stringify(activeGame.state.hand)}`);
  console.log(`   Counts: ${JSON.stringify(activeGame.state.counts)}`);
  console.log(`   Market left: ${activeGame.state.marketN}`);
  console.log(`   Top of pile: ${JSON.stringify(activeGame.state.pile)}`);
  console.log(`   Last move: ${JSON.stringify(activeGame.state.last)}`);
  console.log(`   Need (called shape): ${activeGame.state.need}`);
  console.log(`   Pick cards: ${activeGame.state.pick}`);
  console.log(`   Moves so far: ${activeGame.state.moves}`);
  
  const GAME_ID = activeGame.id;
  
  // Step 2: Probe all possible move endpoints
  console.log("\n\n2. Probing possible play/move endpoints...\n");
  
  const probes = [
    // POST /games with game ID
    { path: `/games`, method: "POST", body: { id: GAME_ID, action: "play", card: activeGame.state.hand[0] } },
    { path: `/games`, method: "PUT", body: { id: GAME_ID, action: "play", card: activeGame.state.hand[0] } },
    { path: `/games`, method: "PATCH", body: { id: GAME_ID, action: "play", card: activeGame.state.hand[0] } },
    
    // POST /games/:id  
    { path: `/games/${GAME_ID}`, method: "GET" },
    { path: `/games/${GAME_ID}`, method: "POST", body: { action: "play", card: activeGame.state.hand[0] } },
    { path: `/games/${GAME_ID}`, method: "PUT", body: { action: "play", card: activeGame.state.hand[0] } },
    
    // POST /games/play
    { path: `/games/play`, method: "POST", body: { id: GAME_ID, card: activeGame.state.hand[0] } },
    
    // POST /games/move
    { path: `/games/move`, method: "POST", body: { id: GAME_ID, card: activeGame.state.hand[0] } },
    
    // POST /games/draw (go to market)
    { path: `/games/draw`, method: "POST", body: { id: GAME_ID } },
    
    // POST /games with different body shapes
    { path: `/games`, method: "POST", body: { game: GAME_ID, play: activeGame.state.hand[0] } },
    { path: `/games`, method: "POST", body: { game: GAME_ID, move: "draw" } },
    { path: `/games`, method: "POST", body: { game: GAME_ID, card: activeGame.state.hand[0], v: activeGame.v } },
    
    // POST /games with seat info
    { path: `/games`, method: "POST", body: { id: GAME_ID, seat: activeGame.me, card: activeGame.state.hand[0], v: activeGame.v } },
    
    // POST with just game ID
    { path: `/games`, method: "POST", body: { id: GAME_ID } },
    
    // POST /games with draw action
    { path: `/games`, method: "POST", body: { id: GAME_ID, action: "draw" } },
    
    // POST /games with market action
    { path: `/games`, method: "POST", body: { id: GAME_ID, action: "market" } },
  ];
  
  const results = {};
  
  for (const p of probes) {
    try {
      const bodyStr = p.body ? ` body=${JSON.stringify(p.body)}` : "";
      const r = await apiCall(p.path, p.method, p.body);
      const summary = typeof r.data === "object" ? JSON.stringify(r.data).substring(0, 200) : String(r.data).substring(0, 200);
      
      if (r.status === 200 || r.status === 201) {
        console.log(`✅ [${r.status}] ${p.method} ${p.path}${bodyStr}`);
        console.log(`   => ${summary}`);
      } else if (r.status === 400 || r.status === 405 || r.status === 422) {
        console.log(`⚠️  [${r.status}] ${p.method} ${p.path}${bodyStr} => ${summary}`);
      } else {
        console.log(`❌ [${r.status}] ${p.method} ${p.path}`);
      }
      
      results[`${p.method} ${p.path} ${JSON.stringify(p.body || {})}`] = r;
    } catch (err) {
      console.log(`💥 [ERR] ${p.method} ${p.path}: ${err.message}`);
    }
  }
  
  await fs.writeFile("./whot_move_discovery.json", JSON.stringify(results, null, 2));
  console.log("\n✅ Results saved to whot_move_discovery.json");
}

main().catch(console.error);
