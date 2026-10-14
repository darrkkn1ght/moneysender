import fs from "node:fs/promises";
import crypto from "node:crypto";

// ------------------------------------
// Configuration
// ------------------------------------
const TOTAL_TO_BUY = 998; // Total items to buy
const QTY_PER_REQUEST = 1;
const DELAY_BETWEEN_REQUESTS = 3_000; // 3 seconds to avoid rate limiting

const ITEM_PRODUCT = "p-bread";
const ITEM_PRICE = 500;
const SHOP_OWNER = "bc745837935d45efbf47";
const SHOP_COMPANY = "co_1321462dbc6c455183d1";

const COOKIE = "ll_dev=4o3z111w5i470l2f; ll_session=efcc189dc5a49de670dd1e040b3aa38eaddeed5bedc2c1abe0f1f0dd6979092e; ll_vid=2fe99f9ce0624c4abb14; ll_pass=eyJpIjoiNzc4NWNhZTRmMTU3NDUwNDkwZDUiLCJ1IjoiYmxhcXNlYmFzdGlhbiIsIm4iOiJTZWJhc3RpYW4iLCJ0IjoiQ2JDQmMtYzFUTV93QmdZRiIsImUiOjE3OTE1NDI3NzMyNDF9.V8yZ6NvOwsIMKQm4iaR2NX_w9z9Ko6aB8esTh6QGeP8";

const STATE_FILE = "./bought_bread.json";
const MAX_RETRIES = 30;
const RETRY_DELAY = 6_000; // 6 seconds retry delay when rate limited

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function generateKey() {
  return crypto.randomBytes(12).toString("hex");
}

async function loadState() {
  try {
    const text = await fs.readFile(STATE_FILE, "utf8");
    return JSON.parse(text);
  } catch (error) {
    if (error.code === "ENOENT") {
      return { bought: 20 }; // Start from 20 since first 20 succeeded
    }
    throw error;
  }
}

async function saveState(state) {
  const tempFile = `${STATE_FILE}.tmp`;
  await fs.writeFile(tempFile, JSON.stringify(state, null, 2), "utf8");
  await fs.rename(tempFile, STATE_FILE);
}

async function buyItem(purchaseNum) {
  const key = generateKey();

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch("https://lagoslife.app/api/shop", {
        method: "POST",
        headers: {
          "accept": "*/*",
          "accept-language": "en-US,en;q=0.9",
          "content-type": "application/json",
          "origin": "https://lagoslife.app",
          "referer": "https://lagoslife.app/",
          "cookie": COOKIE,
          "priority": "u=1, i"
        },
        body: JSON.stringify({
          action: "buy",
          owner: SHOP_OWNER,
          co: SHOP_COMPANY,
          p: ITEM_PRODUCT,
          price: ITEM_PRICE,
          qty: QTY_PER_REQUEST,
          key: key
        })
      });

      const text = await response.text();

      if (response.ok) {
        console.log(`[${new Date().toLocaleTimeString()}] Purchase #${purchaseNum} successful!`);
        return true;
      }

      console.log(`[${new Date().toLocaleTimeString()}] Attempt ${attempt}/${MAX_RETRIES} - Status ${response.status}: ${text}`);

      if (text.includes("sold out") || text.includes("out of stock") || text.includes("insufficient")) {
        console.log("Stock limit or balance limit reached.");
        return false;
      }

    } catch (error) {
      console.log(`Network error on attempt ${attempt}:`, error.message);
    }

    console.log(`Retrying in ${RETRY_DELAY / 1000}s...`);
    await sleep(RETRY_DELAY);
  }

  throw new Error(`Failed purchase #${purchaseNum} after ${MAX_RETRIES} attempts`);
}

async function main() {
  const state = await loadState();
  let boughtCount = state.bought || 0;

  console.log(`Resuming bulk purchase from item ${boughtCount + 1} up to ${TOTAL_TO_BUY}...`);
  console.log("");

  for (let i = boughtCount + 1; i <= TOTAL_TO_BUY; i++) {
    const success = await buyItem(i);
    if (!success) {
      console.log("Stopping purchase loop.");
      break;
    }

    boughtCount++;
    state.bought = boughtCount;
    await saveState(state);

    console.log(`Progress: ${boughtCount} / ${TOTAL_TO_BUY} Agege Bread bought.`);

    if (i < TOTAL_TO_BUY) {
      await sleep(DELAY_BETWEEN_REQUESTS);
    }
  }

  console.log("");
  console.log(`Bulk purchase complete! Total bought: ${boughtCount} items.`);
}

main().catch(console.error);
