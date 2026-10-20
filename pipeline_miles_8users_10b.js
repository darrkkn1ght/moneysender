import fs from "node:fs";
import crypto from "node:crypto";

const COOKIE = "ll_dev=2l08616a3s395t0d; ll_vid=102f439367af4102b904; ll_session=7905085c7b02a4e840a338dd3484f8995d019cd955fdf7d8f1c2a7ba846d1ee0; ll_pass=eyJpIjoiYmM3NDU4Mzc5MzVkNDVlZmJmNDciLCJ1IjoibWlsZXNwZXRlIiwibiI6Ik1pbGVzIFBldGVyIiwidCI6IlJPZXdwcjRWTlVNRE9uLUkiLCJlIjoxNzkyNDA0OTAyODk1fQ.wyQw5T4rXT32ZYfwVpvzddrsOPc4qM50CFHT6W-awrQ";

const RECIPIENTS = [
  { username: "Big_stephani", id: "0409473d9c024646b0fa", name: "Nwankwo somto" },
  { username: "tasticeofx", id: "157ed5b9076040f2b8c0", name: "Temini" },
  { username: "Kaizen_77", id: "837a90f7a6834f2f918e", name: "Uthman abiola" },
  { username: "Maryjoydaniel", id: "d838f83d4b5b46c1a778", name: "Marydaniel" },
  { username: "Xorx_eko", id: "917a789a5dff43829a57", name: "Olowoegba" },
  { username: "Andreanoe", id: "e9adf1c299d140aa967b", name: "Alpaca" },
  { username: "faeesal", id: "578f70e828bb4dc587d9", name: "Faisal FFS" },
  { username: "Engr_kenny", id: "d49d56a98f89475c9d91", name: "Kenny" }
];

const AMOUNT_PER_USER = 10_000_000_000; // 10B
const DELAY = 25000;                     // 25s
const RETRY_DELAY = 5000;                // 5s
const STATE_FILE = "./balances_miles_8users_10b.json";
const LOG_FILE = "./pipeline_miles_8users_10b.log";

function log(msg) {
  const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
  console.log(line);
  try { fs.appendFileSync(LOG_FILE, line + "\n"); } catch {}
}

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, "utf8")); }
  catch {
    return {
      sender: "milespete",
      completed: [],
      pending: RECIPIENTS.map(r => r.username),
      totalTarget: RECIPIENTS.length * AMOUNT_PER_USER
    };
  }
}

function saveState(s) {
  s.timestamp = new Date().toISOString();
  fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
}

async function send(toId, amount) {
  const key = crypto.randomUUID();
  try {
    const resp = await fetch("https://lagoslife.app/api/send", {
      method: "POST",
      headers: {
        "accept": "application/json",
        "content-type": "application/json",
        "origin": "https://lagoslife.app",
        "referer": "https://lagoslife.app/",
        "cookie": COOKIE,
        "idempotency-key": key,
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36"
      },
      body: JSON.stringify({ to: toId, amount })
    });
    return { status: resp.status, data: await resp.json().catch(() => ({})) };
  } catch (err) {
    return { status: 0, error: err.message || String(err) };
  }
}

async function main() {
  const state = loadState();
  log("==================================================");
  log(`🚀 MilesPete Batch Distribution: 10B each to 8 Users`);
  log(`Total Users: ${RECIPIENTS.length} | Total Amount: 80B`);
  log("==================================================");

  for (let i = 0; i < RECIPIENTS.length; i++) {
    const recipient = RECIPIENTS[i];
    if (state.completed.includes(recipient.username)) {
      log(`⏩ [${i + 1}/${RECIPIENTS.length}] Already sent 10B to @${recipient.username}. Skipping.`);
      continue;
    }

    let success = false;
    while (!success) {
      log(`[${i + 1}/${RECIPIENTS.length}] Sending 10B from MilesPete to @${recipient.username} (${recipient.id} - "${recipient.name}")...`);
      const r = await send(recipient.id, AMOUNT_PER_USER);

      if (r.status === 200) {
        success = true;
        state.completed.push(recipient.username);
        state.pending = state.pending.filter(u => u !== recipient.username);
        saveState(state);
        log(`   ✅ Success! 10B delivered to @${recipient.username}.`);

        // If more remain, wait delay
        if (i < RECIPIENTS.length - 1) {
          log(`   ⏳ Waiting ${DELAY / 1000}s cooldown...`);
          await new Promise(r => setTimeout(r, DELAY));
        }
      } else if (r.status === 429) {
        log(`   ⚠️ Rate limit (429). Retrying in ${RETRY_DELAY / 1000}s...`);
        await new Promise(r => setTimeout(r, RETRY_DELAY));
      } else {
        log(`   ❌ Error ${r.status}: ${JSON.stringify(r.data || r.error)}. Retrying in ${RETRY_DELAY / 1000}s...`);
        await new Promise(r => setTimeout(r, RETRY_DELAY));
      }
    }
  }

  log("\n🎉🎉 BATCH COMPLETE! 10B delivered to all 8 users from MilesPete!");
}

main().catch(err => log(`Fatal: ${err.message}`));
