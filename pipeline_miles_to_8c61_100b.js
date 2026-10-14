import fs from "node:fs/promises";

const TARGET = 100_000_000_000n; // 100B (10 x 10B)
const PER_TRANSACTION = 10_000_000_000n; // 10B
const DELAY = 21_000;

const TO = "8c616165868241888f5c";
const COOKIE = "ll_dev=2l08616a3s395t0d; ll_session=1d12f55f7b42a1050b3161e5723deaa18ebe88a9e71ce962926a0e3c3768278e; ll_pass=eyJpIjoiYmM3NDU4Mzc5MzVkNDVlZmJmNDciLCJ1IjoibWlsZXNwZXRlIiwibiI6Ik1pbGVzIFBldGVyIiwidCI6ImU2RWE4Tl93RkRhUEdaRzUiLCJlIjoxNzkxODI3NjU5MjE3fQ.ou28AKC904prDpfvO1Dq130fmcq1nI98Itfm0q-XP-k; ll_vid=102f439367af4102b904";

const STATE_FILE = "./balances_8c61_100b.json";

const MAX_RETRIES = 100;
const RETRY_DELAY = 5_000;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function loadState() {
  try {
    const text = await fs.readFile(STATE_FILE, "utf8");
    return JSON.parse(text);
  } catch (error) {
    if (error.code === "ENOENT") {
      return {};
    }
    throw error;
  }
}

async function saveState(state) {
  const tempFile = `${STATE_FILE}.tmp`;
  await fs.writeFile(tempFile, JSON.stringify(state, null, 2), "utf8");
  await fs.rename(tempFile, STATE_FILE);
}

async function send(amount, transactionId) {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      console.log(`[Miles -> 8c61] Attempt ${attempt}/${MAX_RETRIES}: sending ${amount.toString()}`);

      const response = await fetch("https://lagoslife.eliysites.com/api/send", {
        method: "POST",
        headers: {
          "accept": "*/*",
          "content-type": "application/json",
          "origin": "https://lagoslife.eliysites.com",
          "referer": "https://lagoslife.eliysites.com/",
          "cookie": COOKIE,
          "idempotency-key": transactionId
        },
        body: JSON.stringify({
          to: TO,
          amount: Number(amount)
        })
      });

      const text = await response.text();
      console.log(`[Miles -> 8c61] [${new Date().toLocaleTimeString()}] ${amount.toString()} → ${response.status}`, text);

      if (response.ok) {
        return;
      }
      console.log(`[Miles -> 8c61] Server returned ${response.status}.`);

      if (text.includes("game saves every minute") || text.includes("You need")) {
        console.log("[Miles -> 8c61] Balance sync pending. Waiting 15 seconds...");
        await sleep(15_000);
        continue;
      }
    } catch (error) {
      console.log(`[Miles -> 8c61] Network error on attempt ${attempt}:`, error.code ?? error.message);
    }

    console.log(`[Miles -> 8c61] Retrying in ${RETRY_DELAY / 1000} seconds...`);
    await sleep(RETRY_DELAY);
  }

  throw new Error(`[Miles -> 8c61] Failed to send after ${MAX_RETRIES} attempts`);
}

async function main() {
  const state = await loadState();

  if (!state[TO]) {
    state[TO] = {
      target: TARGET.toString(),
      remaining: TARGET.toString(),
      transaction: 0
    };
    await saveState(state);
  }

  let remaining = BigInt(state[TO].remaining);
  let transaction = state[TO].transaction;

  console.log(`[Miles -> 8c61] Starting Pipeline: 100B to ${TO}`);
  console.log(`[Miles -> 8c61] Already sent: ${(TARGET - remaining).toString()}`);
  console.log(`[Miles -> 8c61] Remaining: ${remaining.toString()}`);

  while (remaining > 0n) {
    transaction++;
    const amount = remaining >= PER_TRANSACTION ? PER_TRANSACTION : remaining;
    const transactionId = `m28c61-100b-${TO}-${transaction}`;

    console.log(`[Miles -> 8c61] Transaction ${transaction}: sending ${amount.toString()}`);

    try {
      await send(amount, transactionId);
    } catch (error) {
      console.error("[Miles -> 8c61] Retries failed.");
      state[TO] = {
        target: TARGET.toString(),
        remaining: remaining.toString(),
        transaction: transaction - 1
      };
      await saveState(state);
      throw error;
    }

    remaining -= amount;
    state[TO] = {
      target: TARGET.toString(),
      remaining: remaining.toString(),
      transaction
    };
    await saveState(state);

    console.log(`[Miles -> 8c61] Remaining: ${remaining.toString()}`);

    if (remaining > 0n) {
      await sleep(DELAY);
    }
  }

  console.log("[Miles -> 8c61] 100B Pipeline Complete! 🎉");
}

main().catch(console.error);
