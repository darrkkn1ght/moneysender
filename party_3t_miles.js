import fs from "node:fs";
import crypto from "node:crypto";

const COOKIE = "ll_dev=2l08616a3s395t0d; ll_vid=102f439367af4102b904; ll_session=7905085c7b02a4e840a338dd3484f8995d019cd955fdf7d8f1c2a7ba846d1ee0; ll_pass=eyJpIjoiYmM3NDU4Mzc5MzVkNDVlZmJmNDciLCJ1IjoibWlsZXNwZXRlIiwibiI6Ik1pbGVzIFBldGVyIiwidCI6IlJPZXdwcjRWTlVNRE9uLUkiLCJlIjoxNzkyNDA0OTAyODk1fQ.wyQw5T4rXT32ZYfwVpvzddrsOPc4qM50CFHT6W-awrQ";

const GUESTS = [
  { username: "dreamboat", id: "b574dd6e733445aa9655" },
  { username: "jindu20", id: "2aab1d48e46b4c0e805d" },
  { username: "Tera_d_Trillionare", id: "2bf24eb411ab44c9a3be" },
  { username: "Alexander04", id: "e870d8a9d24940d08e0d" },
  { username: "realtimmy231", id: "7c5864419bb544aaae21" },
  { username: "CodyMhane7G", id: "24e1b6b3645945629414" },
  { username: "El_Professor", id: "c6b9aa7ae5a94cc9b1c5" },
  { username: "yycee23", id: "701cde51cc244e88b190" }
];

const TOTAL_PER_GUEST = 200_000_000_000; // 200B each
const PER_TX = 10_000_000_000;          // 10B per tx
const DELAY = 25000;                    // 25s
const RETRY_DELAY = 5000;               // 5s
const STATE_FILE = "./party_3t_miles_state.json";
const LOG_FILE = "./party_3t_miles.log";

function log(msg) {
  const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
  console.log(line);
  try {
    fs.appendFileSync(LOG_FILE, line + "\n");
  } catch {}
}

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, "utf8")); }
  catch {
    const s = { guests: {} };
    for (const g of GUESTS) s.guests[g.id] = { remaining: TOTAL_PER_GUEST, txCount: 0 };
    return s;
  }
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
  log("==================================================");
  log(`💸 MILESPETE 3T LEG: 8 GUESTS × 200B = 1.60T`);
  log("==================================================");

  for (let i = 0; i < GUESTS.length; i++) {
    const g = GUESTS[i];
    if (!state.guests[g.id]) state.guests[g.id] = { remaining: TOTAL_PER_GUEST, txCount: 0 };
    const gState = state.guests[g.id];

    if (gState.remaining <= 0) {
      log(`[Guest ${i + 1}/${GUESTS.length}] @${g.username} already received 200B. Skipping.`);
      continue;
    }

    log(`\n[Guest ${i + 1}/${GUESTS.length}] 🎁 Delivering 200B to @${g.username} (${g.id})...`);

    while (gState.remaining > 0) {
      const sendAmt = Math.min(PER_TX, gState.remaining);
      const txNum = gState.txCount + 1;
      log(`  [TX ${txNum}/20] Sending 10.00B to @${g.username}...`);

      const r = await send(g.id, sendAmt);

      if (r.status === 200) {
        gState.remaining -= sendAmt;
        gState.txCount++;
        saveState(state);
        log(`  [TX ${txNum}/20] Sent 10.00B ✅ | Left for @${g.username}: ${(gState.remaining / 1e9).toFixed(0)}B`);

        if (gState.remaining > 0 || i < GUESTS.length - 1) {
          log(`  Waiting ${DELAY/1000}s...`);
          await new Promise(res => setTimeout(res, DELAY));
        }
      } else if (r.status === 429) {
        log(`  Rate limit (429). Retrying in ${RETRY_DELAY/1000}s...`);
        await new Promise(res => setTimeout(res, RETRY_DELAY));
      } else {
        const errMsg = r.data?.error || JSON.stringify(r.data || r.error);
        log(`  Error ${r.status}: ${errMsg}. Retrying in ${RETRY_DELAY/1000}s...`);
        await new Promise(res => setTimeout(res, RETRY_DELAY));
      }
    }
  }

  log(`\n🎉 MilesPete completed 1.60T distribution to all 8 guests!`);
}

main().catch(err => {
  log("Fatal error: " + err);
  process.exit(1);
});
