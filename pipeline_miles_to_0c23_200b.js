import fs from "node:fs";
import crypto from "node:crypto";

const TARGET = "0c23085e4e034aca929d";
const TOTAL = 200_000_000_000;       // 200B
const PER_TX = 10_000_000_000;       // 10B per tx
const DELAY = 25000;                 // 25s between txs
const RETRY_DELAY = 5000;            // 5s on 429 / error
const STATE_FILE = "./balances_miles_to_0c23_200b.json";
const LOG_FILE = "./pipeline_miles_to_0c23_200b.log";

const COOKIE = "ll_dev=2l08616a3s395t0d; ll_vid=102f439367af4102b904; ll_session=7905085c7b02a4e840a338dd3484f8995d019cd955fdf7d8f1c2a7ba846d1ee0; ll_pass=eyJpIjoiYmM3NDU4Mzc5MzVkNDVlZmJmNDciLCJ1IjoibWlsZXNwZXRlIiwibiI6Ik1pbGVzIFBldGVyIiwidCI6IlJPZXdwcjRWTlVNRE9uLUkiLCJlIjoxNzkyNDA0OTAyODk1fQ.wyQw5T4rXT32ZYfwVpvzddrsOPc4qM50CFHT6W-awrQ";

function log(msg) {
  const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
  console.log(line);
  try { fs.appendFileSync(LOG_FILE, line + "\n"); } catch {}
}

function fmt(n) {
  if (n >= 1e12) return (n/1e12).toFixed(2) + "T";
  if (n >= 1e9) return (n/1e9).toFixed(2) + "B";
  if (n >= 1e6) return (n/1e6).toFixed(2) + "M";
  return n.toLocaleString();
}

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, "utf8")); }
  catch { return { sender: "milespete", target: TARGET, total: TOTAL, remaining: TOTAL, txCount: 0 }; }
}

function saveState(s) {
  s.timestamp = new Date().toISOString();
  fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
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

async function main() {
  const state = loadState();
  const totalTxs = Math.ceil(TOTAL / PER_TX);
  log(`💸 MilesPete -> ${TARGET} | Target: ${fmt(TOTAL)} | Remaining: ${fmt(state.remaining)}`);

  while (state.remaining > 0) {
    const amount = Math.min(PER_TX, state.remaining);
    const txNum = state.txCount + 1;
    log(`[MilesPete] [TX ${txNum}/${totalTxs}] Sending ${fmt(amount)}...`);

    const r = await send(amount);

    if (r.status === 200) {
      state.remaining -= amount;
      state.txCount += 1;
      saveState(state);
      log(`   ✅ Success! Remaining: ${fmt(state.remaining)}`);

      if (state.remaining > 0) {
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

  log(`🎉 COMPLETED! 200B fully delivered from MilesPete to ${TARGET}!`);
}

main().catch(err => log(`Fatal: ${err.message}`));
