import fs from "node:fs";

const ACCOUNTS = [
  {
    name: "@milespete",
    cookie: "ll_dev=2l08616a3s395t0d; ll_vid=102f439367af4102b904; ll_session=7905085c7b02a4e840a338dd3484f8995d019cd955fdf7d8f1c2a7ba846d1ee0; ll_pass=eyJpIjoiYmM3NDU4Mzc5MzVkNDVlZmJmNDciLCJ1IjoibWlsZXNwZXRlIiwibiI6Ik1pbGVzIFBldGVyIiwidCI6IlJPZXdwcjRWTlVNRE9uLUkiLCJlIjoxNzkyMzY2MDU0ODUyfQ.GmMw-OxO6rh4lp4QjBOW6tF7xm76FZBoSBhsD381IZY"
  },
  {
    name: "mr_who",
    cookie: "ll_dev=0u144y403y0n5o4c; ll_session=30ed25151a51189b01b77ec860906bcf4ff53eef06599f910f94fa3b4f329fba; ll_pass=eyJpIjoiZDRmNGFlZDk0ZDZlNDkxOTg5Y2YiLCJ1IjoibXJfd2hvIiwibiI6Iklka3dldHVsbWEiLCJ0IjoicHdjNFB1U3R0M2ROZ0ZkVCIsImUiOjE3OTIzNzQ0Nzg5NDd9.n3er-Yhh5QKWtVnl12SnIDGNgYt6MHD1P1qv0uuRJng"
  }
];

const BASE_URL = "https://lagoslife.app/api/messages";
const STATE_FILE = "./broadcast_online_state.json";
const LOG_FILE = "./broadcast_online.log";

const TWEET_URL = "https://x.com/MilesPetes/status/2111992409471234292?s=20";
const MESSAGE_TEMPLATE = "Hey {name}! 🎉 Tonight's house party was lit! Please take a quick second to like and retweet this post about tonight: " + TWEET_URL + " - really appreciate the love and support! 🙏❤️";

function log(msg) {
  const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
  console.log(line);
  try {
    fs.appendFileSync(LOG_FILE, line + "\n");
  } catch {}
}

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {
    return { sent: {}, failed: {} };
  }
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fetchOnlineThreads(cookie) {
  try {
    const res = await fetch("https://lagoslife.app/api/messages", {
      headers: { cookie }
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.threads || []).filter(t => t.online === true && t.id);
  } catch {
    return [];
  }
}

async function sendMessage(targetId, body, cookie) {
  try {
    const resp = await fetch(BASE_URL, {
      method: "POST",
      headers: {
        "accept": "application/json",
        "content-type": "application/json",
        "cookie": cookie,
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
      },
      body: JSON.stringify({ to: targetId, body })
    });
    const data = await resp.json().catch(() => ({}));
    return { status: resp.status, data };
  } catch (err) {
    return { status: 0, error: err.message };
  }
}

export async function runOnlineBroadcast() {
  log("==================================================");
  log("🟢 LIVE ONLINE BROADCAST MONITOR");
  log("   Filtering strictly for ONLINE active players");
  log("==================================================");

  const state = loadState();

  for (const acc of ACCOUNTS) {
    log(`📡 Fetching currently online players for ${acc.name}...`);
    const onlineThreads = await fetchOnlineThreads(acc.cookie);
    log(`   Found ${onlineThreads.length} currently online players in ${acc.name}'s chat.`);

    for (const thread of onlineThreads) {
      const targetId = thread.id;
      const name = (thread.name || thread.username || "friend").replace(/^@/, "");

      if (state.sent[targetId]) {
        continue;
      }

      const body = MESSAGE_TEMPLATE.replace(/\{name\}/gi, name);
      log(`   [ONLINE] Sending tweet invite to ${name} (${targetId})...`);

      const res = await sendMessage(targetId, body, acc.cookie);
      if (res.status === 200) {
        state.sent[targetId] = {
          sentAt: new Date().toISOString(),
          name,
          sender: acc.name,
          online: true
        };
        saveState(state);
        log(`     ✅ Sent to online player ${name}!`);
        await sleep(2500);
      } else if (res.status === 429) {
        log(`     ⏳ Rate limited. Waiting 5s...`);
        await sleep(5000);
      } else {
        log(`     ⚠️ Failed (${res.status}): ${JSON.stringify(res.data || res.error)}`);
      }
    }
  }

  log(`🎉 Online broadcast scan complete. Total unique online players messaged: ${Object.keys(state.sent).length}`);
}

if (process.argv[1]?.includes("broadcast_online_only.js")) {
  runOnlineBroadcast().catch(console.error);
}
