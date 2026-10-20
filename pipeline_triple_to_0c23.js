import fs from "node:fs";
import crypto from "node:crypto";

const TARGET = "0c23085e4e034aca929d";
const PER_TX = 10_000_000_000;       // 10B per tx
const DELAY = 25000;                 // 25s between txs
const RETRY_DELAY = 5000;            // 5s on 429 / error
const LOG_FILE = "./pipeline_triple_to_0c23.log";

const ACCOUNTS = [
  {
    name: "MilesPete",
    sender: "milespete",
    total: 200_000_000_000,          // 200B
    cookie: "ll_dev=2l08616a3s395t0d; ll_vid=102f439367af4102b904; ll_session=7905085c7b02a4e840a338dd3484f8995d019cd955fdf7d8f1c2a7ba846d1ee0; ll_pass=eyJpIjoiYmM3NDU4Mzc5MzVkNDVlZmJmNDciLCJ1IjoibWlsZXNwZXRlIiwibiI6Ik1pbGVzIFBldGVyIiwidCI6IlJPZXdwcjRWTlVNRE9uLUkiLCJlIjoxNzkyNDA0OTAyODk1fQ.wyQw5T4rXT32ZYfwVpvzddrsOPc4qM50CFHT6W-awrQ",
    stateFile: "./balances_miles_to_0c23_200b.json"
  },
  {
    name: "PrinceDavid",
    sender: "princedavid",
    total: 200_000_000_000,          // 200B
    cookie: "ll_dev=5e6j3b5q0h1w6544; ll_vid=41df63d592034b448922; ll_session=9bcfef2875bb6d192379de4fb4927479f6f68ed8205e6e0b4ce45c76c295bc99; ll_pass=eyJpIjoiN2U3OTE3NjBjZDY0NGYxM2JhNWEiLCJ1IjoicHJpbmNlZGF2aWQiLCJuIjoiUHJpbmNlRGF2aWQiLCJ0IjoiMVB1VDQwckFCTkZkdVFtZCIsImUiOjE3OTI0MDQ0NDU2Nzh9.KJyUzDIsOIJuNGvB8QrKY8oSCeUo8tJcvtHcbPmhduU",
    stateFile: "./balances_prince_to_0c23_200b.json"
  },
  {
    name: "Blaq",
    sender: "blaqsebastian",
    total: 100_000_000_000,          // 100B
    cookie: "ll_dev=4o3z111w5i470l2f; ll_vid=2fe99f9ce0624c4abb14; ll_session=0eb20df322921c02aa976d9fa6d5a813021046eb1ea390f00d26a9646abd3718; ll_pass=eyJpIjoiNzc4NWNhZTRmMTU3NDUwNDkwZDUiLCJ1IjoiYmxhcXNlYmFzdGlhbiIsIm4iOiJTZWJhc3RpYW4iLCJ0Ijoid1hPLXRkQ2ZyVW4zbkJNbiIsImUiOjE3OTIzNDQ1MzI5MTV9.Bxn8glwFir1I4AoRyCRSppJSdA5EyrN6uXS24YqdB20",
    stateFile: "./balances_blaq_to_0c23_100b.json"
  }
];

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

function loadState(acc) {
  try {
    return JSON.parse(fs.readFileSync(acc.stateFile, "utf8"));
  } catch {
    return {
      sender: acc.sender,
      target: TARGET,
      total: acc.total,
      remaining: acc.total,
      txCount: 0,
      timestamp: new Date().toISOString()
    };
  }
}

function saveState(acc, s) {
  s.timestamp = new Date().toISOString();
  fs.writeFileSync(acc.stateFile, JSON.stringify(s, null, 2));
}

async function sendFromAccount(acc, amount) {
  const key = crypto.randomUUID();
  try {
    const resp = await fetch("https://lagoslife.app/api/send", {
      method: "POST",
      headers: {
        "accept": "application/json",
        "content-type": "application/json",
        "cookie": acc.cookie,
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

async function runWorker(acc) {
  const state = loadState(acc);
  const totalTxs = Math.ceil(acc.total / PER_TX);
  log(`🚀 [${acc.name}] Starting -> ${TARGET} | Target: ${fmt(acc.total)} | Remaining: ${fmt(state.remaining)}`);

  while (state.remaining > 0) {
    const amount = Math.min(PER_TX, state.remaining);
    const txNum = state.txCount + 1;
    log(`[${acc.name}] [TX ${txNum}/${totalTxs}] Sending ${fmt(amount)}...`);

    const r = await sendFromAccount(acc, amount);

    if (r.status === 200) {
      state.remaining -= amount;
      state.txCount += 1;
      saveState(acc, state);
      log(`   ✅ [${acc.name}] Success! Remaining: ${fmt(state.remaining)}`);

      if (state.remaining > 0) {
        await new Promise(res => setTimeout(res, DELAY));
      }
    } else if (r.status === 429) {
      log(`   ⚠️ [${acc.name}] Rate limit (429). Retrying in ${RETRY_DELAY/1000}s...`);
      await new Promise(res => setTimeout(res, RETRY_DELAY));
    } else {
      log(`   ❌ [${acc.name}] Error ${r.status}: ${JSON.stringify(r.data || r.error)}. Retrying in ${RETRY_DELAY/1000}s...`);
      await new Promise(res => setTimeout(res, RETRY_DELAY));
    }
  }

  log(`🎉 [${acc.name}] COMPLETED! ${fmt(acc.total)} fully delivered to ${TARGET}!`);
}

async function main() {
  log("==================================================");
  log(`🚀 STARTING TRIPLE PIPELINE TO ${TARGET}`);
  log("1. MilesPete   : 200B (20 txs)");
  log("2. PrinceDavid : 200B (20 txs)");
  log("3. Blaq        : 100B (10 txs)");
  log(`Total to deliver: 500B`);
  log("==================================================");

  // Run all 3 accounts in parallel
  await Promise.all(ACCOUNTS.map(acc => runWorker(acc)));

  log("\n🎉🎉 ALL 3 TRANSFERS COMPLETED! Total 500B delivered to " + TARGET);
}

main().catch(err => log(`Fatal runner error: ${err.message}`));
