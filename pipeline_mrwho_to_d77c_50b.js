import fs from "node:fs";
import crypto from "node:crypto";

const COOKIE = "ll_dev=0u144y403y0n5o4c; ll_session=30ed25151a51189b01b77ec860906bcf4ff53eef06599f910f94fa3b4f329fba; ll_pass=eyJpIjoiZDRmNGFlZDk0ZDZlNDkxOTg5Y2YiLCJ1IjoibXJfd2hvIiwibiI6Iklka3dldHVsbWEiLCJ0IjoicHdjNFB1U3R0M2ROZ0ZkVCIsImUiOjE3OTIzNzQ0Nzg5NDd9.n3er-Yhh5QKWtVnl12SnIDGNgYt6MHD1P1qv0uuRJng";

const TARGET = "d77c9642f6704f7ab60a";
const TOTAL = 50_000_000_000;         // 50B
const PER_TX = 10_000_000_000;        // 10B per tx
const DELAY = 25000;                  // 25s between txs
const RETRY_DELAY = 5000;             // 5s on 429 / error
const STATE_FILE = "./balances_mrwho_to_d77c_50b.json";
const LOG_FILE = "./pipeline_mrwho_to_d77c_50b.log";

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
  log(`💸 mr_who -> ${TARGET} | Target: ${fmt(TOTAL)} | Per TX: ${fmt(PER_TX)} | Remaining: ${fmt(state.remaining)}`);
  log(`   TX ${state.txCount}/${totalTxs} completed`);

  while (state.remaining > 0) {
    const amount = Math.min(PER_TX, state.remaining);
    const txNum = state.txCount + 1;
    log(`[mr_who -> d77c] [TX ${txNum}/${totalTxs}] Sending ${fmt(amount)}...`);

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

  log(`🎉 COMPLETED! Sent ${fmt(TOTAL)} to ${TARGET} in ${state.txCount} transactions.`);
}

if (process.argv[1]?.includes("pipeline_mrwho_to_d77c_50b.js")) {
  main().catch(console.error);
}
