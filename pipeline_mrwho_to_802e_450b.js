import fs from "node:fs";
import crypto from "node:crypto";

const TARGET = "802ef46ea4eb4b1b8b47";
const TOTAL = 450_000_000_000;       // 450B
const PER_TX = 10_000_000_000;        // 10B per tx
const DELAY = 25000;                  // 25s between txs
const RETRY_DELAY = 5000;             // 5s on 429 / error
const STATE_FILE = "./balances_mrwho_to_802e_450b.json";
const LOG_FILE = "./pipeline_mrwho_to_802e_450b.log";

const COOKIE = "ll_dev=0u144y403y0n5o4c; ll_session=30ed25151a51189b01b77ec860906bcf4ff53eef06599f910f94fa3b4f329fba; ll_vid=6f8f48ee77d84176833b; ll_pass=eyJpIjoiZDRmNGFlZDk0ZDZlNDkxOTg5Y2YiLCJ1IjoibXJfd2hvIiwibiI6Iklka3dldHVsbWEiLCJ0IjoicHdjNFB1U3R0M2ROZ0ZkVCIsImUiOjE3OTI0MzAwNTY0MDF9.wr29SLka5_4Xba5zcPiq9Aqe0qXtzmlBqv3kJKS1dIY";

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
  catch { return { sender: "mr_who", target: TARGET, total: TOTAL, remaining: TOTAL, txCount: 0 }; }
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
        "origin": "https://lagoslife.app",
        "referer": "https://lagoslife.app/",
        "cookie": COOKIE,
        "idempotency-key": key,
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36"
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
  log(`💸 mr_who -> ${TARGET} | Target: ${fmt(TOTAL)} | Remaining: ${fmt(state.remaining)}`);

  while (state.remaining > 0) {
    const amount = Math.min(PER_TX, state.remaining);
    const txNum = state.txCount + 1;
    log(`[mr_who] [TX ${txNum}/${totalTxs}] Sending ${fmt(amount)}...`);

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

  log(`🎉 COMPLETED! 450B fully delivered from mr_who to ${TARGET}!`);
}

main().catch(err => log(`Fatal: ${err.message}`));
