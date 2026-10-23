import fs from "node:fs";
import crypto from "node:crypto";

const ACCOUNTS_FILE = "./data/accounts.json";
const STATE_FILE = "./balances_trio_richy244_2t.json";
const LOG_FILE = "./trio_richy244_2t.log";

const TARGET_ID = "aaf02157025449738bf3";
const TARGET_NAME = "Richy244"; // Richy
const TOTAL_TARGET = 2_330_000_000_000; // 2.33 Trillion Total (Extended +200B)

// Extended Split across 3 senders: 810B + 800B + 720B
const ALLOCATIONS = {
  milespete: 810_000_000_000,
  danyeko: 800_000_000_000,
  princedavid: 720_000_000_000
};

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
      targetId: TARGET_ID,
      targetUsername: TARGET_NAME,
      totalTarget: TOTAL_TARGET,
      totalDelivered: 0,
      remaining: TOTAL_TARGET,
      senders: {
        milespete: { target: ALLOCATIONS.milespete, sent: 0, txCount: 0, remaining: ALLOCATIONS.milespete },
        danyeko: { target: ALLOCATIONS.danyeko, sent: 0, txCount: 0, remaining: ALLOCATIONS.danyeko },
        princedavid: { target: ALLOCATIONS.princedavid, sent: 0, txCount: 0, remaining: ALLOCATIONS.princedavid }
      }
    };
  }
}

let writeLock = Promise.resolve();
function updateState(modifierFn) {
  writeLock = writeLock.then(() => {
    const state = loadState();
    modifierFn(state);
    try {
      fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
    } catch (err) {
      log(`⚠️ Failed to save state: ${err.message}`);
    }
  });
  return writeLock;
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

async function runSender(senderKey) {
  const targetAlloc = ALLOCATIONS[senderKey];
  log(`🚀 Initializing leg [@${senderKey}] ➔ @${TARGET_NAME} (Target: ₦${(targetAlloc / 1e9).toFixed(1)}B)...`);

  while (true) {
    const state = loadState();
    const senderData = state.senders[senderKey];

    if (!senderData || senderData.sent >= senderData.target || senderData.remaining <= 0) {
      log(`🏆 [@${senderKey}] Finished allocated ₦${(senderData.sent / 1e9).toFixed(1)}B!`);
      break;
    }

    // Dynamically reload account to pick up refreshed cookies from accounts.json
    const accounts = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, "utf8"));
    const acc = accounts.find(a => a.user.toLowerCase() === senderKey.toLowerCase());

    if (!acc || !acc.cookie) {
      log(`❌ Account ${senderKey} or cookie missing!`);
      await sleep(5000);
      continue;
    }

    const amountToSend = Math.min(CHUNK, senderData.remaining);
    const txIndex = senderData.txCount + 1;
    const totalTxs = Math.ceil(senderData.target / CHUNK);

    log(`[${acc.user} #${txIndex}/${totalTxs}] Sending ₦${(amountToSend / 1e9).toFixed(1)}B chunk to @${TARGET_NAME}...`);
    const result = await sendTransaction(acc.cookie, TARGET_ID, amountToSend);

    if (result.ok) {
      await updateState(s => {
        const sd = s.senders[senderKey];
        sd.sent += amountToSend;
        sd.remaining -= amountToSend;
        sd.txCount += 1;
        s.totalDelivered += amountToSend;
        s.remaining -= amountToSend;
      });

      const updated = loadState();
      const pctSender = ((updated.senders[senderKey].sent / senderData.target) * 100).toFixed(1);
      const pctTotal = ((updated.totalDelivered / updated.totalTarget) * 100).toFixed(1);

      log(`✅ [@${acc.user} ➔ @${TARGET_NAME}] Tx #${txIndex}: Sent ₦${(amountToSend / 1e9).toFixed(1)}B | Leg: ${pctSender}% (₦${(updated.senders[senderKey].sent / 1e9).toFixed(1)}B/₦${(senderData.target / 1e9).toFixed(1)}B) | Total Delivered: ₦${(updated.totalDelivered / 1e12).toFixed(3)}T/₦${(TOTAL_TARGET / 1e12).toFixed(1)}T (${pctTotal}%)`);

      if (updated.senders[senderKey].remaining <= 0) {
        log(`🎉 Leg @${acc.user} completed its full ₦${(senderData.target / 1e9).toFixed(1)}B allocation!`);
        break;
      }

      log(`⚡ [@${acc.user}] Turbo delay ${DELAY_MS / 1000}s before next chunk...\n`);
      await sleep(DELAY_MS);
    } else if (result.status === 429) {
      log(`⏳ [@${acc.user}] Rate limit (429) hit. Rapid re-check in ${RAPID_RETRY_MS / 1000}s...`);
      await sleep(RAPID_RETRY_MS);
    } else if (result.status === 401) {
      log(`🔑 [@${acc.user}] Cookie expired (HTTP 401). Waiting for refreshed cookie in accounts.json (checking every 5s)...`);
      await sleep(5000);
    } else {
      const errMsg = result.data?.error || result.data?.message || result.error || `HTTP ${result.status}`;
      log(`❌ [@${acc.user}] Notice (${result.status || 'Network'}): ${errMsg}`);

      if (result.status === 400 && (String(errMsg).toLowerCase().includes("need") || String(errMsg).toLowerCase().includes("money") || String(errMsg).toLowerCase().includes("balance"))) {
        log(`🛑 [@${acc.user}] Insufficient treasury balance. Leg stopped.`);
        break;
      }

      log(`🔄 [@${acc.user}] Retrying in 5s to see transfer through...`);
      await sleep(5000);
    }
  }
}

async function main() {
  log(`========================================================================`);
  log(`⚡ TRIO TURBO SPLIT PIPELINE: ₦2.0 TRILLION to @${TARGET_NAME} (Richy)`);
  log(`   Target ID: ${TARGET_ID}`);
  log(`   Leg 1: @milespete   ➔ ₦${(ALLOCATIONS.milespete / 1e9).toFixed(1)}B`);
  log(`   Leg 2: @danyeko     ➔ ₦${(ALLOCATIONS.danyeko / 1e9).toFixed(1)}B`);
  log(`   Leg 3: @princedavid ➔ ₦${(ALLOCATIONS.princedavid / 1e9).toFixed(1)}B`);
  log(`   Timing: 20.5s turbo interval | Rapid 2.5s retry on 429`);
  log(`========================================================================\n`);

  await Promise.all([
    runSender("milespete"),
    runSender("danyeko"),
    runSender("princedavid")
  ]);

  const finalState = loadState();
  log(`\n🏆 TRIO PIPELINE 100% COMPLETE! Total Delivered to @${TARGET_NAME}: ₦${(finalState.totalDelivered / 1e12).toFixed(2)}T / ₦${(TOTAL_TARGET / 1e12).toFixed(1)}T`);
}

main().catch(console.error);
