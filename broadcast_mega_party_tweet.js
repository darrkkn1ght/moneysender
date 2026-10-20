import fs from "node:fs";

// Accounts available for broadcasting
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
const RECIPIENTS_FILE = "./mega_contacts_list.json";
const STATE_FILE = "./mega_broadcast_state.json";
const LOG_FILE = "./mega_broadcast.log";

const DELAY_MS = 2500;
const RETRY_DELAY_MS = 5000;

const TWEET_URL = "https://x.com/MilesPetes/status/2111992409471234292?s=20";
const MESSAGE_TEMPLATE = "Hey {name}! 🎉 Tonight's house party was lit! Please take a quick second to like and retweet this post about tonight: " + TWEET_URL + " - really appreciate the love and support! 🙏❤️";

function log(msg) {
  const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
  console.log(line);
  try {
    fs.appendFileSync(LOG_FILE, line + "\n");
  } catch {}
}

function loadRecipients() {
  try {
    return JSON.parse(fs.readFileSync(RECIPIENTS_FILE, "utf8"));
  } catch {
    return [];
  }
}

function loadState() {
  try {
    const s = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    if (!s.sent) s.sent = {};
    if (!s.failed) s.failed = {};
    return s;
  } catch {
    // Import already sent messages from previous broadcast run
    const prev = {};
    try {
      const p = JSON.parse(fs.readFileSync("./broadcast_party_tweet_state.json", "utf8"));
      if (p.sent) Object.assign(prev, p.sent);
    } catch {}
    return { sent: prev, failed: {} };
  }
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

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

export async function main() {
  const recipients = loadRecipients();
  const state = loadState();

  log("==================================================");
  log("🚀 MEGA BROADCAST SENDER — LAGOSLIFE");
  log(`   Total Contacts in Database: ${recipients.length}`);
  log(`   Already Contacted: ${Object.keys(state.sent).length}`);
  log(`   Active Senders: ${ACCOUNTS.map(a => a.name).join(", ")}`);
  log("==================================================");

  let accIdx = 0;
  let newSent = 0;

  for (let i = 0; i < recipients.length; i++) {
    const r = recipients[i];
    const targetId = r.id;
    const name = (r.name || "friend").replace(/^@/, "");

    if (state.sent[targetId]) continue;

    const account = ACCOUNTS[accIdx % ACCOUNTS.length];
    const body = MESSAGE_TEMPLATE.replace(/\{name\}/gi, name);

    let attempts = 0;
    let success = false;

    while (!success && attempts < 2) {
      attempts++;
      log(`[${i + 1}/${recipients.length}] [${account.name}] Sending to ${name} (${targetId})...`);

      const res = await sendMessage(targetId, body, account.cookie);

      if (res.status === 200) {
        success = true;
        newSent++;
        state.sent[targetId] = {
          sentAt: new Date().toISOString(),
          name,
          sender: account.name,
          msgId: res.data.id || "ok"
        };
        saveState(state);
        log(`   ✅ Sent! (Total sent: ${Object.keys(state.sent).length})`);
        accIdx++;
        await sleep(DELAY_MS);
      } else if (res.status === 429) {
        log(`   ⏳ Rate limited on ${account.name}. Switching account / waiting 5s...`);
        accIdx++;
        await sleep(RETRY_DELAY_MS);
      } else if (res.status === 403) {
        // Player blocks incoming DMs from non-friends
        log(`   ⏩ Player has DMs restricted (403). Moving to next.`);
        state.failed[targetId] = { error: "DMs restricted", status: 403 };
        saveState(state);
        break;
      } else if (res.status === 422) {
        // Link restriction on first message for this player
        log(`   ⏩ Link restricted (422). Moving to next.`);
        state.failed[targetId] = { error: "Link restricted", status: 422 };
        saveState(state);
        break;
      } else {
        log(`   ❌ Failed (${res.status}): ${JSON.stringify(res.data || res.error)}`);
        state.failed[targetId] = { error: res.data || res.error, status: res.status };
        saveState(state);
        break;
      }
    }
  }

  log(`\n🎉 Mega broadcast completed! Sent ${newSent} new messages.`);
}

if (process.argv[1]?.includes("broadcast_mega_party_tweet.js")) {
  main().catch(console.error);
}
