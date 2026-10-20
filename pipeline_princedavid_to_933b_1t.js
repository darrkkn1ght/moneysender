import fs from "node:fs";
import crypto from "node:crypto";

const COOKIE = "ll_dev=5e6j3b5q0h1w6544; ll_vid=41df63d592034b448922; ll_session=9bcfef2875bb6d192379de4fb4927479f6f68ed8205e6e0b4ce45c76c295bc99; ll_pass=eyJpIjoiN2U3OTE3NjBjZDY0NGYxM2JhNWEiLCJ1IjoicHJpbmNlZGF2aWQiLCJuIjoiUHJpbmNlRGF2aWQiLCJ0IjoiMVB1VDQwckFCTkZkdVFtZCIsImUiOjE3OTI0MDQ0NDU2Nzh9.KJyUzDIsOIJuNGvB8QrKY8oSCeUo8tJcvtHcbPmhduU";

const TARGET = "933ba08eb1d64901baf9";
const TOTAL = 1_000_000_000_000;       // 1T
const PER_TX = 10_000_000_000;        // 10B per tx
const DELAY = 25000;                  // 25s between txs
const RETRY_DELAY = 5000;             // 5s on 429 / error
const STATE_FILE = "./balances_princedavid_to_933b_1t.json";
const LOG_FILE = "./pipeline_princedavid_to_933b_1t.log";

function log(msg) {
  const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
  console.log(line);
  try {
    fs.appendFileSync(LOG_FILE, line + "\n");
  } catch {}
}

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, "utf8")); }
  catch { return { sender: "princedavid", target: TARGET, remaining: TOTAL, txCount: 0, total: TOTAL, timestamp: new Date().toISOString() }; }
}
function saveState(s) { 
  s.timestamp = new Date().toISOString();
  fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2)); 
}

function fmt(n) {
  if (n >= 1e12) return (n/1e12).toFixed(2) + "T";
  if (n >= 1e9) return (n/1e9).toFixed(2) + "B";
  if (n >= 1e6) return (n/1e6).toFixed(2) + "M";
  return n.toLocaleString();
}

async function send(amount) {
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
      body: JSON.stringify({ to: TARGET, amount })
    });
    return { status: resp.status, data: await resp.json().catch(() => ({})) };
  } catch (err) {
    return { status: 0, error: err.message || String(err) };
  }
}

export async function main() {
  const state = loadState();
  const totalTxs = Math.ceil(TOTAL / PER_TX);
  log(`💸 PrinceDavid -> ${TARGET} | Target: ${fmt(TOTAL)} | Per TX: ${fmt(PER_TX)} | Remaining: ${fmt(state.remaining)}`);
  log(`   TX ${state.txCount}/${totalTxs} completed so far`);

  while (state.remaining > 0) {
    const amount = Math.min(PER_TX, state.remaining);
    const txNum = state.txCount + 1;
    log(`[TX ${txNum}/${totalTxs}] Sending ${fmt(amount)} from PrinceDavid to ${TARGET}...`);

    const r = await send(amount);

    if (r.status === 200) {
      state.remaining -= amount;
      state.txCount += 1;
      saveState(state);
      log(`   ✅ Success! Remaining: ${fmt(state.remaining)}`);

      if (state.remaining > 0) {
        log(`   ⏳ Cooldown ${DELAY/1000}s...`);
        await new Promise(res => setTimeout(res, DELAY));
      }
    } else if (r.status === 429) {
      log(`   ⚠️ Rate limit (429). Retrying in ${RETRY_DELAY/1000}s...`);
      await new Promise(res => setTimeout(res, RETRY_DELAY));
    } else {
      log(`   ❌ Error ${r.status}: ${JSON.stringify(r.data || r.error)}. Retrying in ${RETRY_DELAY/1000}s...`);
      await new Promise(res => setTimeout(res, RETRY_DELAY));
    }
  }

  log(`🎉 COMPLETED! 1T fully delivered from PrinceDavid to ${TARGET}!`);
}

main().catch(err => log(`Fatal: ${err.message}`));
