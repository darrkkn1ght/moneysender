import fs from "node:fs";
import { main as runMiles100b } from "./pipeline_miles_to_797b_100b.js";
import { main as runBlaq100b } from "./pipeline_blaq_to_797b_100b.js";

const MILES_STATE_PREV = "./balances_miles_to_7b17_300b.json";
const BLAQ_STATE_PREV = "./balances_blaq_to_7b17_300b.json";

function readState(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return null; }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function watchAndRunMiles() {
  console.log("⏳ [Queue] Miles monitor active: waiting for 7b17 300B transfer to complete...");
  while (true) {
    const s = readState(MILES_STATE_PREV);
    if (s && s.remaining === 0) {
      console.log("🚀 [Queue] Miles 7b17 completed! Automatically starting Miles -> 797b (100B)...");
      await runMiles100b();
      break;
    }
    await sleep(5000);
  }
}

async function watchAndRunBlaq() {
  console.log("⏳ [Queue] Blaq monitor active: waiting for 7b17 300B transfer to complete...");
  while (true) {
    const s = readState(BLAQ_STATE_PREV);
    if (s && s.remaining === 0) {
      console.log("🚀 [Queue] Blaq 7b17 completed! Automatically starting Blaq -> 797b (100B)...");
      await runBlaq100b();
      break;
    }
    await sleep(5000);
  }
}

console.log("📋 Auto-Queue Monitor initialized for 797b8baa5acc49b4a643 (100B Miles + 100B Blaq)");
Promise.all([watchAndRunMiles(), watchAndRunBlaq()]).then(() => {
  console.log("🎉 [Queue] All queued transfers to 797b8baa5acc49b4a643 completed!");
}).catch(console.error);
