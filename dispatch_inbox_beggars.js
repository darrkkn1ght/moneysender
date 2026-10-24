import fs from "node:fs";
import crypto from "node:crypto";

const ACCOUNTS_FILE = "./data/accounts.json";
const STATE_FILE = "./inbox_beggars_sent_state.json";
const LOG_FILE = "./inbox_beggars_dispatch.log";

const CHUNK = 10_000_000_000;         // 10B per tx max
const DELAY_MS = 20_500;             // 20.5s turbo delay
const RAPID_RETRY_MS = 2_500;        // 2.5s quick retry on 429

// Beggars detected from @milespete messages:
export const BEGGARS = [
  {
    username: "ojoshuu",
    name: "Small J",
    id: "777f8cd18eeb4091aad3",
    requested: 100_000_000_000, // 100B
    reason: "I meet person weh go round me to 100B 😭"
  },
  {
    username: "ezerestoration4",
    name: "Ramzy",
    id: "5bc885c91ae94bfdae6e",
    requested: 200_000_000_000, // 200B
    reason: "abeg I dey find 200b 4 this game I wan touch that kind fundz"
  },
  {
    username: "Torix20",
    name: "Torix",
    id: "0a676b10ea58424e90b2",
    requested: 100_000_000_000, // 100B
    reason: "Abeg show love oo boss I came to be a 100b billionaire"
  },
  {
    username: "chibuikeola",
    name: "Ola",
    id: "23b43e9a06534c1a8013",
    requested: 100_000_000_000, // 100B
    reason: "You said 100b for 1k / Baba na money matter carry me come o"
  },
  {
    username: "Bigmarvel2222",
    name: "Marvel",
    id: "250aa8be35074489bd77",
    requested: 10_000_000_000, // 10B
    reason: "Omo bro Abeg send me 10b"
  },
  {
    username: "theoriade",
    name: "Isreal",
    id: "46746535b627431191f1",
    requested: 10_000_000_000, // 10B
    reason: "Abeg help me with any amount I don't mind 1b"
  },
  {
    username: "Vickyblack799",
    name: "Vicky black",
    id: "bc4da779186d48499d2c",
    requested: 10_000_000_000, // 10B (default)
    reason: "remember this struggling citizen ooo 😭❤️ I need one opportunity"
  },
  {
    username: "Buch",
    name: "Victor",
    id: "7c3b3a93b5f2437a9c40",
    requested: 10_000_000_000, // 10B (default)
    reason: "Pls send any amount"
  },
  {
    username: "Bigerformer",
    name: "Big performer",
    id: "e56da880733d45418f4a",
    requested: 10_000_000_000, // 10B (default)
    reason: "Pls don't forget about me"
  },
  {
    username: "ghost400",
    name: "Emmanuel",
    id: "ac1d8ff9412446aa9a6c",
    requested: 10_000_000_000, // 10B (default)
    reason: "For some money"
  },
  {
    username: "methere",
    name: "Methere",
    id: "e25f9bc8266c475d87aa",
    requested: 10_000_000_000, // 10B (default)
    reason: "Please 😔"
  },
  {
    username: "brunofernandez",
    name: "Fernandez",
    id: "21f9f80c31044f5eae91",
    requested: 10_000_000_000, // 10B (default)
    reason: "pls bless me i’m your fan"
  },
  {
    username: "realtimmy231",
    name: "Real Timmy",
    id: "7c5864419bb544aaae21",
    requested: 10_000_000_000, // 10B (default)
    reason: "High member lift us off for the weekend"
  },
  {
    username: "Eddy0905",
    name: "Charles Endurance",
    id: "ebd2dd620f114bf4883f",
    requested: 10_000_000_000, // 10B (default)
    reason: "Omo slept off and missed my helper's invite 😪💔"
  },
  {
    username: "Franklin_Roosevelt",
    name: "Favour Adeyera",
    id: "8eedcd259c354be691d7",
    requested: 10_000_000_000, // 10B (default)
    reason: "Seniorman abeg 😂😭😭😭"
  },
  {
    username: "viviandims",
    name: "Vivian dims",
    id: "a8a60c9ca9994e6f9514",
    requested: 10_000_000_000, // 10B (default)
    reason: "🙏 (praying/pleading emoji)"
  }
];

