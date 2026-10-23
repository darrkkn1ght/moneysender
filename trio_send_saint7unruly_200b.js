import fs from "node:fs";
import crypto from "node:crypto";

const ACCOUNTS_FILE = "./data/accounts.json";
const STATE_FILE = "./balances_trio_saint7unruly_200b.json";
const LOG_FILE = "./trio_saint7unruly_200b.log";

const TARGET_ID = "43719685e1df483f834d";
const TARGET_NAME = "Saint7unruly"; // Ogine Kenneth
const TOTAL_TARGET = 200_000_000_000; // 200 Billion Total

// Trio Split across 3 senders: 70B (milespete) + 70B (danyeko) + 60B (princedavid) = 200B
const ALLOCATIONS = {
  milespete: 70_000_000_000,
  danyeko: 70_000_000_000,
  princedavid: 60_000_000_000
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

async function runSender(senderKey) {
  const targetAlloc = ALLOCATIONS[senderKey];
  log(`🚀 Starting leg [@${senderKey}] ➔ @${TARGET_NAME} (Target: ₦${(targetAlloc / 1e9).toFixed(1)}B)...`);

  while (true) {
    const state = loadState();
    const senderData = state.senders[senderKey];

    if (!senderData || senderData.sent >= senderData.target || senderData.remaining <= 0) {
      log(`🏆 [@${senderKey}] Finished allocated ₦${(senderData.sent / 1e9).toFixed(1)}B!`);
      break;
    }

    const currentTxNumber = senderData.txCount + 1;
    const totalLegTxs = Math.ceil(senderData.target / CHUNK);
    const amountToSend = Math.min(CHUNK, senderData.remaining);

    // Refresh cookie
    const accounts = loadAccounts();
    const acc = accounts[senderKey.toLowerCase()];
    if (!acc || !acc.cookie) {
      log(`❌ [@${senderKey}] Missing credentials in ${ACCOUNTS_FILE}. Waiting 10s...`);
      await sleep(10000);
      continue;
    }

    log(`[${senderKey} #${currentTxNumber}/${totalLegTxs}] Sending ₦${(amountToSend / 1e9).toFixed(1)}B chunk to @${TARGET_NAME}...`);
    const res = await sendTransaction(acc.cookie, TARGET_ID, amountToSend);

    if (res.ok) {
      await updateState(s => {
        const curSender = s.senders[senderKey];
        curSender.sent += amountToSend;
        curSender.txCount += 1;
        curSender.remaining = Math.max(0, curSender.target - curSender.sent);

        s.totalDelivered = Object.values(s.senders).reduce((sum, item) => sum + item.sent, 0);
        s.remaining = Math.max(0, s.totalTarget - s.totalDelivered);
      });

      const updated = loadState();
      const pctLeg = ((updated.senders[senderKey].sent / targetAlloc) * 100).toFixed(1);
      const pctTotal = ((updated.totalDelivered / TOTAL_TARGET) * 100).toFixed(1);

      log(`✅ [@${senderKey} ➔ @${TARGET_NAME}] Tx #${currentTxNumber}: Sent ₦${(amountToSend / 1e9).toFixed(1)}B | Leg: ${pctLeg}% (₦${(updated.senders[senderKey].sent / 1e9).toFixed(1)}B/₦${(targetAlloc / 1e9).toFixed(1)}B) | Total Delivered: ₦${(updated.totalDelivered / 1e9).toFixed(1)}B/₦${(TOTAL_TARGET / 1e9).toFixed(1)}B (${pctTotal}%)`);

      if (updated.senders[senderKey].remaining <= 0) {
        log(`🎉 Leg @${senderKey} completed its full ₦${(targetAlloc / 1e9).toFixed(1)}B allocation!`);
        break;
      }

      log(`⚡ [@${senderKey}] Turbo delay ${(DELAY_MS / 1000).toFixed(1)}s before next chunk...\n`);
      await sleep(DELAY_MS);
    } else if (res.status === 429) {
      log(`⏳ [@${senderKey}] Rate limit (429) hit. Rapid re-check in ${(RAPID_RETRY_MS / 1000).toFixed(1)}s...`);
      await sleep(RAPID_RETRY_MS);
    } else {
      log(`⚠️ [@${senderKey}] Error ${res.status}: ${JSON.stringify(res.data || res.error)}. Retrying in 5s...`);
      await sleep(5000);
    }
  }
}

async function main() {
  log("=================================================");
  log(`🌟 TRIO PIPELINE: +₦200.0B to @${TARGET_NAME} (${TARGET_ID})`);
  log(`   Allocations: milespete (₦70B) + danyeko (₦70B) + princedavid (₦60B) = ₦200B`);
  log(`   Chunk size: ₦10.0B | Delay: ${DELAY_MS / 1000}s | Fast retry: ${RAPID_RETRY_MS / 1000}s`);
  log("=================================================\n");

  updateState(s => {
    // initialize if not exists
    s.targetId = TARGET_ID;
    s.targetUsername = TARGET_NAME;
    s.totalTarget = TOTAL_TARGET;
  });

  const senders = ["milespete", "danyeko", "princedavid"];
  await Promise.all(senders.map(s => runSender(s)));

  const finalState = loadState();
  log(`\n🏆 TRIO PIPELINE 100% COMPLETE! Total Delivered to @${TARGET_NAME}: ₦${(finalState.totalDelivered / 1e9).toFixed(1)}B / ₦${(TOTAL_TARGET / 1e9).toFixed(1)}B\n`);
}

main().catch(err => {
  log(`🔥 Fatal error: ${err.message}`);
  process.exit(1);
});
