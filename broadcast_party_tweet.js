import fs from "node:fs";

// Active session cookie for @milespete
const COOKIE_MILES = "ll_dev=2l08616a3s395t0d; ll_vid=102f439367af4102b904; ll_session=7905085c7b02a4e840a338dd3484f8995d019cd955fdf7d8f1c2a7ba846d1ee0; ll_pass=eyJpIjoiYmM3NDU4Mzc5MzVkNDVlZmJmNDciLCJ1IjoibWlsZXNwZXRlIiwibiI6Ik1pbGVzIFBldGVyIiwidCI6IlJPZXdwcjRWTlVNRE9uLUkiLCJlIjoxNzkyMzY2MDU0ODUyfQ.GmMw-OxO6rh4lp4QjBOW6tF7xm76FZBoSBhsD381IZY";

const BASE_URL = "https://lagoslife.app/api/messages";
const RECIPIENTS_FILE = "./all_contacts_combined.json";
const STATE_FILE = "./broadcast_party_tweet_state.json";
const LOG_FILE = "./broadcast_party_tweet.log";

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
    const raw = JSON.parse(fs.readFileSync(RECIPIENTS_FILE, "utf8"));
    const seen = new Set();
    const unique = [];
    for (const r of raw) {
      if (r.id && !seen.has(r.id)) {
        seen.add(r.id);
        unique.push(r);
      }
    }
    return unique;
  } catch (err) {
    console.error("Failed to load recipients:", err.message);
    return [];
  }
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

export async function broadcast(cookie = COOKIE_MILES, senderName = "@milespete") {
  const recipients = loadRecipients();
  const state = loadState();

  log(`📢 Starting broadcast campaign from ${senderName} to ${recipients.length} contacts...`);
  log(`🔗 Tweet: ${TWEET_URL}`);

  let sentCount = 0;
  for (let i = 0; i < recipients.length; i++) {
    const r = recipients[i];
    const targetId = r.id;
    const name = (r.name || r.username || "friend").replace(/^@/, "");

    // Don't send to self
    if (targetId === "bc745837935d45efbf47" || targetId === "7785cae4f157450490d5") continue;

    if (state.sent[targetId]) {
      continue;
    }

    const body = MESSAGE_TEMPLATE.replace(/\{name\}/gi, name);
    let attempts = 0;
    let success = false;

    while (!success && attempts < 3) {
      attempts++;
      log(`[${i + 1}/${recipients.length}] Sending to ${name} (${targetId})...`);
      const res = await sendMessage(targetId, body, cookie);

      if (res.status === 200) {
        success = true;
        sentCount++;
        state.sent[targetId] = {
          sentAt: new Date().toISOString(),
          name,
          sender: senderName,
          msgId: res.data.id || "ok"
        };
        saveState(state);
        log(`  ✅ Sent successfully (${sentCount} total sent)`);
        await sleep(DELAY_MS);
      } else if (res.status === 429) {
        log(`  ⏳ Rate limited (429). Retrying in 5s...`);
        await sleep(RETRY_DELAY_MS);
      } else if (res.status === 401) {
        log(`  🔒 Session expired for ${senderName}!`);
        return;
      } else {
        log(`  ❌ Failed (${res.status}): ${JSON.stringify(res.data || res.error)}`);
        state.failed[targetId] = { at: new Date().toISOString(), error: res.data || res.error };
        saveState(state);
        break;
      }
    }
  }

  log(`🎉 Broadcast complete! Sent ${sentCount} new messages.`);
}

if (process.argv[1]?.includes("broadcast_party_tweet.js")) {
  broadcast().catch(console.error);
}
