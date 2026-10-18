import fs from "node:fs";

const COOKIE_MILES = "ll_dev=2l08616a3s395t0d; ll_vid=102f439367af4102b904; ll_session=7905085c7b02a4e840a338dd3484f8995d019cd955fdf7d8f1c2a7ba846d1ee0; ll_pass=eyJpIjoiYmM3NDU4Mzc5MzVkNDVlZmJmNDciLCJ1IjoibWlsZXNwZXRlIiwibiI6Ik1pbGVzIFBldGVyIiwidCI6IlJPZXdwcjRWTlVNRE9uLUkiLCJlIjoxNzkyMTkxNzM5MDAyfQ.B_AravqWaFLL7xITuYZWd4NqV1qt7oTQkdfm1Wh8GfA";

async function check() {
  const r = await fetch("https://lagoslife.app/api/messages", {
    headers: { cookie: COOKIE_MILES, accept: "application/json" }
  });
  const data = await r.json();
  const threads = data.threads || [];
  
  let history = {};
  try {
    history = JSON.parse(fs.readFileSync("./automated_rewards_history.json", "utf8"));
  } catch {}

  const pendingDone = [];
  const questions = [];
  const generalReplies = [];

  for (const t of threads) {
    if (t.last && !t.last.mine) {
      const msg = t.last.body || "";
      const item = { 
        id: t.id, 
        name: t.name || t.username, 
        username: t.username || "unknown", 
        msg, 
        at: new Date(t.last.at).toLocaleTimeString(), 
        paid: Boolean(history[t.id]) 
      };
      const lower = msg.toLowerCase();

      if (lower.includes("done") || lower.includes("tweet") || lower.includes("helped") || lower.includes("did it") || lower.includes("repost") || lower.includes("liked")) {
        pendingDone.push(item);
      } else if (lower.includes("how") || lower.includes("what") || lower.includes("?") || lower.includes("link") || lower.includes("understand")) {
        questions.push(item);
      } else {
        generalReplies.push(item);
      }
    }
  }

  console.log("=== SUMMARY OF INCOMING REPLIES ===");
  console.log(`Confirmed / Claimed Done: ${pendingDone.length}`);
  console.log(`Questions / Need help: ${questions.length}`);
  console.log(`Other / General comments: ${generalReplies.length}\n`);

  console.log("--- CONFIRMED (PAID VS UNPAID) ---");
  for (const p of pendingDone) {
    console.log(`[${p.paid ? "PAID" : "UNPAID"}] ${p.name} (@${p.username}): "${p.msg}" (${p.at})`);
  }

  console.log("\n--- QUESTIONS (FIRST 15) ---");
  for (const q of questions.slice(0, 15)) {
    console.log(`- ${q.name} (@${q.username}): "${q.msg}" (${q.at})`);
  }

  console.log("\n--- GENERAL COMMENTS (FIRST 15) ---");
  for (const g of generalReplies.slice(0, 15)) {
    console.log(`- ${g.name} (@${g.username}): "${g.msg}" (${g.at})`);
  }
}

check().catch(console.error);
