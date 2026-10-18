import fs from "node:fs";

const COOKIE_MILES = "ll_dev=2l08616a3s395t0d; ll_vid=102f439367af4102b904; ll_session=7905085c7b02a4e840a338dd3484f8995d019cd955fdf7d8f1c2a7ba846d1ee0; ll_pass=eyJpIjoiYmM3NDU4Mzc5MzVkNDVlZmJmNDciLCJ1IjoibWlsZXNwZXRlIiwibiI6Ik1pbGVzIFBldGVyIiwidCI6IlJPZXdwcjRWTlVNRE9uLUkiLCJlIjoxNzkyMTkxNzM5MDAyfQ.B_AravqWaFLL7xITuYZWd4NqV1qt7oTQkdfm1Wh8GfA";

const DELAY_MS = 2500;
const STATE_FILE = "./smart_reply_state.json";

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, "utf8")); }
  catch { return {}; }
}
function saveState(s) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function sendMessage(targetId, body) {
  try {
    const resp = await fetch("https://lagoslife.app/api/messages", {
      method: "POST",
      headers: {
        "accept": "application/json",
        "content-type": "application/json",
        "cookie": COOKIE_MILES,
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
      },
      body: JSON.stringify({ to: targetId, body })
    });
    return resp.status === 200;
  } catch {
    return false;
  }
}

async function run() {
  const r = await fetch("https://lagoslife.app/api/messages", {
    headers: { cookie: COOKIE_MILES, accept: "application/json" }
  });
  const data = await r.json();
  const threads = data.threads || [];
  const state = loadState();

  const unreplied = threads.filter(t => t.last && !t.last.mine && !state[t.id]);
  console.log(`Found ${unreplied.length} unreplied incoming conversations.`);

  let count = 0;

  for (const t of unreplied) {
    const targetId = t.id;
    const name = t.name || t.username || "Friend";
    const msg = (t.last.body || "").toLowerCase();

    let replyText = "";

    // 1. Confirmed / sent proof
    if (msg.includes("done") || msg.includes("tweet") || msg.includes("repost") || msg.includes("x.com") || msg.includes("twitter.com") || msg.includes("did it") || msg.includes("helped")) {
      replyText = `Thank you so much for the support on Twitter, ${name}! 🙏 I see you! The 1B is queued to be sent directly from @blaqsebastian once the server email verification clears! Keep helping me retweet and tag them so we get unbanned fast! 💪`;
    }
    // 2. Questions / how to do it
    else if (msg.includes("how") || msg.includes("what") || msg.includes("link") || msg.includes("explain") || msg.includes("understand") || msg.includes("?")) {
      replyText = `Here is how to get your ₦1B, ${name}:
1. Copy this link: https://x.com/MilesPetes/status/2111176850567282703
2. Open it in Twitter/X
3. Like, Repost, and reply: @Shalom_HeyEliy @LagosLifeApp please unrestrict MilesPete!
4. Reply back here with 'Done' and receive your 1B from @blaqsebastian! 🙏`;
    }
    // 3. Greetings / begging / general replies
    else {
      replyText = `Hey ${name}! My account is temporarily restricted to ₦10m a day so I can't send big cash directly right now 😭 But you can earn ₦1 BILLION right now from @blaqsebastian if you help me on Twitter! 

Just Like & Repost: https://x.com/MilesPetes/status/2111176850567282703 and reply tagging @Shalom_HeyEliy @LagosLifeApp to unrestrict MilesPete! Reply 'Done' when finished! 🙏`;
    }

    count++;
    console.log(`[#${count}/${unreplied.length}] Replying to ${name} (@${t.username || targetId})...`);
    const ok = await sendMessage(targetId, replyText);

    if (ok) {
      console.log(`  ✅ Sent!`);
      state[targetId] = { at: new Date().toISOString(), reply: replyText.substring(0, 50) + "..." };
      saveState(state);
      await sleep(DELAY_MS);
    } else {
      console.log(`  ⚠️ Failed to send to ${name}`);
    }
  }

  console.log(`\n🎉 Finished replying to all ${count} incoming messages!`);
}

run().catch(console.error);
