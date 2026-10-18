import fs from "node:fs";
import crypto from "node:crypto";

const COOKIE = "ll_dev=4o3z111w5i470l2f; ll_vid=2fe99f9ce0624c4abb14; ll_session=7ea30e0eb313e812e47a96b82b6964f5c6a9988924f0f9ca0aa0572a22745653; ll_pass=eyJpIjoiNzc4NWNhZTRmMTU3NDUwNDkwZDUiLCJ1IjoiYmxhcXNlYmFzdGlhbiIsIm4iOiJTZWJhc3RpYW4iLCJ0IjoiNnNUWGRJaWdPcEVGNmRldyIsImUiOjE3OTIyMDkyMTczNjB9.G2Yg_icwcsE-IoLU8u2mRnWgBonirEBzGqQT00Cjtmw";

const TARGET = "a8dca121858345689136";
const TOTAL = 50_000_000_000;        // 50B
const PER_TX = 10_000_000_000;       // 10B per tx
const DELAY = 25000;                 // 25s between txs
const RETRY_DELAY = 5000;            // 5s on 429 / error
const STATE_FILE = "./balances_blaq_to_a8dc_50b.json";

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
  console.log(`\n💸 Blaq → ${TARGET} | Target: ${fmt(TOTAL)} | Per TX: ${fmt(PER_TX)} | Remaining: ${fmt(state.remaining)}`);
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
}

main().catch(console.error);
