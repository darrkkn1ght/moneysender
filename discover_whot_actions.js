const COOKIE = "ll_vid=e2c5139529b14929bd43; ll_session=778892b94ea1f4c36ffde880a8bc6ea0bbd0618c651b69fe4659bcf488de52b8; ll_dev=165o5s0h0y6i4x6k; ll_pass=eyJpIjoiYmM3NDU4Mzc5MzVkNDVlZmJmNDciLCJ1IjoibWlsZXNwZXRlIiwibiI6Ik1pbGVzIFBldGVyIiwidCI6IlRVVkdqWXdLU3MyaFI5VEYiLCJlIjoxNzkxNTQ0ODQ4MTAzfQ.oxLDmu3-MgFQ7M1ybgW20DshT9nixQa9uwb_kI_m1V8";

const BASE = "https://lagoslife.app/api";

async function api(path, method, body) {
  const opts = {
    method,
    headers: {
      "accept": "application/json",
      "content-type": "application/json",
      "cookie": COOKIE,
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
    }
  };
  if (body) opts.body = JSON.stringify(body);
  const resp = await fetch(`${BASE}${path}`, opts);
  const ct = resp.headers.get("content-type") || "";
  let data;
  if (ct.includes("json")) data = await resp.json();
  else data = (await resp.text()).substring(0, 300);
  return { status: resp.status, data };
}

async function main() {
  // Get active game
  const g = await api("/games", "GET");
  const active = g.data.mine?.find(x => x.status === "playing");
  if (!active) { console.log("No active game"); return; }
  
  const GAME_ID = active.id;
  const hand = active.state.hand;
  const topCard = active.state.pile[active.state.pile.length - 1];
  
  console.log(`Game: ${GAME_ID}`);
  console.log(`My seat: ${active.me}, Turn: ${active.state.turn}`);
  console.log(`Hand: ${hand}, Top: ${topCard}`);
  console.log(`Last: ${JSON.stringify(active.state.last)}`);
  console.log(`V: ${active.v}`);
  console.log("");

  // The key insight: POST /games returns "Unknown action"
  // This means "action" is a recognized field but the value is wrong.
  // Let's try all possible action names.
  
  const actions = [
    // Play card actions
    "playCard", "card", "put", "putCard", "throw", "throwCard", "placeCard",
    "whot", "playWhot", "checkUp", "check",
    // Draw actions  
    "drawCard", "pickup", "pickUp", "pick", "goMarket", "goToMarket",
    // Game management
    "join", "create", "start", "leave", "quit", "forfeit", "resign",
    "challenge", "accept", "decline", "rematch", 
    // Whot-specific
    "call", "callCard", "lastCard", "checkup",
    // Simple verbs
    "move", "turn", "pass", "skip",
  ];
  
  console.log("--- Testing action names on POST /games ---\n");
  
  for (const action of actions) {
    const r = await api("/games", "POST", { action, id: GAME_ID, card: hand[0] });
    const msg = typeof r.data === "object" ? JSON.stringify(r.data) : r.data;
    if (msg !== '{"error":"Unknown action"}' && r.status !== 404) {
      console.log(`🔥 [${r.status}] action="${action}" => ${msg.substring(0, 200)}`);
    }
  }
  
  // Also try without 'action' field, using different field names as the action identifier
  console.log("\n--- Testing different body shapes ---\n");
  
  const shapes = [
    { type: "play", id: GAME_ID, card: hand[0] },
    { type: "draw", id: GAME_ID },
    { kind: "play", id: GAME_ID, card: hand[0] },
    { kind: "draw", id: GAME_ID },
    { op: "play", id: GAME_ID, card: hand[0] },
    { op: "draw", id: GAME_ID },
    { cmd: "play", id: GAME_ID, card: hand[0] },
    { do: "play", id: GAME_ID, card: hand[0] },
    { id: GAME_ID, card: hand[0] },  // implicit play
    { id: GAME_ID, draw: true },     // implicit draw
    { id: GAME_ID, market: true },   // go to market
    { game: GAME_ID, action: "play", card: hand[0] },
    { gameId: GAME_ID, action: "play", card: hand[0] },
    { action: "join", id: GAME_ID },
    { action: "join", game: "whot", place: "ojuelegba", stake: 5000000 },
  ];
  
  for (const body of shapes) {
    const r = await api("/games", "POST", body);
    const msg = typeof r.data === "object" ? JSON.stringify(r.data) : r.data;
    if (msg !== '{"error":"Unknown action"}' && r.status !== 404) {
      console.log(`🔥 [${r.status}] body=${JSON.stringify(body)} => ${msg.substring(0, 200)}`);
    }
  }
  
  // Also try different HTTP methods to /games
  console.log("\n--- Testing DELETE/OPTIONS ---\n");
  const d = await api("/games", "DELETE", { id: GAME_ID });
  console.log(`DELETE /games: [${d.status}] ${JSON.stringify(d.data).substring(0, 200)}`);
  
  // Try OPTIONS to see allowed methods
  try {
    const o = await fetch(`${BASE}/games`, { method: "OPTIONS" });
    console.log(`OPTIONS /games: [${o.status}] Allow: ${o.headers.get("allow")}`);
  } catch (e) {
    console.log(`OPTIONS error: ${e.message}`);
  }
}

main().catch(console.error);
