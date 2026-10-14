import fs from "node:fs/promises";

const TARGET = 1_000_000_000_000n; // 1T (100 x 10B)
const PER_TRANSACTION = 10_000_000_000n; // 10B
const DELAY = 21_000;

const TO = "08c2890f3ef04daea2b4";
const COOKIE = "ll_dev=2l08616a3s395t0d; ll_session=1d12f55f7b42a1050b3161e5723deaa18ebe88a9e71ce962926a0e3c3768278e; ll_vid=102f439367af4102b904; ll_pass=eyJpIjoiYmM3NDU4Mzc5MzVkNDVlZmJmNDciLCJ1IjoibWlsZXNwZXRlIiwibiI6Ik1pbGVzIFBldGVyIiwidCI6ImU2RWE4Tl93RkRhUEdaRzUiLCJlIjoxNzkxODg2NzgwMDUzfQ.8u2ypWmNQkG8RUDG7rdiHTcmkQKj0gI8gvRUpRyoUvA";

const STATE_FILE = "./balances_miles_to_08c2_2nd_1t.json";

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
      console.log(`[Miles -> 08c2 (2nd 1T)] Attempt ${attempt}/${MAX_RETRIES}: sending ${amount.toString()} to ${TO}`);

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
      console.log(`[Miles -> 08c2 (2nd 1T)] [${new Date().toLocaleTimeString()}] ${amount.toString()} → ${response.status}`, text);

      if (response.ok) {
        return;
      }
      console.log(`[Miles -> 08c2 (2nd 1T)] Server returned ${response.status}.`);

      if (text.includes("game saves every minute") || text.includes("You need")) {
        console.log("[Miles -> 08c2 (2nd 1T)] Balance sync pending. Waiting 15 seconds...");
        await sleep(15_000);
        continue;
      }
    } catch (error) {
      console.log(`[Miles -> 08c2 (2nd 1T)] Network error on attempt ${attempt}:`, error.code ?? error.message);
    }

    console.log(`[Miles -> 08c2 (2nd 1T)] Retrying in ${RETRY_DELAY / 1000} seconds...`);
    await sleep(RETRY_DELAY);
  }

  throw new Error(`[Miles -> 08c2 (2nd 1T)] Failed to send after ${MAX_RETRIES} attempts`);
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

  console.log(`[Miles -> 08c2 (2nd 1T)] Starting Pipeline: 2nd 1T to ${TO}`);
  console.log(`[Miles -> 08c2 (2nd 1T)] Already sent: ${(TARGET - remaining).toString()}`);
  console.log(`[Miles -> 08c2 (2nd 1T)] Remaining: ${remaining.toString()}`);

  while (remaining > 0n) {
    transaction++;
    const amount = remaining >= PER_TRANSACTION ? PER_TRANSACTION : remaining;
    const transactionId = `m208c2-2nd1t-${TO}-${transaction}`;

    console.log(`[Miles -> 08c2 (2nd 1T)] Transaction ${transaction}: sending ${amount.toString()}`);

    try {
      await send(amount, transactionId);
    } catch (error) {
      console.error("[Miles -> 08c2 (2nd 1T)] Retries failed.");
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

    console.log(`[Miles -> 08c2 (2nd 1T)] Remaining: ${remaining.toString()}`);

    if (remaining > 0n) {
      await sleep(DELAY);
    }
  }

  console.log("[Miles -> 08c2 (2nd 1T)] 2nd 1T Pipeline Complete! 🎉");
}

main().catch(console.error);
