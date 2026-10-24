import fs from "node:fs";
import crypto from "node:crypto";

const ACCOUNTS_FILE = "./data/accounts.json";
const STATE_FILE = "./balances_miles_to_hossanah_50b.json";
const LOG_FILE = "./miles_to_hossanah_50b.log";

const SENDER_KEY = "milespete";
const TARGET_ID = "cb3f94dac1304e1f87b5";
const TARGET_NAME = "hossanah"; // Hossanah Matthew
const TOTAL_TARGET = 50_000_000_000; // 50 Billion Total

const CHUNK = 10_000_000_000;         // 10B per tx
const DELAY_MS = 20_500;             // 20.5s turbo interval
const RAPID_RETRY_MS = 2_500;        // 2.5s quick retry on 429

function log(msg) {
  const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
  console.log(line);
  try {
    fs.appendFileSync(LOG_FILE, line + "\n");
  } catch {}
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {
    return {
      sender: SENDER_KEY,
      targetId: TARGET_ID,
      targetUsername: TARGET_NAME,
      totalTarget: TOTAL_TARGET,
      totalDelivered: 0,
      remaining: TOTAL_TARGET,
      txCount: 0
    };
  }
}

function saveState(state) {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch (err) {
    log(`⚠️ Failed to save state: ${err.message}`);
  }
}

function loadAccounts() {
  const raw = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, "utf8"));
  const byUser = {};
  for (const acc of raw) {
    if (acc.user) byUser[acc.user.toLowerCase()] = acc;
  }
  return byUser;
}

async function sendTransaction(cookie, targetId, amount) {
  const idempotencyKey = crypto.randomUUID();
  try {
    const resp = await fetch("https://lagoslife.app/api/send", {
      method: "POST",
      headers: {
        "cookie": cookie,
        "content-type": "application/json",
        "accept": "application/json",
        "idempotency-key": idempotencyKey,
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
      },
      body: JSON.stringify({ to: targetId, amount })
    });

    const data = await resp.json().catch(() => ({}));
    return { status: resp.status, ok: resp.ok, data };
  } catch (err) {
    return { status: 0, ok: false, error: err.message };
  }
}

async function main() {
  log("=================================================");
  log(`🚀 PIPELINE: @${SENDER_KEY} ➔ @${TARGET_NAME} (₦50.0 Billion)`);
  log(`   Chunk size: ₦10.0B | Delay: ${DELAY_MS / 1000}s | Fast retry: ${RAPID_RETRY_MS / 1000}s`);
  log("=================================================\n");

  const totalTxs = Math.ceil(TOTAL_TARGET / CHUNK);

  while (true) {
    const state = loadState();

    if (state.totalDelivered >= state.totalTarget || state.remaining <= 0) {
      log(`🏆 Finished delivering full ₦${(state.totalDelivered / 1e9).toFixed(1)}B to @${TARGET_NAME}!`);
      break;
    }

    const currentTxNumber = state.txCount + 1;
    const amountToSend = Math.min(CHUNK, state.remaining);

    // Refresh cookie
    const accounts = loadAccounts();
    const acc = accounts[SENDER_KEY.toLowerCase()];
    if (!acc || !acc.cookie) {
      log(`❌ [@${SENDER_KEY}] Missing credentials in ${ACCOUNTS_FILE}. Waiting 10s...`);
      await sleep(10000);
      continue;
    }

    log(`[${SENDER_KEY} #${currentTxNumber}/${totalTxs}] Sending ₦${(amountToSend / 1e9).toFixed(1)}B chunk to @${TARGET_NAME}...`);
    const res = await sendTransaction(acc.cookie, TARGET_ID, amountToSend);

    if (res.ok) {
      state.totalDelivered += amountToSend;
      state.txCount += 1;
      state.remaining = Math.max(0, state.totalTarget - state.totalDelivered);
      saveState(state);

      const pctTotal = ((state.totalDelivered / TOTAL_TARGET) * 100).toFixed(1);
      log(`✅ [@${SENDER_KEY} ➔ @${TARGET_NAME}] Tx #${currentTxNumber}: Sent ₦${(amountToSend / 1e9).toFixed(1)}B | Total Delivered: ₦${(state.totalDelivered / 1e9).toFixed(1)}B/₦${(TOTAL_TARGET / 1e9).toFixed(1)}B (${pctTotal}%)`);

      if (state.remaining <= 0) {
        log(`🎉 Completed full ₦${(TOTAL_TARGET / 1e9).toFixed(1)}B transfer!`);
        break;
      }

      log(`⚡ [@${SENDER_KEY}] Turbo delay ${(DELAY_MS / 1000).toFixed(1)}s before next chunk...\n`);
      await sleep(DELAY_MS);
    } else if (res.status === 429) {
      log(`⏳ [@${SENDER_KEY}] Rate limit (429) hit. Rapid re-check in ${(RAPID_RETRY_MS / 1000).toFixed(1)}s...`);
      await sleep(RAPID_RETRY_MS);
    } else {
      log(`⚠️ [@${SENDER_KEY}] Error ${res.status}: ${JSON.stringify(res.data || res.error)}. Retrying in 5s...`);
      await sleep(5000);
    }
  }

  const finalState = loadState();
  log(`\n🏆 PIPELINE 100% COMPLETE! Total Delivered to @${TARGET_NAME}: ₦${(finalState.totalDelivered / 1e9).toFixed(1)}B / ₦${(TOTAL_TARGET / 1e9).toFixed(1)}B\n`);
}

main().catch(err => {
  log(`🔥 Fatal error: ${err.message}`);
  process.exit(1);
});
