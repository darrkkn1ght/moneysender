import fs from "node:fs";
import crypto from "node:crypto";

const COOKIE = "ll_dev=2l08616a3s395t0d; ll_vid=102f439367af4102b904; ll_session=7905085c7b02a4e840a338dd3484f8995d019cd955fdf7d8f1c2a7ba846d1ee0; ll_pass=eyJpIjoiYmM3NDU4Mzc5MzVkNDVlZmJmNDciLCJ1IjoibWlsZXNwZXRlIiwibiI6Ik1pbGVzIFBldGVyIiwidCI6IlJPZXdwcjRWTlVNRE9uLUkiLCJlIjoxNzkyNDA0OTAyODk1fQ.wyQw5T4rXT32ZYfwVpvzddrsOPc4qM50CFHT6W-awrQ";

const RECIPIENTS = [
  { username: "OdogwuOfGoshen", id: "bc921df80be1442e9fa6" },
  { username: "Debbielahot", id: "933ba08eb1d64901baf9" },
  { username: "Lordibile", id: "5889c8b37212491f9597" },
  { username: "danny_darko", id: "86a839642a194cbbb61a" },
  { username: "yycee23", id: "701cde51cc244e88b190" },
  { username: "AURAGOD", id: "d5bdd911a1a5437f8366" },
  { username: "abdulrasaqbolakale41", id: "8d00fd50a76f4080ad4c" },
  { username: "ferminlopez7", id: "26353799c99d45e4aea3" },
  { username: "arafahh", id: "cb9f31b1b23c48d284d5" },
  { username: "0147isreal", id: "d118352e6040409494f8" },
  { username: "realtimmy231", id: "7c5864419bb544aaae21" },
  { username: "muna162", id: "2e1b0200e1ca4026a72a" },
  { username: "sammito", id: "9dfd250ef3dc4b499303" },
  { username: "SEGEMONEY6915", id: "55a58e2e56c149dfb2b8" },
  { username: "Timz8471", id: "88813c2c9e9342c792b5" },
  { username: "evilmeerah", id: "cc2d6b2c1c7e48d79ee0" },
  { username: "hamous", id: "9fbe82cb3b0347769d83" },
  { username: "howecomebenow62", id: "eb0fe193e7c34ea0bc77" },
  { username: "Themaze_21", id: "05a395376a1944349f88" },
  { username: "Ajibola7", id: "efe5efc7a8634ad09b51" }
];

const AMOUNT_PER_USER = 10_000_000_000; // 10B
const DELAY = 25000;                    // 25s between sends
const RETRY_DELAY = 5000;               // 5s on 429
const STATE_FILE = "./batch_party_guests_state.json";
const LOG_FILE = "./batch_party_guests.log";

function log(msg) {
  const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
  console.log(line);
  try {
    fs.appendFileSync(LOG_FILE, line + "\n");
  } catch {}
}

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, "utf8")); }
  catch { return { completed: [], currentIndex: 0 }; }
}
function saveState(s) { fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2)); }

async function send(targetId, amount) {
  const key = crypto.randomUUID();
  try {
    const resp = await fetch("https://lagoslife.app/api/send", {
      method: "POST",
      headers: {
        "accept": "application/json",
        "content-type": "application/json",
        "cookie": COOKIE,
        "idempotency-key": key,
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
      },
      body: JSON.stringify({ to: targetId, amount })
    });
    return { status: resp.status, data: await resp.json().catch(() => ({})) };
  } catch (err) {
    return { status: 0, error: err.message || String(err) };
  }
}

async function main() {
  const state = loadState();
  const completedSet = new Set(state.completed);

  log("==================================================");
  log(`💸 PARTY ROOM BATCH: 10B TO ${RECIPIENTS.length} USERS (TOTAL: 200B)`);
  log(`   Sender: MilesPete | Completed so far: ${state.completed.length}/${RECIPIENTS.length}`);
  log("==================================================");

  for (let i = 0; i < RECIPIENTS.length; i++) {
    const r = RECIPIENTS[i];
    if (completedSet.has(r.id)) {
      log(`[${i + 1}/${RECIPIENTS.length}] ⏭️ Already sent to @${r.username}, skipping.`);
      continue;
    }

    log(`[${i + 1}/${RECIPIENTS.length}] 💸 Sending 10.00B to @${r.username} (${r.id})...`);

    while (true) {
      const res = await send(r.id, AMOUNT_PER_USER);

      if (res.status === 200) {
        state.completed.push(r.id);
        completedSet.add(r.id);
        saveState(state);
        log(`[${i + 1}/${RECIPIENTS.length}] Sent 10.00B to @${r.username} ✅ (${state.completed.length}/${RECIPIENTS.length} done)`);

        if (i < RECIPIENTS.length - 1) {
          log(`Waiting ${DELAY/1000}s...`);
          await new Promise(res => setTimeout(res, DELAY));
        }
        break;
      } else if (res.status === 429) {
        log(`Rate limit (429). Retrying in ${RETRY_DELAY/1000}s...`);
        await new Promise(res => setTimeout(res, RETRY_DELAY));
      } else {
        const errMsg = res.data?.error || JSON.stringify(res.data || res.error);
        log(`Error ${res.status} for @${r.username}: ${errMsg}. Retrying in ${RETRY_DELAY/1000}s...`);
        if (res.status === 404) {
          log(`Skipping invalid recipient @${r.username}`);
          state.completed.push(r.id);
          saveState(state);
          break;
        }
        await new Promise(res => setTimeout(res, RETRY_DELAY));
      }
    }
  }

  log(`\n🎉 Completed all ${RECIPIENTS.length} party guests! Total 200B distributed.`);
}

main().catch(err => {
  log("Fatal error: " + err);
  process.exit(1);
});
