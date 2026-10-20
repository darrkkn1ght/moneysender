import fs from "node:fs";
import crypto from "node:crypto";

const SENDER = "Kvngdre";
const TARGET = "7785cae4f157450490d5"; // blaqsebastian
const USERNAME = "blaqsebastian";
const TOTAL = 5_000_000_000_000;       // 5T
const PER_TX = 10_000_000_000;         // 10B per tx
const DELAY = 25000;
const RETRY_DELAY = 5000;
const STATE_FILE = "./balances_kvngdre_to_blaq_5t_oct20.json";
const LOG_FILE = "./pipeline_kvngdre_to_blaq_5t_oct20.log";

const COOKIE = "ll_dev=671n6y1n0l06545d; ll_session=d436631e376dd892b0fda0f40b675e04b6f3e38d3bea98f239be881504fbb0f0.hmvgcg8sd; ll_vid=5d27862aa58d43f38a0f; ll_pass=eyJpIjoiMWFiM2E0NTA0NTU0NDU3NGFmZTgiLCJ1IjoiS3ZuZ2RyZSIsIm4iOiJEcmUiLCJ0IjoiV0dGSFhwMEIyYmhJREFKbSIsImUiOjE3OTI0OTMyNDA5MDR9.ZB7Z6ee0ZHrRYhtlz4QfsruJ1_M8Wl5y6TE2qSdaeOE";

function log(msg) {
  const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
  console.log(line);
  try { fs.appendFileSync(LOG_FILE, line + "\n"); } catch {}
}

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, "utf8")); }
  catch { return { sender: SENDER, target: TARGET, username: USERNAME, remaining: TOTAL, txCount: 0 }; }
}
function saveState(s) { fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2)); }

function fmt(n) {
  if (n >= 1e12) return (n/1e12).toFixed(2) + "T";
  if (n >= 1e9) return (n/1e9).toFixed(2) + "B";
  return n.toLocaleString();
}

async function send(amount) {
  try {
    const resp = await fetch("https://lagoslife.app/api/send", {
      method: "POST",
      headers: {
        "accept": "application/json",
        "content-type": "application/json",
        "cookie": COOKIE,
        "idempotency-key": crypto.randomUUID(),
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
      },
      body: JSON.stringify({ to: TARGET, amount })
    });
    return { status: resp.status, data: await resp.json().catch(() => ({})) };
  } catch (err) {
    return { status: 0, error: err.message || String(err) };
  }
}

async function main() {
  const state = loadState();
  const totalTxs = Math.ceil(TOTAL / PER_TX);
  log(`💸 @${SENDER} → @${USERNAME} (${TARGET}) | Target: ${fmt(TOTAL)} | Remaining: ${fmt(state.remaining)} | TX ${state.txCount}/${totalTxs}`);

  while (state.remaining > 0) {
    const amount = Math.min(PER_TX, state.remaining);
    const txNum = state.txCount + 1;
    const r = await send(amount);

    if (r.status === 200) {
      state.remaining -= amount;
      state.txCount++;
      saveState(state);
      log(`[TX ${txNum}/${totalTxs}] Sent ${fmt(amount)} ✅ | Remaining: ${fmt(state.remaining)}`);
      if (state.remaining > 0) await new Promise(res => setTimeout(res, DELAY));
    } else if (r.status === 429) {
      log(`[TX ${txNum}/${totalTxs}] Rate limited (429). Retrying in 5s...`);
      await new Promise(res => setTimeout(res, RETRY_DELAY));
    } else {
      const errMsg = r.data?.error || JSON.stringify(r.data || r.error);
      log(`Error ${r.status}: ${errMsg}`);
      if (r.status === 404 || r.status === 401 || (r.status === 400 && String(errMsg).includes("need"))) {
        log(`⛔ Fatal error. Halting.`);
        process.exit(1);
      }
      await new Promise(res => setTimeout(res, RETRY_DELAY));
    }
  }
  log(`🎉 Completed! Sent ${fmt(TOTAL)} from @${SENDER} to @${USERNAME}.`);
}

main().catch(err => { log("Fatal: " + err); process.exit(1); });
