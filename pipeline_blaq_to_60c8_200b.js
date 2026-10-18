import fs from "node:fs";
import crypto from "node:crypto";

const COOKIE = "ll_dev=4o3z111w5i470l2f; ll_vid=2fe99f9ce0624c4abb14; ll_session=c0a17f10cf24947e9b87549591023ffaf52ecc947a5963da92c6fe5d95abda86; ll_pass=eyJpIjoiNzc4NWNhZTRmMTU3NDUwNDkwZDUiLCJ1IjoiYmxhcXNlYmFzdGlhbiIsIm4iOiJTZWJhc3RpYW4iLCJ0IjoiazBIdUtRd3pKV2w1M0pSNiIsImUiOjE3OTIwODU5ODI5MTd9.E_og7hq2w9ItZKs7wegJiq3hCTVZzbBsIynZA3R_S4Y";

const TARGET = "60c83bc89dfb4a0d8575";
const TOTAL = 200_000_000_000;       // 200B
const PER_TX = 10_000_000_000;       // 10B per tx
const DELAY = 25000;                 // 25s between txs
const RETRY_DELAY = 5000;            // 5s on 429 / error
const STATE_FILE = "./balances_blaq_to_60c8_200b.json";

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, "utf8")); }
  catch { return { target: TARGET, remaining: TOTAL - PER_TX, txCount: 1 }; }
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
  console.log(`   TX ${state.txCount}/${totalTxs} done (First 10B already delivered)\n`);

  if (state.remaining > 0) {
    console.log(`⏳ Waiting initial ${DELAY/1000}s cooldown before next transfer...`);
    await new Promise(r => setTimeout(r, DELAY));
  }

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
