import fs from "node:fs";
import crypto from "node:crypto";

const COOKIE = "ll_dev=5e6j3b5q0h1w6544; ll_vid=41df63d592034b448922; ll_session=a49594e973a5e03650d28b08973a21b3a27c0407175e842e4f2711fa57b61159; ll_pass=eyJpIjoiN2U3OTE3NjBjZDY0NGYxM2JhNWEiLCJ1IjoicHJpbmNlZGF2aWQiLCJuIjoiUHJpbmNlRGF2aWQiLCJ0IjoiQ1VyZEdoazVKUTZFUEU2eSIsImUiOjE3OTI0Mjk4MzU3NTZ9.GmDFWFsTr1DID-Zg7nc0n08uDbe4SJM7ObMrNmz9ZJ8";

const GUESTS = [
  { username: "sammito", id: "9dfd250ef3dc4b499303" },
  { username: "Themaze_21", id: "05a395376a1944349f88" },
  { username: "evilmeerah", id: "cc2d6b2c1c7e48d79ee0" },
  { username: "Ajibola7", id: "efe5efc7a8634ad09b51" },
  { username: "Swagger_Lee", id: "f4889331be324e3f960d" },
  { username: "howecomebenow62", id: "eb0fe193e7c34ea0bc77" },
  { username: "prin_emeks", id: "4db0bc86837448389cc0" }
];

const TOTAL_PER_GUEST = 200_000_000_000; // 200B each
const PER_TX = 10_000_000_000;          // 10B per tx
const DELAY = 25000;                    // 25s
const RETRY_DELAY = 5000;               // 5s
const STATE_FILE = "./party_3t_prince_state.json";
const LOG_FILE = "./party_3t_prince.log";

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
  log(`💸 PRINCEDAVID 3T LEG: 7 GUESTS × 200B = 1.40T`);
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

  log(`\n🎉 PrinceDavid completed 1.40T distribution to all 7 guests!`);
}

main().catch(err => {
  log("Fatal error: " + err);
  process.exit(1);
});
