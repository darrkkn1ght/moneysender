import fs from "node:fs/promises";

const TARGET = 1_000_000_000_000n; // 1T (100 x 10B)
const PER_TRANSACTION = 10_000_000_000n; // 10B
const DELAY = 21_000;

const TO = "0760cfa07f7e44779b20";
const COOKIE = "ll_dev=4o3z111w5i470l2f; ll_session=efcc189dc5a49de670dd1e040b3aa38eaddeed5bedc2c1abe0f1f0dd6979092e; ll_vid=2fe99f9ce0624c4abb14; ll_pass=eyJpIjoiNzc4NWNhZTRmMTU3NDUwNDkwZDUiLCJ1IjoiYmxhcXNlYmFzdGlhbiIsIm4iOiJTZWJhc3RpYW4iLCJ0IjoiQ2JDQmMtYzFUTV93QmdZRiIsImUiOjE3OTE1NDQ1OTUzMjV9.ZMpscBk0UIB5URuR1xNPsoJ4KVHbtnBMJztnSoYqTkk";

const STATE_FILE = "./balances_0760_acc2_1t.json";

const MAX_RETRIES = 20;
const RETRY_DELAY = 5_000;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));


// -------------------------
// Persistent state
// -------------------------

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

  await fs.writeFile(
    tempFile,
    JSON.stringify(state, null, 2),
    "utf8"
  );

  await fs.rename(tempFile, STATE_FILE);
}


// -------------------------
// Send with retries
// -------------------------

async function send(amount, transactionId) {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      console.log(
        `Attempt ${attempt}/${MAX_RETRIES}: sending ${amount.toString()}`
      );

      const response = await fetch(
        "https://lagoslife.app/api/send",
        {
          method: "POST",

          headers: {
            "accept": "*/*",
            "content-type": "application/json",
            "origin": "https://lagoslife.app",
            "referer": "https://lagoslife.app/",
            "cookie": COOKIE,

            // Only useful if backend implements idempotency.
            "idempotency-key": transactionId
          },

          body: JSON.stringify({
            to: TO,
            amount: Number(amount)
          })
        }
      );

      const text = await response.text();

      console.log(
        `[${new Date().toLocaleTimeString()}] ${amount.toString()} → ${response.status}`,
        text
      );

      if (response.ok) {
        return;
      }

      console.log(
        `Server returned ${response.status}.`
      );

    } catch (error) {
      console.log(
        `Network error on attempt ${attempt}:`,
        error.code ?? error.message
      );
    }

    console.log(
      `Retrying in ${RETRY_DELAY / 1000} seconds...`
    );

    await sleep(RETRY_DELAY);
  }

  throw new Error(`Failed to send after ${MAX_RETRIES} attempts`);
}


// -------------------------
// Main
// -------------------------

async function main() {
  const state = await loadState();

  // Create persistent state for this recipient
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

  console.log("");
  console.log(`Sending 1T from Account 2 to Recipient: ${TO}`);
  console.log(`Remaining: ${remaining.toString()}`);
  console.log(`Last transaction: ${transaction}`);
  console.log("");

  while (remaining > 0n) {
    transaction++;

    const amount =
      remaining >= PER_TRANSACTION
        ? PER_TRANSACTION
        : remaining;

    const transactionId = `0760-acc2-1t-${TO}-${transaction}`;

    console.log(
      `Transaction ${transaction}: sending ${amount.toString()}`
    );

    try {
      await send(amount, transactionId);
    } catch (error) {
      console.error("");
      console.error("All retries failed.");
      console.error("Progress was NOT deducted.");
      console.error(error);

      // Save progress before exiting
      state[TO] = {
        target: TARGET.toString(),
        remaining: remaining.toString(),
        transaction: transaction - 1
      };

      await saveState(state);

      throw error;
    }

    // Only deduct after confirmed success
    remaining -= amount;

    state[TO] = {
      target: TARGET.toString(),
      remaining: remaining.toString(),
      transaction
    };

    await saveState(state);

    console.log(
      `Remaining: ${remaining.toString()}`
    );

    if (remaining > 0n) {
      console.log("Waiting 21 seconds...");
      await sleep(DELAY);
    }
  }

  console.log("");
  console.log("Finished sending 1T from Account 2.");
}

main().catch(console.error);
