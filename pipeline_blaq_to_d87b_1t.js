import fs from "node:fs/promises";

const TARGET = 1_000_000_000_000n; // 1T
const PER_TRANSACTION = 10_000_000_000n; // 10B
const DELAY = 21_000;

const TO = "d87b78aaec214f6b9a34";
const COOKIE = "ll_dev=4o3z111w5i470l2f; ll_session=efcc189dc5a49de670dd1e040b3aa38eaddeed5bedc2c1abe0f1f0dd6979092e; ll_vid=2fe99f9ce0624c4abb14; ll_pass=eyJpIjoiNzc4NWNhZTRmMTU3NDUwNDkwZDUiLCJ1IjoiYmxhcXNlYmFzdGlhbiIsIm4iOiJTZWJhc3RpYW4iLCJ0IjoiQ2JDQmMtYzFUTV93QmdZRiIsImUiOjE3OTE3MTUyMzYxMjZ9.okpVU43GDtgBEDG6T_B6K0PrqIewC4FptRRUoZpPoDk";

const STATE_FILE = "./balances_d87b_1t.json";

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
      console.log(`[Blaq -> d87b] Attempt ${attempt}/${MAX_RETRIES}: sending ${amount.toString()}`);

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
      console.log(`[Blaq -> d87b] [${new Date().toLocaleTimeString()}] ${amount.toString()} → ${response.status}`, text);

      if (response.ok) {
        return;
      }
      console.log(`[Blaq -> d87b] Server returned ${response.status}.`);

      if (text.includes("game saves every minute") || text.includes("You need")) {
        console.log("[Blaq -> d87b] Balance sync pending. Waiting 15 seconds...");
        await sleep(15_000);
        continue;
      }
    } catch (error) {
      console.log(`[Blaq -> d87b] Network error on attempt ${attempt}:`, error.code ?? error.message);
    }

    console.log(`[Blaq -> d87b] Retrying in ${RETRY_DELAY / 1000} seconds...`);
    await sleep(RETRY_DELAY);
  }

  throw new Error(`[Blaq -> d87b] Failed to send after ${MAX_RETRIES} attempts`);
}

async function main() {
  const state = await loadState();

  if (!state[TO]) {
    // 440B already sent from previous 800B pipeline, so remaining for 1T = 560B
    state[TO] = {
      target: TARGET.toString(),
      remaining: "560000000000",
      transaction: 44
    };
    await saveState(state);
  }

  let remaining = BigInt(state[TO].remaining);
  let transaction = state[TO].transaction;

  console.log(`[Blaq -> d87b] Starting Pipeline: 1T to ${TO}`);
  console.log(`[Blaq -> d87b] Already sent: ${(TARGET - remaining).toString()}`);
  console.log(`[Blaq -> d87b] Remaining: ${remaining.toString()}`);

  while (remaining > 0n) {
    transaction++;
    const amount = remaining >= PER_TRANSACTION ? PER_TRANSACTION : remaining;
    const transactionId = `b2d-1t-${TO}-${transaction}`;

    console.log(`[Blaq -> d87b] Transaction ${transaction}: sending ${amount.toString()}`);

    try {
      await send(amount, transactionId);
    } catch (error) {
      console.error("[Blaq -> d87b] Retries failed.");
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

    console.log(`[Blaq -> d87b] Remaining: ${remaining.toString()}`);

    if (remaining > 0n) {
      await sleep(DELAY);
    }
  }

  console.log("[Blaq -> d87b] 1T Pipeline Complete! 🎉");
}

main().catch(console.error);
