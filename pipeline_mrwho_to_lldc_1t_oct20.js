import fs from "node:fs";
import crypto from "node:crypto";

const TARGET = "802ef46ea4eb4b1b8b47"; // LLDC
const USERNAME = "LLDC";
const SENDER_NAME = "mr_who";
const TOTAL = 1_000_000_000_000;       // 1T
const PER_TX = 10_000_000_000;         // 10B per tx
const DELAY = 25000;
const RETRY_DELAY = 5000;
const STATE_FILE = "./balances_mrwho_to_lldc_1t_oct20.json";
const LOG_FILE = "./pipeline_mrwho_to_lldc_1t_oct20.log";

const COOKIE = "ll_dev=0u144y403y0n5o4c; ll_session=30ed25151a51189b01b77ec860906bcf4ff53eef06599f910f94fa3b4f329fba; ll_vid=6f8f48ee77d84176833b; ll_pass=eyJpIjoiZDRmNGFlZDk0ZDZlNDkxOTg5Y2YiLCJ1IjoibXJfd2hvIiwibiI6Iklka3dldHVsbWEiLCJ0IjoicHdjNFB1U3R0M2ROZ0ZkVCIsImUiOjE3OTI0MzAwNTY0MDF9.wr29SLka5_4Xba5zcPiq9Aqe0qXtzmlBqv3kJKS1dIY";

function log(msg) {
  const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
  console.log(line);
  try { fs.appendFileSync(LOG_FILE, line + "\n"); } catch {}
}

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, "utf8")); }
  catch { return { sender: SENDER_NAME, target: TARGET, username: USERNAME, remaining: TOTAL, txCount: 0 }; }
}
function saveState(s) { fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2)); }

function fmt(n) {
  if (n >= 1e12) return (n/1e12).toFixed(2) + "T";
  if (n >= 1e9) return (n/1e9).toFixed(2) + "B";
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
  log(`💸 @${SENDER_NAME} → @${USERNAME} (${TARGET}) | Target: ${fmt(TOTAL)} | Remaining: ${fmt(state.remaining)} | TX ${state.txCount}/${totalTxs}`);

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
      log(`[TX ${txNum}/${totalTxs}] Rate limited (429). Retrying in 5s...`);
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
  log(`🎉 Completed! Sent ${fmt(TOTAL)} from @${SENDER_NAME} to @${USERNAME}.`);
}

main().catch(err => { log("Fatal: " + err); process.exit(1); });
