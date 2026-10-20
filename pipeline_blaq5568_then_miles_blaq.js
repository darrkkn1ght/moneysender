import fs from "node:fs";
import crypto from "node:crypto";

const BLAQ_COOKIE = "ll_dev=4o3z111w5i470l2f; ll_vid=2fe99f9ce0624c4abb14; ll_session=0eb20df322921c02aa976d9fa6d5a813021046eb1ea390f00d26a9646abd3718; ll_pass=eyJpIjoiNzc4NWNhZTRmMTU3NDUwNDkwZDUiLCJ1IjoiYmxhcXNlYmFzdGlhbiIsIm4iOiJTZWJhc3RpYW4iLCJ0Ijoid1hPLXRkQ2ZyVW4zbkJNbiIsImUiOjE3OTIzNDQ1MzI5MTV9.Bxn8glwFir1I4AoRyCRSppJSdA5EyrN6uXS24YqdB20";
const MILES_COOKIE = "ll_dev=2l08616a3s395t0d; ll_vid=102f439367af4102b904; ll_session=7905085c7b02a4e840a338dd3484f8995d019cd955fdf7d8f1c2a7ba846d1ee0; ll_pass=eyJpIjoiYmM3NDU4Mzc5MzVkNDVlZmJmNDciLCJ1IjoibWlsZXNwZXRlIiwibiI6Ik1pbGVzIFBldGVyIiwidCI6IlJPZXdwcjRWTlVNRE9uLUkiLCJlIjoxNzkyNDA0OTAyODk1fQ.wyQw5T4rXT32ZYfwVpvzddrsOPc4qM50CFHT6W-awrQ";

const BLAQ_UID = "7785cae4f157450490d5";

const JOBS = [
  { name: "Blaq -> 5568", sender: "blaqsebastian", cookie: BLAQ_COOKIE, target: "5568b53900504f9abcae", total: 250_000_000_000, stateFile: "./balances_blaq_to_5568_250b_oct19.json" },
  { name: "Miles -> Blaq", sender: "milespete", cookie: MILES_COOKIE, target: BLAQ_UID, total: 1_000_000_000_000, stateFile: "./balances_miles_to_blaq_1t_oct19.json" }
];

const PER_TX = 10_000_000_000;
const DELAY = 25000;
const RETRY_DELAY = 5000;
const LOG_FILE = "./pipeline_blaq5568_then_miles_blaq.log";

function log(msg) {
  const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
  console.log(line);
  try { fs.appendFileSync(LOG_FILE, line + "\n"); } catch {}
}
function fmt(n) {
  if (n >= 1e12) return (n/1e12).toFixed(2) + "T";
  if (n >= 1e9) return (n/1e9).toFixed(2) + "B";
  return n.toLocaleString();
}
function loadState(job) {
  try { return JSON.parse(fs.readFileSync(job.stateFile, "utf8")); }
  catch { return { sender: job.sender, target: job.target, total: job.total, remaining: job.total, txCount: 0 }; }
}
function saveState(job, s) {
  s.timestamp = new Date().toISOString();
  fs.writeFileSync(job.stateFile, JSON.stringify(s, null, 2));
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function send(job, amount) {
  try {
    const resp = await fetch("https://lagoslife.app/api/send", {
      method: "POST",
      headers: {
        "accept": "application/json",
        "content-type": "application/json",
        "origin": "https://lagoslife.app",
        "referer": "https://lagoslife.app/",
        "cookie": job.cookie,
        "idempotency-key": crypto.randomUUID(),
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36"
      },
      body: JSON.stringify({ to: job.target, amount })
    });
    return { status: resp.status, data: await resp.json().catch(() => ({})) };
  } catch (err) {
    return { status: 0, error: err.message || String(err) };
  }
}

async function runJob(job) {
  const state = loadState(job);
  const totalTxs = Math.ceil(job.total / PER_TX);
  log(`💸 [${job.name}] Target: ${fmt(job.total)} | Remaining: ${fmt(state.remaining)}`);
  let authFails = 0;

  while (state.remaining > 0) {
    const amount = Math.min(PER_TX, state.remaining);
    log(`[${job.name}] [TX ${state.txCount + 1}/${totalTxs}] Sending ${fmt(amount)}...`);
    const r = await send(job, amount);

    if (r.status === 200) {
      authFails = 0;
      state.remaining -= amount;
      state.txCount += 1;
      saveState(job, state);
      log(`   ✅ Success! Remaining: ${fmt(state.remaining)}`);
      if (state.remaining > 0) await sleep(DELAY);
    } else if (r.status === 429) {
      log(`   ⚠️ Rate limit (429). Retrying in 5s...`);
      await sleep(RETRY_DELAY);
    } else if (r.status === 401 || r.status === 403) {
      authFails++;
      log(`   🔒 Auth error ${r.status}: ${JSON.stringify(r.data)}`);
      if (authFails >= 3) {
        log(`   ⛔ [${job.name}] Stopping: session invalid. Need a fresh cookie.`);
        return false;
      }
      await sleep(RETRY_DELAY);
    } else {
      log(`   ❌ Error ${r.status}: ${JSON.stringify(r.data || r.error)}. Retrying in 5s...`);
      await sleep(RETRY_DELAY);
    }
  }
  log(`🎉 [${job.name}] COMPLETED! ${fmt(job.total)} delivered to ${job.target}`);
  return true;
}

(async () => {
  for (const job of JOBS) {
    const ok = await runJob(job);
    if (!ok) { log("Queue halted."); return; }
    await sleep(DELAY);
  }
  log("🎉🎉 ALL QUEUED TRANSFERS COMPLETED");
})();
