import fs from "node:fs";

const ACCOUNTS = [
  {
    name: "Miles Peter (@milespete)",
    uid: "bc745837935d45efbf47",
    cookie: "ll_dev=2l08616a3s395t0d; ll_vid=102f439367af4102b904; ll_session=7905085c7b02a4e840a338dd3484f8995d019cd955fdf7d8f1c2a7ba846d1ee0; ll_pass=eyJpIjoiYmM3NDU4Mzc5MzVkNDVlZmJmNDciLCJ1IjoibWlsZXNwZXRlIiwibiI6Ik1pbGVzIFBldGVyIiwidCI6IlJPZXdwcjRWTlVNRE9uLUkiLCJlIjoxNzkyMzY2MDU0ODUyfQ.GmMw-OxO6rh4lp4QjBOW6tF7xm76FZBoSBhsD381IZY"
  },
  {
    name: "Sebastian (@blaqsebastian)",
    uid: "7785cae4f157450490d5",
    cookie: "ll_dev=4o3z111w5i470l2f; ll_vid=2fe99f9ce0624c4abb14; ll_session=0eb20df322921c02aa976d9fa6d5a813021046eb1ea390f00d26a9646abd3718; ll_pass=eyJpIjoiNzc4NWNhZTRmMTU3NDUwNDkwZDUiLCJ1IjoiYmxhcXNlYmFzdGlhbiIsIm4iOiJTZWJhc3RpYW4iLCJ0Ijoid1hPLXRkQ2ZyVW4zbkJNbiIsImUiOjE3OTIzNDQ1MzI5MTV9.Bxn8glwFir1I4AoRyCRSppJSdA5EyrN6uXS24YqdB20"
  },
  {
    name: "mr_who (Idkwetulma)",
    uid: "d4f4aed94d6e491989cf",
    cookie: "ll_dev=0u144y403y0n5o4c; ll_session=30ed25151a51189b01b77ec860906bcf4ff53eef06599f910f94fa3b4f329fba; ll_pass=eyJpIjoiZDRmNGFlZDk0ZDZlNDkxOTg5Y2YiLCJ1IjoibXJfd2hvIiwibiI6Iklka3dldHVsbWEiLCJ0IjoicHdjNFB1U3R0M2ROZ0ZkVCIsImUiOjE3OTIzNzQ0Nzg5NDd9.n3er-Yhh5QKWtVnl12SnIDGNgYt6MHD1P1qv0uuRJng"
  }
];

const BASE_URL = "https://lagoslife.app/api/messages";
const STATE_FILE = "./broadcast_200m_incentive_state.json";
const LOG_FILE = "./broadcast_200m_incentive.log";

const TWEET_URL = "https://x.com/MilesPetes/status/2111992409471234292?s=20";
const MESSAGE_TEMPLATE = "Hey {name}! 🎉 Earn ₦200,000,000 cash in LagosLife right now! ₦100M for liking + ₦100M for reposting tonight's party tweet: " + TWEET_URL + " - Reply here with confirmation once done and I'll send your ₦200M instantly! 💸🔥";

const DELAY_MS = 2500;
const RETRY_DELAY_MS = 5000;

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

async function fetchInboxThreads(cookie) {
  try {
    const res = await fetch(BASE_URL, { headers: { cookie } });
    if (!res.ok) return [];
    const data = await res.json();
    return data.threads || [];
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

export async function main() {
  log("==================================================");
  log("💰 3-ACCOUNT ₦200M TWEET INCENTIVE BROADCAST");
  log("   Accounts: @milespete, @blaqsebastian, mr_who");
  log(`   Incentive: ₦100M Like + ₦100M Repost (₦200M Total)`);
  log(`   Tweet: ${TWEET_URL}`);
  log("==================================================");

  const state = loadState();
  const ownUids = new Set(ACCOUNTS.map(a => a.uid));

  for (const acc of ACCOUNTS) {
    log(`\n📡 Fetching inbox conversations for ${acc.name}...`);
    const threads = await fetchInboxThreads(acc.cookie);
    log(`   Found ${threads.length} total contact threads for ${acc.name}.`);

    // Sort to message online players first
    threads.sort((a, b) => (b.online ? 1 : 0) - (a.online ? 1 : 0));

    let accSent = 0;
    for (let i = 0; i < threads.length; i++) {
      const t = threads[i];
      const targetId = t.id;
      if (!targetId || ownUids.has(targetId)) continue;

      // Unique deduplication across all 3 accounts
      if (state.sent[targetId]) {
        continue;
      }

      const name = (t.name || t.username || "friend").replace(/^@/, "");
      const body = MESSAGE_TEMPLATE.replace(/\{name\}/gi, name);
      const isOnline = !!t.online;

      log(`   [${acc.name}] Sending to ${name} (${targetId}) ${isOnline ? "🟢 [ONLINE]" : "⚪"}...`);

      let attempts = 0;
      let success = false;

      while (!success && attempts < 2) {
        attempts++;
        const res = await sendMessage(targetId, body, acc.cookie);

        if (res.status === 200) {
          success = true;
          accSent++;
          state.sent[targetId] = {
            sentAt: new Date().toISOString(),
            name,
            sender: acc.name,
            online: isOnline,
            msgId: res.data?.id || "ok"
          };
          saveState(state);
          log(`     ✅ Sent! (Total broadcasted: ${Object.keys(state.sent).length})`);
          await sleep(DELAY_MS);
        } else if (res.status === 429) {
          log(`     ⏳ Rate limited (429). Waiting 5s...`);
          await sleep(RETRY_DELAY_MS);
        } else if (res.status === 403) {
          log(`     ⏩ Player has DMs restricted (403).`);
          state.failed[targetId] = { status: 403, error: "DMs restricted" };
          saveState(state);
          break;
        } else if (res.status === 422) {
          log(`     ⏩ Link restricted (422).`);
          state.failed[targetId] = { status: 422, error: "Link restricted" };
          saveState(state);
          break;
        } else {
          log(`     ❌ Error ${res.status}: ${JSON.stringify(res.data || res.error)}`);
          break;
        }
      }
    }

    log(`✅ Finished campaign run for ${acc.name} (${accSent} new messages sent).`);
  }

  log(`\n🎉 3-Account ₦200M Incentive Broadcast complete! Total unique players reached: ${Object.keys(state.sent).length}`);
}

if (process.argv[1]?.includes("broadcast_3accounts_200m_incentive.js")) {
  main().catch(console.error);
}
