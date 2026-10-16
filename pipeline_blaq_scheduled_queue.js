import fs from "node:fs/promises";

const PER_TRANSACTION = 10_000_000_000n; // 10B
const DELAY = 21_000;

// The ordered queue of transfers from @blaqsebastian
const QUEUE = [
  { to: "e92ef18fe1814a61b26f", amount: 500_000_000_000n, label: "500B to e92e" },
  { to: "16a482c27bf94e47a8c3", amount: 250_000_000_000n, label: "250B to 16a4" },
  { to: "15fa7683de8942758d31", amount: 250_000_000_000n, label: "250B to 15fa" }
];

const COOKIE = "ll_dev=4o3z111w5i470l2f; ll_vid=2fe99f9ce0624c4abb14; ll_session=c0a17f10cf24947e9b87549591023ffaf52ecc947a5963da92c6fe5d95abda86; ll_pass=eyJpIjoiNzc4NWNhZTRmMTU3NDUwNDkwZDUiLCJ1IjoiYmxhcXNlYmFzdGlhbiIsIm4iOiJTZWJhc3RpYW4iLCJ0IjoiazBIdUtRd3pKV2w1M0pSNiIsImUiOjE3OTE5NzU4MDkzNTl9.BAmUvRXuwNmzwWQAdeVQLDrfJ_k0-6_zfPy_Qc-GMXw";

const STATE_FILE = "./balances_blaq_scheduled_queue.json";

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

async function send(amount, to, transactionId) {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      console.log(`[Blaq Queue] Attempt ${attempt}/${MAX_RETRIES}: sending ${amount.toString()} to ${to}`);

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
          to: to,
          amount: Number(amount)
        })
      });

      const text = await response.text();
      console.log(`[Blaq Queue] [${new Date().toLocaleTimeString()}] ${amount.toString()} → ${response.status}`, text);

      if (response.ok) {
        return;
      }
      console.log(`[Blaq Queue] Server returned ${response.status}.`);

      if (text.includes("game saves every minute") || text.includes("You need")) {
        console.log("[Blaq Queue] Balance sync pending. Waiting 15 seconds...");
        await sleep(15_000);
        continue;
      }
    } catch (error) {
      console.log(`[Blaq Queue] Network error on attempt ${attempt}:`, error.code ?? error.message);
    }

    console.log(`[Blaq Queue] Retrying in ${RETRY_DELAY / 1000} seconds...`);
    await sleep(RETRY_DELAY);
  }

  throw new Error(`[Blaq Queue] Failed to send after ${MAX_RETRIES} attempts`);
}

async function main() {
  const state = await loadState();

  console.log(`=======================================================`);
  console.log(`📋 BLAQ AUTOMATED SCHEDULED QUEUE`);
  console.log(`Total Steps in Sequence: ${QUEUE.length}`);
  console.log(`=======================================================`);

  for (let i = 0; i < QUEUE.length; i++) {
    const job = QUEUE[i];
    const key = `step_${i}_${job.to}`;

    if (!state[key]) {
      state[key] = {
        label: job.label,
        to: job.to,
        target: job.amount.toString(),
        remaining: job.amount.toString(),
        transaction: 0,
        status: "PENDING"
      };
      await saveState(state);
    }

    let remaining = BigInt(state[key].remaining);
    let transaction = state[key].transaction;

    if (remaining === 0n) {
      console.log(`\n⏭️ Step ${i + 1}/${QUEUE.length} (${job.label}) is already COMPLETED! Skipping...`);
      continue;
    }

    console.log(`\n▶️ Starting Step ${i + 1}/${QUEUE.length}: ${job.label}`);
    console.log(`   Recipient: ${job.to}`);
    console.log(`   Remaining: ${remaining.toString()}`);
    state[key].status = "RUNNING";
    await saveState(state);

    while (remaining > 0n) {
      transaction++;
      const amount = remaining >= PER_TRANSACTION ? PER_TRANSACTION : remaining;
      const transactionId = `b2-queue-s${i}-${job.to}-${transaction}`;

      console.log(`[Blaq Queue] [Step ${i + 1}] Tx ${transaction}: sending ${amount.toString()}`);

      try {
        await send(amount, job.to, transactionId);
      } catch (error) {
        console.error(`[Blaq Queue] Error in Step ${i + 1}.`);
        state[key].remaining = remaining.toString();
        state[key].transaction = transaction - 1;
        await saveState(state);
        throw error;
      }

      remaining -= amount;
      state[key].remaining = remaining.toString();
      state[key].transaction = transaction;
      await saveState(state);

      console.log(`[Blaq Queue] Remaining for this step: ${remaining.toString()}`);

      if (remaining > 0n) {
        await sleep(DELAY);
      }
    }

    state[key].status = "COMPLETED";
    await saveState(state);
    console.log(`✅ Step ${i + 1}/${QUEUE.length} (${job.label}) COMPLETE! 🎉`);

    if (i < QUEUE.length - 1) {
      console.log(`⏳ Waiting 21 seconds before advancing to next scheduled step...`);
      await sleep(DELAY);
    }
  }

  console.log(`\n=======================================================`);
  console.log(`🎉 ALL SCHEDULED TRANSFERS COMPLETED SUCCESSFULLY! 🎉`);
  console.log(`=======================================================`);
}

main().catch(console.error);
