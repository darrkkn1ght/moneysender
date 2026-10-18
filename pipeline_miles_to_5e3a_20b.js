import fs from "node:fs";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";

const COOKIE = "ll_dev=2l08616a3s395t0d; ll_vid=102f439367af4102b904; ll_session=7905085c7b02a4e840a338dd3484f8995d019cd955fdf7d8f1c2a7ba846d1ee0; ll_pass=eyJpIjoiYmM3NDU4Mzc5MzVkNDVlZmJmNDciLCJ1IjoibWlsZXNwZXRlIiwibiI6Ik1pbGVzIFBldGVyIiwidCI6IlJPZXdwcjRWTlVNRE9uLUkiLCJlIjoxNzkyMTkxNzM5MDAyfQ.B_AravqWaFLL7xITuYZWd4NqV1qt7oTQkdfm1Wh8GfA";

const TARGET = "5e3a06c4e5a14356b17f";
const TOTAL = 20_000_000_000;         // 20B
const PER_TX = 10_000_000_000;        // 10B per tx
const DELAY = 25000;                  // 25s between txs
const RETRY_DELAY = 5000;             // 5s on 429 / error
const STATE_FILE = "./balances_miles_to_5e3a_20b.json";

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, "utf8")); }
  catch { return { target: TARGET, remaining: TOTAL, txCount: 0 }; }
}
function saveState(s) { fs.writeFileSync(STATE_FILE, JSON.stringify(s)); }

function fmt(n) {
  if (n >= 1e12) return (n/1e12).toFixed(2)+"T";
  if (n >= 1e9) return (n/1e9).toFixed(2)+"B";
  if (n >= 1e6) return (n/1e6).toFixed(2)+"M";
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

async function main() {
  const state = loadState();
  const totalTxs = Math.ceil(TOTAL / PER_TX);
  console.log(`\n💸 MilesPete → ${TARGET} | Target: ${fmt(TOTAL)} | Per TX: ${fmt(PER_TX)} | Remaining: ${fmt(state.remaining)}`);
  console.log(`   TX ${state.txCount}/${totalTxs} done\n`);

  while (state.remaining > 0) {
    const amount = Math.min(PER_TX, state.remaining);
    const txNum = state.txCount + 1;
    console.log(`[TX ${txNum}/${totalTxs}] Sending ${fmt(amount)}...`);

    const r = await send(amount);

    if (r.status === 200) {
      state.remaining -= amount;
      state.txCount++;
      saveState(state);
      const pct = (((TOTAL - state.remaining) / TOTAL) * 100).toFixed(1);
      console.log(`  ✅ OK | Remaining: ${fmt(state.remaining)} (${pct}%) | ${new Date().toLocaleTimeString()}`);
      if (state.remaining > 0) await new Promise(r => setTimeout(r, DELAY));
    } else if (r.status === 429) {
      console.log(`  ⏳ Rate limited, retry in ${RETRY_DELAY/1000}s...`);
      await new Promise(r => setTimeout(r, RETRY_DELAY));
    } else if (r.status === 0) {
      console.log(`  ⚠️ Network error (${r.error}), retry in ${RETRY_DELAY/1000}s...`);
      await new Promise(r => setTimeout(r, RETRY_DELAY));
    } else if (r.status === 401) {
      console.log(`  🔒 Session expired! Status: ${r.status}`, r.data);
      process.exit(1);
    } else {
      console.log(`  ❌ Error ${r.status}:`, r.data);
      await new Promise(r => setTimeout(r, RETRY_DELAY));
    }
  }

  console.log(`\n🎉 DONE! Sent ${fmt(TOTAL)} to ${TARGET} in ${state.txCount} transactions.`);
  
  console.log(`\n========================================`);
  console.log(`▶️ AUTO-STARTING NEXT IN QUEUE: pipeline_miles_to_135e_200b.js`);
  console.log(`========================================\n`);
  spawnSync("node", ["pipeline_miles_to_135e_200b.js"], { stdio: "inherit" });
}

main().catch(console.error);
