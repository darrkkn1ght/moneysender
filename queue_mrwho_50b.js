import fs from "node:fs";
import crypto from "node:crypto";

const COOKIE = "ll_dev=0u144y403y0n5o4c; ll_session=30ed25151a51189b01b77ec860906bcf4ff53eef06599f910f94fa3b4f329fba; ll_pass=eyJpIjoiZDRmNGFlZDk0ZDZlNDkxOTg5Y2YiLCJ1IjoibXJfd2hvIiwibiI6Iklka3dldHVsbWEiLCJ0IjoicHdjNFB1U3R0M2ROZ0ZkVCIsImUiOjE3OTIzNzQ0Nzg5NDd9.n3er-Yhh5QKWtVnl12SnIDGNgYt6MHD1P1qv0uuRJng";

// Target list with duplicate prevention
const TARGETS = [
  "c7489817fac34462bff6",
  "e83b6bfdce94446c80f8",
  "f235bfaab7764d83845e"
  // d77c9642f6704f7ab60a already received 50B in the previous step
];

const AMOUNT_PER_PERSON = 50_000_000_000; // 50B
const PER_TX = 10_000_000_000;            // 10B
const DELAY = 25000;                      // 25s between successful txs
const RETRY_DELAY = 5000;                 // 5s on 429
const STATE_FILE = "./queue_mrwho_state.json";
const LOG_FILE = "./queue_mrwho.log";

function log(msg) {
  const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
  console.log(line);
  try {
    fs.appendFileSync(LOG_FILE, line + "\n");
  } catch {}
}

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {
    const s = {};
    for (const t of TARGETS) {
      s[t] = { target: t, remaining: AMOUNT_PER_PERSON, txCount: 0, completed: false };
    }
    return s;
  }
}

function saveState(s) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
}

function fmt(n) {
  if (n >= 1e12) return (n / 1e12).toFixed(2) + "T";
  if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
  return n.toLocaleString();
}

async function send(to, amount) {
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
      body: JSON.stringify({ to, amount })
    });
    return { status: resp.status, data: await resp.json().catch(() => ({})) };
  } catch (err) {
    return { status: 0, error: err.message || String(err) };
  }
}

export async function main() {
  const state = loadState();
  log("==================================================");
  log("📋 MR_WHO BATCH QUEUE RUNNER (50B Each)");
  log(`   Targets queued: ${TARGETS.length}`);
  log("   (d77c9642f6704f7ab60a excluded as already sent)");
  log("==================================================");

  for (let idx = 0; idx < TARGETS.length; idx++) {
    const targetId = TARGETS[idx];
    if (!state[targetId]) {
      state[targetId] = { target: targetId, remaining: AMOUNT_PER_PERSON, txCount: 0, completed: false };
    }

    const tState = state[targetId];
    if (tState.remaining === 0 || tState.completed) {
      log(`⏩ [${idx + 1}/${TARGETS.length}] Target ${targetId} already completed! Skipping...`);
      continue;
    }

    const totalTxs = Math.ceil(AMOUNT_PER_PERSON / PER_TX);
    log(`\n🚀 [${idx + 1}/${TARGETS.length}] Starting transfer to ${targetId} | Remaining: ${fmt(tState.remaining)}`);

    while (tState.remaining > 0) {
      const amount = Math.min(PER_TX, tState.remaining);
      const txNum = tState.txCount + 1;
      log(`   [Target ${idx + 1} | TX ${txNum}/${totalTxs}] Sending ${fmt(amount)} to ${targetId}...`);

      const r = await send(targetId, amount);

      if (r.status === 200) {
        tState.remaining -= amount;
        tState.txCount++;
        if (tState.remaining === 0) tState.completed = true;
        saveState(state);
        const sent = AMOUNT_PER_PERSON - tState.remaining;
        const pct = ((sent / AMOUNT_PER_PERSON) * 100).toFixed(1);
        log(`   ✅ OK | Sent: ${fmt(sent)} | Remaining: ${fmt(tState.remaining)} (${pct}%)`);
        if (tState.remaining > 0) await new Promise(r => setTimeout(r, DELAY));
      } else if (r.status === 429) {
        log(`   ⏳ Rate limited (429), retrying in ${RETRY_DELAY / 1000}s...`);
        await new Promise(r => setTimeout(r, RETRY_DELAY));
      } else if (r.status === 0) {
        log(`   ⚠️ Network error (${r.error}), retrying in ${RETRY_DELAY / 1000}s...`);
        await new Promise(r => setTimeout(r, RETRY_DELAY));
      } else if (r.status === 401) {
        log(`   🔒 Session expired! Status: ${r.status}`);
        process.exit(1);
      } else {
        log(`   ❌ Error ${r.status}: ${JSON.stringify(r.data)}`);
        await new Promise(r => setTimeout(r, RETRY_DELAY));
      }
    }

    log(`✅ [${idx + 1}/${TARGETS.length}] Completed 50B transfer to ${targetId}!`);
    if (idx < TARGETS.length - 1) {
      log(`⏳ Waiting 25s before next recipient in queue...`);
      await new Promise(r => setTimeout(r, DELAY));
    }
  }

  log("\n🎉 ALL QUEUED TRANSFERS COMPLETED!");
}

if (process.argv[1]?.includes("queue_mrwho_50b.js")) {
  main().catch(console.error);
}