function log(msg) {
  const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
  console.log(line);
  try {
    fs.appendFileSync(LOG_FILE, line + "\n");
  } catch {}
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {
    const s = {
      totalRecipients: BEGGARS.length,
      totalRequested: BEGGARS.reduce((sum, b) => sum + b.requested, 0),
      totalDelivered: 0,
      recipients: {}
    };
    for (const b of BEGGARS) {
      s.recipients[b.id] = {
        username: b.username,
        name: b.name,
        target: b.requested,
        sent: 0,
        txCount: 0,
        completed: false
      };
    }
    return s;
  }
}

function saveState(s) {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
  } catch {}
}

async function sendTransaction(cookie, targetId, amount) {
  const idempotencyKey = crypto.randomUUID();
  try {
    const resp = await fetch("https://lagoslife.app/api/send", {
      method: "POST",
      headers: {
        "cookie": cookie,
        "content-type": "application/json",
        "accept": "application/json",
        "idempotency-key": idempotencyKey,
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
      },
      body: JSON.stringify({ to: targetId, amount })
    });

    const data = await resp.json().catch(() => ({}));
    return { status: resp.status, ok: resp.ok, data };
  } catch (err) {
    return { status: 0, ok: false, error: err.message };
  }
}

async function main() {
  const accounts = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, "utf8"));
  const miles = accounts.find(a => a.user === "milespete");
  if (!miles || !miles.cookie) {
    log("❌ milespete cookie missing!");
    process.exit(1);
  }

  const state = loadState();

  log("=================================================");
  log(`🌟 INBOX BEGGAR DISPATCH ENGINE (@milespete)`);
  log(`   Recipients: ${BEGGARS.length}`);
  log(`   Total Fund Allocation: ₦${(state.totalRequested / 1e9).toFixed(0)} Billion (₦${(state.totalRequested / 1e12).toFixed(3)}T)`);
  log("=================================================\n");

  for (let i = 0; i < BEGGARS.length; i++) {
    const b = BEGGARS[i];
    const recState = state.recipients[b.id];

    if (recState && recState.completed) {
      log(`⏭️ [${i + 1}/${BEGGARS.length}] @${b.username} already fully sent (₦${(recState.sent / 1e9).toFixed(0)}B). Skipping.`);
      continue;
    }

    log(`\n👉 [${i + 1}/${BEGGARS.length}] Processing @${b.username} (${b.name}) | Target: ₦${(b.requested / 1e9).toFixed(0)}B | Reason: "${b.reason}"`);

    while (recState.sent < recState.target) {
      const needed = recState.target - recState.sent;
      const sendAmt = Math.min(CHUNK, needed);
      const txNum = recState.txCount + 1;
      const totalTxs = Math.ceil(recState.target / CHUNK);

      log(`   Sending chunk #${txNum}/${totalTxs} (₦${(sendAmt / 1e9).toFixed(1)}B) to @${b.username}...`);
      const res = await sendTransaction(miles.cookie, b.id, sendAmt);

      if (res.ok) {
        recState.sent += sendAmt;
        recState.txCount += 1;
        state.totalDelivered += sendAmt;
        if (recState.sent >= recState.target) {
          recState.completed = true;
        }
        saveState(state);

        log(`   ✅ Sent ₦${(sendAmt / 1e9).toFixed(1)}B to @${b.username}! (Progress: ₦${(recState.sent / 1e9).toFixed(0)}B/₦${(recState.target / 1e9).toFixed(0)}B) | Total Dispatched: ₦${(state.totalDelivered / 1e9).toFixed(0)}B`);

        if (recState.completed) {
          log(`   🎉 @${b.username} 100% fulfilled!\n`);
        }

        log(`   ⚡ Turbo delay ${(DELAY_MS / 1000).toFixed(1)}s before next transaction...`);
        await sleep(DELAY_MS);
      } else if (res.status === 429) {
        log(`   ⏳ Rate limit (429). Rapid retry in ${(RAPID_RETRY_MS / 1000).toFixed(1)}s...`);
        await sleep(RAPID_RETRY_MS);
      } else {
        log(`   ⚠️ Error ${res.status}: ${JSON.stringify(res.data || res.error)}. Retrying in 5s...`);
        await sleep(5000);
      }
    }
  }

  log(`\n🏆 ALL ${BEGGARS.length} INBOX REQUESTS 100% DISPATCHED! Total Sent: ₦${(state.totalDelivered / 1e9).toFixed(0)} Billion!\n`);
}

main().catch(err => {
  log(`🔥 Fatal error: ${err.message}`);
  process.exit(1);
});
