import fs from "node:fs";
import crypto from "node:crypto";

const COOKIE = "ll_dev=5e6j3b5q0h1w6544; ll_vid=41df63d592034b448922; ll_session=a49594e973a5e03650d28b08973a21b3a27c0407175e842e4f2711fa57b61159; ll_pass=eyJpIjoiN2U3OTE3NjBjZDY0NGYxM2JhNWEiLCJ1IjoicHJpbmNlZGF2aWQiLCJuIjoiUHJpbmNlRGF2aWQiLCJ0IjoiQ1VyZEdoazVKUTZFUEU2eSIsImUiOjE3OTI0Mjk4MzU3NTZ9.GmDFWFsTr1DID-Zg7nc0n08uDbe4SJM7ObMrNmz9ZJ8";

const TARGET = "2bf24eb411ab44c9a3be"; // Tera_d_Trillionare
const USERNAME = "Tera_d_Trillionare";
const TOTAL = 1_000_000_000_000;       // 1T
const PER_TX = 10_000_000_000;         // 10B per tx
const DELAY = 25000;
const RETRY_DELAY = 5000;
const STATE_FILE = "./balances_prince_to_tera_1t_oct20.json";
const LOG_FILE = "./pipeline_prince_to_tera_1t_oct20.log";

function log(msg) {
  const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
  console.log(line);
  try { fs.appendFileSync(LOG_FILE, line + "\n"); } catch {}
}

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, "utf8")); }
  catch { return { target: TARGET, username: USERNAME, remaining: TOTAL, txCount: 0 }; }
}
function saveState(s) { fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2)); }

function fmt(n) {
  if (n >= 1e12) return (n/1e12).toFixed(2)+"T";
  if (n >= 1e9) return (n/1e9).toFixed(2)+"B";
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
  log(`💸 PrinceDavid → @${USERNAME} (${TARGET}) | Target: ${fmt(TOTAL)} | Remaining: ${fmt(state.remaining)} | TX ${state.txCount}/${totalTxs}`);

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
  log(`🎉 Completed! Sent ${fmt(TOTAL)} to @${USERNAME}.`);
}

main().catch(err => { log("Fatal: " + err); process.exit(1); });
