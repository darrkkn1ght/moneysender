import fs from "node:fs";
import crypto from "node:crypto";

const COOKIE = "ll_dev=2l08616a3s395t0d; ll_vid=102f439367af4102b904; ll_session=7905085c7b02a4e840a338dd3484f8995d019cd955fdf7d8f1c2a7ba846d1ee0; ll_pass=eyJpIjoiYmM3NDU4Mzc5MzVkNDVlZmJmNDciLCJ1IjoibWlsZXNwZXRlIiwibiI6Ik1pbGVzIFBldGVyIiwidCI6IlJPZXdwcjRWTlVNRE9uLUkiLCJlIjoxNzkyMzY2MDU0ODUyfQ.GmMw-OxO6rh4lp4QjBOW6tF7xm76FZBoSBhsD381IZY";

const TARGET = "f3e6cd707d3442bc8374";
const TOTAL = 1_000_000_000_000;       // 1T
const PER_TX = 10_000_000_000;        // 10B per tx
const DELAY = 25000;                  // 25s between txs
const RETRY_DELAY = 5000;             // 5s on 429 / error
const STATE_FILE = "./balances_miles_to_f3e6_2nd_1t.json";
const LOG_FILE = "./pipeline_miles_to_f3e6_2nd_1t.log";

function log(msg) {
  const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
  console.log(line);
  try {
    fs.appendFileSync(LOG_FILE, line + "\n");
  } catch {}
}

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, "utf8")); }
  catch { return { target: TARGET, remaining: TOTAL, txCount: 0 }; }
}
function saveState(s) { fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2)); }

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
  log(`💸 MilesPete -> ${TARGET} (2nd 1T) | Target: ${fmt(TOTAL)} | Per TX: ${fmt(PER_TX)} | Remaining: ${fmt(state.remaining)}`);
  log(`   TX ${state.txCount}/${totalTxs} completed`);

  while (state.remaining > 0) {
    const amount = Math.min(PER_TX, state.remaining);
    const txNum = state.txCount + 1;
    log(`[Miles -> f3e6 #2] [TX ${txNum}/${totalTxs}] Sending ${fmt(amount)}...`);

    const r = await send(amount);

    if (r.status === 200) {
      state.remaining -= amount;
      state.txCount++;
      saveState(state);
      const sent = TOTAL - state.remaining;
      const pct = ((sent / TOTAL) * 100).toFixed(1);
      log(`  ✅ OK | Sent: ${fmt(sent)} | Remaining: ${fmt(state.remaining)} (${pct}%)`);
      if (state.remaining > 0) await new Promise(r => setTimeout(r, DELAY));
    } else if (r.status === 429) {
      log(`  ⏳ Rate limited (429), retrying in ${RETRY_DELAY/1000}s...`);
      await new Promise(r => setTimeout(r, RETRY_DELAY));
    } else if (r.status === 0) {
      log(`  ⚠️ Network error (${r.error}), retrying in ${RETRY_DELAY/1000}s...`);
      await new Promise(r => setTimeout(r, RETRY_DELAY));
    } else if (r.status === 401) {
      log(`  🔒 Session expired! Status: ${r.status}`);
      process.exit(1);
    } else {
      log(`  ❌ Error ${r.status}: ${JSON.stringify(r.data)}`);
      await new Promise(r => setTimeout(r, RETRY_DELAY));
    }
  }

  log(`🎉 COMPLETED! Sent 2nd ${fmt(TOTAL)} to ${TARGET} in ${state.txCount} transactions.`);
}

if (process.argv[1]?.includes("pipeline_miles_to_f3e6_2nd_1t.js")) {
  main().catch(console.error);
}
