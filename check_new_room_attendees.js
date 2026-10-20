import fs from "node:fs/promises";

const COOKIE = "ll_dev=2l08616a3s395t0d; ll_vid=102f439367af4102b904; ll_session=7905085c7b02a4e840a338dd3484f8995d019cd955fdf7d8f1c2a7ba846d1ee0; ll_pass=eyJpIjoiYmM3NDU4Mzc5MzVkNDVlZmJmNDciLCJ1IjoibWlsZXNwZXRlIiwibiI6Ik1pbGVzIFBldGVyIiwidCI6IlJPZXdwcjRWTlVNRE9uLUkiLCJlIjoxNzkyNDA0OTAyODk1fQ.wyQw5T4rXT32ZYfwVpvzddrsOPc4qM50CFHT6W-awrQ";

async function main() {
  const res = await fetch("https://lagoslife.app/api/room?host=bc745837935d45efbf47&since=0", {
    headers: { cookie: COOKIE, accept: "application/json", "user-agent": "Mozilla/5.0" }
  });
  const data = await res.json();
  const msgs = data.messages || [];
  console.log(`Total messages in party room: ${msgs.length}`);
  
  const roomUsers = new Map();
  for (const m of msgs) {
    if (m.from && m.from !== "bc745837935d45efbf47") {
      roomUsers.set(m.from, { id: m.from, username: m.username || "" });
    }
  }

  console.log(`Unique users who chatted in party room: ${roomUsers.size}`);
  for (const u of roomUsers.values()) {
    console.log(`- @${u.username} (${u.id})`);
  }

  // Also check batch_party_guests_state.json
  const batchState = JSON.parse(await fs.readFile("./batch_party_guests_state.json", "utf8"));
  const sentSet = new Set(batchState.completed);
  console.log(`\nAlready sent or currently queued: ${sentSet.size}`);

  const newUsers = [...roomUsers.values()].filter(u => !sentSet.has(u.id));
  console.log(`\n🆕 NEW USERS TO REWARD: ${newUsers.length}`);
  console.log(newUsers);
}

main();
