import fs from "node:fs";
import crypto from "node:crypto";

const COOKIE = "ll_dev=2l08616a3s395t0d; ll_vid=102f439367af4102b904; ll_session=7905085c7b02a4e840a338dd3484f8995d019cd955fdf7d8f1c2a7ba846d1ee0; ll_pass=eyJpIjoiYmM3NDU4Mzc5MzVkNDVlZmJmNDciLCJ1IjoibWlsZXNwZXRlIiwibiI6Ik1pbGVzIFBldGVyIiwidCI6IlJPZXdwcjRWTlVNRE9uLUkiLCJlIjoxNzkyNDA0OTAyODk1fQ.wyQw5T4rXT32ZYfwVpvzddrsOPc4qM50CFHT6W-awrQ";

const RECIPIENTS = [
  { username: "El_Professor", id: "c6b9aa7ae5a94cc9b1c5" },
  { username: "gustavo_emi", id: "a7e6fe02a4c843c3bd19" },
  { username: "Greatholy", id: "d256b9fb246944dabd05" },
  { username: "Kaizen_77", id: "837a90f7a6834f2f918e" },
  { username: "berry_277", id: "59bf745066ac43a5bc9c" },
  { username: "Davolee4pf", id: "a784f04fe9df48509dfd" },
  { username: "dazey098", id: "8dad85699f3c423bab6c" },
  { username: "dreamboat", id: "b574dd6e733445aa9655" }
];

const AMOUNT_PER_USER = 10_000_000_000; // 10B
const DELAY = 25000;                    // 25s between sends
const RETRY_DELAY = 5000;               // 5s on 429
const STATE_FILE = "./batch_new_party_guests_state.json";
const LOG_FILE = "./batch_new_party_guests.log";

function log(msg) {
  const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
  console.log(line);
  try {
    fs.appendFileSync(LOG_FILE, line + "\n");
  } catch {}
}

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, "utf8")); }
  catch { return { completed: [] }; }
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
  log(`💸 NEW PARTY GUESTS BATCH: 10B TO ${RECIPIENTS.length} USERS (TOTAL: 80B)`);
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

  log(`\n🎉 Completed all ${RECIPIENTS.length} new party guests! Total 80B distributed.`);
}

main().catch(err => {
  log("Fatal error: " + err);
  process.exit(1);
});
