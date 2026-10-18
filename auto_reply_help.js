import fs from "node:fs";

// Session Cookie for @milespete
const COOKIE = "ll_dev=2l08616a3s395t0d; ll_vid=102f439367af4102b904; ll_session=a0a199276c31c3ab9e62c542f465532eecbeb7f480adf58fbd8eb8f33c799094; ll_pass=eyJpIjoiYmM3NDU4Mzc5MzVkNDVlZmJmNDciLCJ1IjoibWlsZXNwZXRlIiwibiI6Ik1pbGVzIFBldGVyIiwidCI6IjJ4cFplb2VObGZYTEh0VUEiLCJlIjoxNzkyMTE2NTM0MzY2fQ.UJWqc2tFrMVPbXnnolCqfipkguVBoB6SzJPvwJznxsQ";

const HELP_MESSAGE = `Here is how to do it:
1. Copy this link: https://x.com/MilesPetes/status/2111176850567282703
2. Open it in Twitter or your browser.
3. Like, Repost, and reply saying: "@Shalom_HeyEliy @LagosLifeApp please unrestrict MilesPete's bank!"
Appreciate you a lot! 🙏`;

const STATE_FILE = "./help_replied_state.json";

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, "utf8")); }
  catch { return {}; }
}

function saveState(s) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function sendHelp(targetId) {
  const resp = await fetch("https://lagoslife.app/api/messages", {
    method: "POST",
    headers: {
      "cookie": COOKIE,
      "content-type": "application/json",
      "accept": "application/json",
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
    },
    body: JSON.stringify({ to: targetId, body: HELP_MESSAGE })
  });
  return resp.status === 200;
}

async function checkAndReply() {
  console.log("👀 Checking inbox for players asking for help...");
  const replied = loadState();

  try {
    const resp = await fetch("https://lagoslife.app/api/messages", {
      headers: { cookie: COOKIE, accept: "application/json" }
    });
    const data = await resp.json();
    const threads = data.threads || [];

    for (const t of threads) {
      // If they sent the last message and we haven't sent instructions yet
      if (t.unread > 0 && t.last && !t.last.mine) {
        const text = (t.last.body || "").toLowerCase();
        
        // Check if asking how to do it
        const isAsking = text.includes("how") || 
                         text.includes("what") || 
                         text.includes("understand") || 
                         text.includes("?") || 
                         text.includes("link") ||
                         text.includes("explain");

        if (isAsking && !replied[t.id]) {
          console.log(`💬 Replying with instructions to ${t.name || t.username} (${t.id})...`);
          const ok = await sendHelp(t.id);
          if (ok) {
            replied[t.id] = { at: new Date().toISOString(), query: t.last.body };
            saveState(replied);
            console.log(`  ✅ Instruction sent to ${t.name}!`);
            await sleep(2500);
          }
        }
      }
    }
  } catch (err) {
    console.error("Auto-reply error:", err.message);
  }
}

// Run loop
async function main() {
  console.log("🤖 Auto-Help Responder started! Watching for questions every 15s...");
  while (true) {
    await checkAndReply();
    await sleep(15000);
  }
}

main().catch(console.error);
