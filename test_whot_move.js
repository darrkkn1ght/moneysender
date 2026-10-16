const COOKIE = "ll_vid=e2c5139529b14929bd43; ll_session=778892b94ea1f4c36ffde880a8bc6ea0bbd0618c651b69fe4659bcf488de52b8; ll_dev=165o5s0h0y6i4x6k; ll_pass=eyJpIjoiYmM3NDU4Mzc5MzVkNDVlZmJmNDciLCJ1IjoibWlsZXNwZXRlIiwibiI6Ik1pbGVzIFBldGVyIiwidCI6IlRVVkdqWXdLU3MyaFI5VEYiLCJlIjoxNzkxNTQ0ODQ4MTAzfQ.oxLDmu3-MgFQ7M1ybgW20DshT9nixQa9uwb_kI_m1V8";

const BASE = "https://lagoslife.app/api";

async function api(path, method, body) {
  const opts = {
    method,
    headers: { "accept": "application/json", "content-type": "application/json", "cookie": COOKIE, "user-agent": "Mozilla/5.0" }
  };
  if (body) opts.body = JSON.stringify(body);
  const resp = await fetch(`${BASE}${path}`, opts);
  const ct = resp.headers.get("content-type") || "";
  let data;
  if (ct.includes("json")) data = await resp.json();
  else data = (await resp.text()).substring(0, 500);
  return { status: resp.status, data };
}

async function main() {
  // Check if there's an open table from the rematch we created
  console.log("1. Checking for open/active tables...\n");
  const g = await api("/games", "GET");
  
  for (const game of (g.data.mine || [])) {
    console.log(`Game ${game.id}:`);
    console.log(`  Status: ${game.status}`);
    console.log(`  Turn: ${game.state?.turn}, My seat: ${game.me}`);
    console.log(`  Hand: ${JSON.stringify(game.state?.hand)}`);
    console.log(`  Pile top: ${JSON.stringify(game.state?.pile?.slice(-1))}`);
    console.log(`  Counts: ${JSON.stringify(game.state?.counts)}`);
    console.log(`  V: ${game.v}`);
    console.log("");
  }
  
  // Find any game where it's our turn
  const active = g.data.mine?.find(x => x.status === "playing" && x.state?.turn === x.me);
  if (!active) {
    const anyPlaying = g.data.mine?.find(x => x.status === "playing");
    if (anyPlaying) {
      console.log(`\nFound active game ${anyPlaying.id} but it's opponent's turn (turn=${anyPlaying.state.turn}, me=${anyPlaying.me})`);
      console.log("Trying to make a move anyway to see the error message...\n");
      
      const r = await api("/games", "POST", { action: "move", id: anyPlaying.id, card: anyPlaying.state.hand[0] });
      console.log(`Move attempt: [${r.status}] ${JSON.stringify(r.data).substring(0, 500)}`);
      
      // Try draw
      const r2 = await api("/games", "POST", { action: "move", id: anyPlaying.id, draw: true });
      console.log(`Draw attempt: [${r2.status}] ${JSON.stringify(r2.data).substring(0, 500)}`);
      
      // Try with just card in different format
      const r3 = await api("/games", "POST", { action: "move", id: anyPlaying.id, card: anyPlaying.state.hand[0], v: anyPlaying.v });
      console.log(`Move+v attempt: [${r3.status}] ${JSON.stringify(r3.data).substring(0, 500)}`);

      return;
    }
    
    console.log("\nNo playing game found. Let's join the rematch or create new...");
    
    // Try to start the open table
    const openTable = g.data.mine?.find(x => x.status === "open");
    if (openTable) {
      console.log(`Found open table: ${openTable.id}`);
      // Wait for opponent to join... or create a new game
    }
    return;
  }
  
  console.log(`\n=== IT'S OUR TURN! Game: ${active.id} ===`);
  console.log(`Hand: ${JSON.stringify(active.state.hand)}`);
  console.log(`Top card: ${active.state.pile[active.state.pile.length - 1]}`);
  
  // Try to play first card
  const cardToPlay = active.state.hand[0];
  console.log(`\nTrying to play card ${cardToPlay}...`);
  
  const r = await api("/games", "POST", { action: "move", id: active.id, card: cardToPlay });
  console.log(`[${r.status}] ${JSON.stringify(r.data).substring(0, 500)}`);
  
  if (r.status !== 200) {
    // Try different card
    console.log("\nTrying draw instead...");
    const r2 = await api("/games", "POST", { action: "move", id: active.id });
    console.log(`[${r2.status}] ${JSON.stringify(r2.data).substring(0, 500)}`);
  }
}

main().catch(console.error);
