import fs from "node:fs/promises";

const TARGET = 50_000_000_000n; // 50B (5 x 10B)
const PER_TRANSACTION = 10_000_000_000n; // 10B
const DELAY = 21_000;

const TO = "18bb790356de4feabc86";
const COOKIE = "ll_dev=4o3z111w5i470l2f; ll_vid=2fe99f9ce0624c4abb14; ll_session=c0a17f10cf24947e9b87549591023ffaf52ecc947a5963da92c6fe5d95abda86; ll_pass=eyJpIjoiNzc4NWNhZTRmMTU3NDUwNDkwZDUiLCJ1IjoiYmxhcXNlYmFzdGlhbiIsIm4iOiJTZWJhc3RpYW4iLCJ0IjoiazBIdUtRd3pKV2w1M0pSNiIsImUiOjE3OTE5NzU4MDkzNTl9.BAmUvRXuwNmzwWQAdeVQLDrfJ_k0-6_zfPy_Qc-GMXw";

const STATE_FILE = "./balances_blaq_to_18bb_50b.json";

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
      console.log(`[Blaq -> 18bb] Attempt ${attempt}/${MAX_RETRIES}: sending ${amount.toString()} to ${TO}`);

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
      console.log(`[Blaq -> 18bb] [${new Date().toLocaleTimeString()}] ${amount.toString()} → ${response.status}`, text);

      if (response.ok) {
        return;
      }
      console.log(`[Blaq -> 18bb] Server returned ${response.status}.`);

      if (text.includes("game saves every minute") || text.includes("You need")) {
        console.log("[Blaq -> 18bb] Balance sync pending. Waiting 15 seconds...");
        await sleep(15_000);
        continue;
      }
    } catch (error) {
      console.log(`[Blaq -> 18bb] Network error on attempt ${attempt}:`, error.code ?? error.message);
    }

    console.log(`[Blaq -> 18bb] Retrying in ${RETRY_DELAY / 1000} seconds...`);
    await sleep(RETRY_DELAY);
  }

  throw new Error(`[Blaq -> 18bb] Failed to send after ${MAX_RETRIES} attempts`);
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

  console.log(`[Blaq -> 18bb] Starting Pipeline: 50B from @blaqsebastian to ${TO}`);
  console.log(`[Blaq -> 18bb] Already sent: ${(TARGET - remaining).toString()}`);
  console.log(`[Blaq -> 18bb] Remaining: ${remaining.toString()}`);

  while (remaining > 0n) {
    transaction++;
    const amount = remaining >= PER_TRANSACTION ? PER_TRANSACTION : remaining;
    const transactionId = `b2-18bb-50b-${TO}-${transaction}`;

    console.log(`[Blaq -> 18bb] Transaction ${transaction}: sending ${amount.toString()}`);

    try {
      await send(amount, transactionId);
    } catch (error) {
      console.error("[Blaq -> 18bb] Retries failed.");
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

    console.log(`[Blaq -> 18bb] Remaining: ${remaining.toString()}`);

    if (remaining > 0n) {
      await sleep(DELAY);
    }
  }

  console.log("[Blaq -> 18bb] 50B Pipeline Complete! 🎉");
}

main().catch(console.error);
