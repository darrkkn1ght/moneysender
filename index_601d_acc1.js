import fs from "node:fs/promises";

const TARGET = 490_000_000_000n; // 490B (49 x 10B)
const PER_TRANSACTION = 10_000_000_000n; // 10B
const DELAY = 21_000;

const TO = "601dcbd56fa84bb68f3c";
const COOKIE = "ll_vid=e2c5139529b14929bd43; ll_session=778892b94ea1f4c36ffde880a8bc6ea0bbd0618c651b69fe4659bcf488de52b8; ll_dev=165o5s0h0y6i4x6k; ll_pass=eyJpIjoiYmM3NDU4Mzc5MzVkNDVlZmJmNDciLCJ1IjoibWlsZXNwZXRlIiwibiI6Ik1pbGVzIFBldGVyIiwidCI6IlRVVkdqWXdLU3MyaFI5VEYiLCJlIjoxNzkxNTA0MTQyODQ4fQ.SR_NyzvLzLo5G-K7oGiQag80tdJXXJTytRUReHRJraA";

const STATE_FILE = "./balances_601d_acc1_490b.json";

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
        "https://lagoslife.eliysites.com/api/send",
        {
          method: "POST",

          headers: {
            "accept": "*/*",
            "content-type": "application/json",
            "origin": "https://lagoslife.eliysites.com",
            "referer": "https://lagoslife.eliysites.com/",
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
  console.log(`Sending 490B from Account 1 to Recipient: ${TO}`);
  console.log(`Remaining: ${remaining.toString()}`);
  console.log(`Last transaction: ${transaction}`);
  console.log("");

  while (remaining > 0n) {
    transaction++;

    const amount =
      remaining >= PER_TRANSACTION
        ? PER_TRANSACTION
        : remaining;

    const transactionId = `601d-acc1-490b-${TO}-${transaction}`;

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
  console.log("Finished sending 490B from Account 1.");
}

main().catch(console.error);
