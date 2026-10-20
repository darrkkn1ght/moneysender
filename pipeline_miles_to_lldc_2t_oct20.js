import fs from "node:fs";
import crypto from "node:crypto";

const COOKIE = "ll_dev=2l08616a3s395t0d; ll_vid=102f439367af4102b904; ll_session=7905085c7b02a4e840a338dd3484f8995d019cd955fdf7d8f1c2a7ba846d1ee0; ll_pass=eyJpIjoiYmM3NDU4Mzc5MzVkNDVlZmJmNDciLCJ1IjoibWlsZXNwZXRlIiwibiI6Ik1pbGVzIFBldGVyIiwidCI6IlJPZXdwcjRWTlVNRE9uLUkiLCJlIjoxNzkyNDA0OTAyODk1fQ.wyQw5T4rXT32ZYfwVpvzddrsOPc4qM50CFHT6W-awrQ";

const TARGET = "802ef46ea4eb4b1b8b47"; // LLDC
const USERNAME = "LLDC";
const TOTAL = 2_000_000_000_000;       // 2T
const PER_TX = 10_000_000_000;         // 10B per tx
const DELAY = 25000;
const RETRY_DELAY = 5000;
const STATE_FILE = "./balances_miles_to_lldc_2t_oct20.json";
const LOG_FILE = "./pipeline_miles_to_lldc_2t_oct20.log";

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
  log(`💸 MilesPete → @${USERNAME} (${TARGET}) | Target: ${fmt(TOTAL)} | Remaining: ${fmt(state.remaining)} | TX ${state.txCount}/${totalTxs}`);

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
