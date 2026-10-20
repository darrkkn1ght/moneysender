import fs from "node:fs";
import crypto from "node:crypto";

const TARGET = "f8dbe758aa7a412fb461";
const PER_TX = 10_000_000_000; // 10B
const DELAY = 25000;           // 25s
const RETRY_DELAY = 5000;      // 5s
const LOG_FILE = "./triple_500b_f8db.log";

const PIPELINES = [
  {
    name: "Miles Peter (@milespete)",
    cookie: "ll_dev=2l08616a3s395t0d; ll_vid=102f439367af4102b904; ll_session=7905085c7b02a4e840a338dd3484f8995d019cd955fdf7d8f1c2a7ba846d1ee0; ll_pass=eyJpIjoiYmM3NDU4Mzc5MzVkNDVlZmJmNDciLCJ1IjoibWlsZXNwZXRlIiwibiI6Ik1pbGVzIFBldGVyIiwidCI6IlJPZXdwcjRWTlVNRE9uLUkiLCJlIjoxNzkyMzY2MDU0ODUyfQ.GmMw-OxO6rh4lp4QjBOW6tF7xm76FZBoSBhsD381IZY",
    stateFile: "./balances_miles_to_f8db_200b.json",
    total: 200_000_000_000 // 200B
  },
  {
    name: "Sebastian (@blaqsebastian)",
    cookie: "ll_dev=4o3z111w5i470l2f; ll_vid=2fe99f9ce0624c4abb14; ll_session=0eb20df322921c02aa976d9fa6d5a813021046eb1ea390f00d26a9646abd3718; ll_pass=eyJpIjoiNzc4NWNhZTRmMTU3NDUwNDkwZDUiLCJ1IjoiYmxhcXNlYmFzdGlhbiIsIm4iOiJTZWJhc3RpYW4iLCJ0Ijoid1hPLXRkQ2ZyVW4zbkJNbiIsImUiOjE3OTIzNDQ1MzI5MTV9.Bxn8glwFir1I4AoRyCRSppJSdA5EyrN6uXS24YqdB20",
    stateFile: "./balances_blaq_to_f8db_200b.json",
    total: 200_000_000_000 // 200B
  },
  {
    name: "mr_who (Idkwetulma)",
    cookie: "ll_dev=0u144y403y0n5o4c; ll_session=30ed25151a51189b01b77ec860906bcf4ff53eef06599f910f94fa3b4f329fba; ll_pass=eyJpIjoiZDRmNGFlZDk0ZDZlNDkxOTg5Y2YiLCJ1IjoibXJfd2hvIiwibiI6Iklka3dldHVsbWEiLCJ0IjoicHdjNFB1U3R0M2ROZ0ZkVCIsImUiOjE3OTIzNzQ0Nzg5NDd9.n3er-Yhh5QKWtVnl12SnIDGNgYt6MHD1P1qv0uuRJng",
    stateFile: "./balances_mrwho_to_f8db_100b.json",
    total: 100_000_000_000 // 100B
  }
];

function log(msg) {
  const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
  console.log(line);
  try {
    fs.appendFileSync(LOG_FILE, line + "\n");
  } catch {}
}

function loadState(file, total) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return { target: TARGET, remaining: total, txCount: 0 };
  }
}

function saveState(file, s) {
  fs.writeFileSync(file, JSON.stringify(s, null, 2));
}

function fmt(n) {
  if (n >= 1e12) return (n / 1e12).toFixed(2) + "T";
  if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
  return n.toLocaleString();
}

async function send(to, amount, cookie) {
  const key = crypto.randomUUID();
  try {
    const resp = await fetch("https://lagoslife.app/api/send", {
      method: "POST",
      headers: {
        "accept": "application/json",
        "content-type": "application/json",
        "cookie": cookie,
        "idempotency-key": key,
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
      },
      body: JSON.stringify({ to, amount })
    });
    return { status: resp.status, data: await resp.json().catch(() => ({})) };
  } catch (err) {
    return { status: 0, error: err.message || String(err) };
  }
}

async function runPipeline(p) {
  const state = loadState(p.stateFile, p.total);
  const totalTxs = Math.ceil(p.total / PER_TX);
  log(`🚀 [${p.name}] Target: ${fmt(p.total)} | Remaining: ${fmt(state.remaining)}`);

  while (state.remaining > 0) {
    const amount = Math.min(PER_TX, state.remaining);
    const txNum = state.txCount + 1;
    log(`   [${p.name}] [TX ${txNum}/${totalTxs}] Sending ${fmt(amount)} to ${TARGET}...`);

    const r = await send(TARGET, amount, p.cookie);

    if (r.status === 200) {
      state.remaining -= amount;
      state.txCount++;
      saveState(p.stateFile, state);
      const sent = p.total - state.remaining;
      const pct = ((sent / p.total) * 100).toFixed(1);
      log(`   ✅ [${p.name}] OK | Sent: ${fmt(sent)} | Remaining: ${fmt(state.remaining)} (${pct}%)`);
      if (state.remaining > 0) await new Promise(r => setTimeout(r, DELAY));
    } else if (r.status === 429) {
      log(`   ⏳ [${p.name}] Rate limited (429), retrying in 5s...`);
      await new Promise(r => setTimeout(r, RETRY_DELAY));
    } else if (r.status === 0) {
      log(`   ⚠️ [${p.name}] Network error (${r.error}), retrying in 5s...`);
      await new Promise(r => setTimeout(r, RETRY_DELAY));
    } else if (r.status === 401) {
      log(`   🔒 [${p.name}] Session expired! Status: ${r.status}`);
      return;
    } else {
      log(`   ❌ [${p.name}] Error ${r.status}: ${JSON.stringify(r.data)}`);
      await new Promise(r => setTimeout(r, RETRY_DELAY));
    }
  }

  log(`🎉 [${p.name}] COMPLETED! Sent ${fmt(p.total)} to ${TARGET}.`);
}

export async function main() {
  log("==================================================");
  log("⚡ TRIPLE PIPELINE 500B TRANSFER TO f8dbe758aa7a412fb461");
  log("   Miles Peter: ₦200B (20 tx)");
  log("   Sebastian:   ₦200B (20 tx)");
  log("   mr_who:      ₦100B (10 tx)");
  log("   Total:       ₦500B (Concurrent Execution)");
  log("==================================================");

  // Run all 3 concurrently in parallel
  await Promise.all(PIPELINES.map(p => runPipeline(p)));

  log("\n🏆🏆🏆 ALL 3 PIPELINES COMPLETED! ₦500B TRANSFERRED TO " + TARGET + "!");
}

if (process.argv[1]?.includes("run_triple_500b_to_f8db.js")) {
  main().catch(console.error);
}
