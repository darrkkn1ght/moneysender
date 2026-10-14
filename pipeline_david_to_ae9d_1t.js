import fs from "node:fs/promises";

const TARGET = 1_000_000_000_000n; // 1T (100 x 10B)
const PER_TRANSACTION = 10_000_000_000n; // 10B
const DELAY = 21_000;

const TO = "ae9dfbf044b641248ef5";
const COOKIE = "ll_dev=5e6j3b5q0h1w6544; ll_session=afb02b2601ed51ffe4d03d8ebd3b6b0c8745e6685c5b3f8f395f1a1ff341b4e1; ll_pass=eyJpIjoiN2U3OTE3NjBjZDY0NGYxM2JhNWEiLCJ1IjoicHJpbmNlZGF2aWQiLCJuIjoiUHJpbmNlRGF2aWQiLCJ0IjoiaG5VOXZIdDFDQkRSdmJlWiIsImUiOjE3OTE4ODU1NzQ5NTN9.xka7Iy6nUnUH7EljZm8bjKGGFPqb87RDpbREZrtfhfY";

const STATE_FILE = "./balances_david_to_ae9d_1t.json";

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
      console.log(`[David -> ae9d] Attempt ${attempt}/${MAX_RETRIES}: sending ${amount.toString()} to ${TO}`);

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
      console.log(`[David -> ae9d] [${new Date().toLocaleTimeString()}] ${amount.toString()} → ${response.status}`, text);

      if (response.ok) {
        return;
      }
      console.log(`[David -> ae9d] Server returned ${response.status}.`);

      if (text.includes("game saves every minute") || text.includes("You need")) {
        console.log("[David -> ae9d] Balance sync pending. Waiting 15 seconds...");
        await sleep(15_000);
        continue;
      }
    } catch (error) {
      console.log(`[David -> ae9d] Network error on attempt ${attempt}:`, error.code ?? error.message);
    }

    console.log(`[David -> ae9d] Retrying in ${RETRY_DELAY / 1000} seconds...`);
    await sleep(RETRY_DELAY);
  }

  throw new Error(`[David -> ae9d] Failed to send after ${MAX_RETRIES} attempts`);
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

  console.log(`[David -> ae9d] Starting Pipeline: 1T from @princedavid to ${TO}`);
  console.log(`[David -> ae9d] Already sent: ${(TARGET - remaining).toString()}`);
  console.log(`[David -> ae9d] Remaining: ${remaining.toString()}`);

  while (remaining > 0n) {
    transaction++;
    const amount = remaining >= PER_TRANSACTION ? PER_TRANSACTION : remaining;
    const transactionId = `d2ae9d-1t-${TO}-${transaction}`;

    console.log(`[David -> ae9d] Transaction ${transaction}: sending ${amount.toString()}`);

    try {
      await send(amount, transactionId);
    } catch (error) {
      console.error("[David -> ae9d] Retries failed.");
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

    console.log(`[David -> ae9d] Remaining: ${remaining.toString()}`);

    if (remaining > 0n) {
      await sleep(DELAY);
    }
  }

  console.log("[David -> ae9d] 1T Pipeline Complete! 🎉");
}

main().catch(console.error);
