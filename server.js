import express from "express";
import cors from "cors";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PIN = process.env.ADMIN_PIN || "2026"; // Default PIN for mobile lock screen

app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.static(path.join(__dirname, "public")));

const DATA_DIR = path.join(__dirname, "data");
const ACCOUNTS_FILE = path.join(DATA_DIR, "accounts.json");
const RECIPIENTS_FILE = path.join(DATA_DIR, "recipients.json");
const JOBS_FILE = path.join(DATA_DIR, "jobs.json");

// In-memory active workers
const activeJobs = new Map();
const cachedBalances = new Map();

// Helper sleep
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function readJson(file, def = []) {
  try {
    const raw = await fs.readFile(file, "utf8");
    return JSON.parse(raw);
  } catch {
    return def;
  }
}

async function writeJson(file, data) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(data, null, 2), "utf8");
}

// Check PIN middleware for sensitive API calls
function requirePin(req, res, next) {
  const pin = req.headers["x-admin-pin"] || req.query.pin;
  if (!ADMIN_PIN || pin === ADMIN_PIN) {
    return next();
  }
  return res.status(401).json({ error: "Invalid PIN code. Please unlock dashboard." });
}

// Core predefined known usernames
const USERNAME_MAP = {
  "blaqsebastian": "7785cae4f157450490d5",
  "sebastian": "7785cae4f157450490d5",
  "milespete": "bc745837935d45efbf47",
  "miles": "bc745837935d45efbf47",
  "princedavid": "7e791760cd644f13ba5a",
  "mr_who": "d4f4aed94d6e491989cf"
};

function extractTargetId(input) {
  if (!input) return "";
  const trimmed = input.trim();
  const urlMatch = trimmed.match(/[?&]with=([a-f0-9]{16,})/i);
  if (urlMatch) return urlMatch[1];
  const profileMatch = trimmed.match(/lagoslife\.app\/.*?([a-f0-9]{16,})/i);
  if (profileMatch) return profileMatch[1];
  const clean = trimmed.toLowerCase().replace(/^@/, "");
  if (USERNAME_MAP[clean]) return USERNAME_MAP[clean];
  return trimmed;
}

// Initialize default accounts if empty
async function initStorage() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const accounts = await readJson(ACCOUNTS_FILE, []);
  if (accounts.length === 0) {
    const initial = [
      {
        id: "acc_1",
        name: "Miles Peter (@milespete)",
        user: "milespete",
        uid: "bc745837935d45efbf47",
        cookie: "ll_dev=2l08616a3s395t0d; ll_vid=102f439367af4102b904; ll_session=7905085c7b02a4e840a338dd3484f8995d019cd955fdf7d8f1c2a7ba846d1ee0; ll_pass=eyJpIjoiYmM3NDU4Mzc5MzVkNDVlZmJmNDciLCJ1IjoibWlsZXNwZXRlIiwibiI6Ik1pbGVzIFBldGVyIiwidCI6IlJPZXdwcjRWTlVNRE9uLUkiLCJlIjoxNzkyNDA0OTAyODk1fQ.wyQw5T4rXT32ZYfwVpvzddrsOPc4qM50CFHT6W-awrQ"
      },
      {
        id: "acc_2",
        name: "Sebastian (@blaqsebastian)",
        user: "blaqsebastian",
        uid: "7785cae4f157450490d5",
        cookie: "ll_dev=4o3z111w5i470l2f; ll_vid=2fe99f9ce0624c4abb14; ll_session=0eb20df322921c02aa976d9fa6d5a813021046eb1ea390f00d26a9646abd3718; ll_pass=eyJpIjoiNzc4NWNhZTRmMTU3NDUwNDkwZDUiLCJ1IjoiYmxhcXNlYmFzdGlhbiIsIm4iOiJTZWJhc3RpYW4iLCJ0Ijoid1hPLXRkQ2ZyVW4zbkJNbiIsImUiOjE3OTIzNDQ1MzI5MTV9.Bxn8glwFir1I4AoRyCRSppJSdA5EyrN6uXS24YqdB20"
      },
      {
        id: "acc_3",
        name: "PrinceDavid (@princedavid)",
        user: "princedavid",
        uid: "7e791760cd644f13ba5a",
        cookie: "ll_dev=5e6j3b5q0h1w6544; ll_vid=41df63d592034b448922; ll_session=a49594e973a5e03650d28b08973a21b3a27c0407175e842e4f2711fa57b61159; ll_pass=eyJpIjoiN2U3OTE3NjBjZDY0NGYxM2JhNWEiLCJ1IjoicHJpbmNlZGF2aWQiLCJuIjoiUHJpbmNlRGF2aWQiLCJ0IjoiQ1VyZEdoazVKUTZFUEU2eSIsImUiOjE3OTI0Mjk4MzU3NTZ9.GmDFWFsTr1DID-Zg7nc0n08uDbe4SJM7ObMrNmz9ZJ8"
      },
      {
        id: "acc_1792373942442",
        name: "mr_who (Idkwetulma)",
        user: "mr_who",
        uid: "d4f4aed94d6e491989cf",
        cookie: "ll_dev=0u144y403y0n5o4c; ll_session=30ed25151a51189b01b77ec860906bcf4ff53eef06599f910f94fa3b4f329fba; ll_vid=6f8f48ee77d84176833b; ll_pass=eyJpIjoiZDRmNGFlZDk0ZDZlNDkxOTg5Y2YiLCJ1IjoibXJfd2hvIiwibiI6Iklka3dldHVsbWEiLCJ0IjoicHdjNFB1U3R0M2ROZ0ZkVCIsImUiOjE3OTI0MzAwNTY0MDF9.wr29SLka5_4Xba5zcPiq9Aqe0qXtzmlBqv3kJKS1dIY"
      }
    ];
    await writeJson(ACCOUNTS_FILE, initial);
  }
}

// -------------------------------------------------------------
// Core LagosLife API Functions
// -------------------------------------------------------------
async function fetchAccountData(cookie) {
  try {
    const res = await fetch("https://lagoslife.app/api/save", {
      headers: {
        "accept": "application/json",
        "cookie": cookie,
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36"
      }
    });
    if (!res.ok) return { ok: false, status: res.status };
    const data = await res.json();
    const money = data.game?.money ?? data.snap?.cash ?? data.cash ?? null;
    const name = data.game?.sim?.name || data.game?.owner?.name || null;
    return { ok: true, money, name, full: data };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function sendMoney(cookie, to, amount, key) {
  try {
    const res = await fetch("https://lagoslife.app/api/send", {
      method: "POST",
      headers: {
        "accept": "application/json",
        "content-type": "application/json",
        "origin": "https://lagoslife.app",
        "referer": "https://lagoslife.app/",
        "cookie": cookie,
        "idempotency-key": key || crypto.randomUUID(),
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36"
      },
      body: JSON.stringify({ to, amount })
    });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data };
  } catch (err) {
    return { status: 0, error: err.message };
  }
}

// -------------------------------------------------------------
// Routes
// -------------------------------------------------------------

// Verify PIN
app.post("/api/auth/verify-pin", (req, res) => {
  const { pin } = req.body;
  if (!ADMIN_PIN || pin === ADMIN_PIN) {
    return res.json({ success: true });
  }
  return res.status(401).json({ success: false, error: "Incorrect PIN" });
});

// Accounts overview with live balance
app.get("/api/accounts", async (req, res) => {
  const accounts = await readJson(ACCOUNTS_FILE, []);
  const enriched = [];

  for (const acc of accounts) {
    let cached = cachedBalances.get(acc.id);
    const now = Date.now();
    // Cache for 30 seconds
    if (!cached || now - cached.timestamp > 30000) {
      const live = await fetchAccountData(acc.cookie);
      cached = {
        money: live.ok ? live.money : (cached?.money || 0),
        status: live.ok ? "ACTIVE" : (live.status === 401 ? "EXPIRED" : "ERROR"),
        timestamp: now
      };
      cachedBalances.set(acc.id, cached);
    }

    enriched.push({
      id: acc.id,
      name: acc.name,
      user: acc.user,
      uid: acc.uid,
      money: cached.money,
      status: cached.status
    });
  }

  res.json(enriched);
});

// Update Cookie for Account
app.post("/api/accounts/update-cookie", requirePin, async (req, res) => {
  const { accountId, cookie } = req.body;
  if (!accountId || !cookie) return res.status(400).json({ error: "accountId and cookie required" });

  const accounts = await readJson(ACCOUNTS_FILE, []);
  const idx = accounts.findIndex(a => a.id === accountId);
  if (idx === -1) return res.status(404).json({ error: "Account not found" });

  accounts[idx].cookie = cookie.trim();
  await writeJson(ACCOUNTS_FILE, accounts);
  cachedBalances.delete(accountId);

  res.json({ success: true, account: accounts[idx] });
});

// Auto-Login for PrinceDavid
app.post("/api/accounts/login-prince", requirePin, async (req, res) => {
  try {
    const loginRes = await fetch("https://lagoslife.app/api/auth/login", {
      method: "POST",
      headers: {
        "accept": "application/json",
        "content-type": "application/json",
        "origin": "https://lagoslife.app",
        "referer": "https://lagoslife.app/",
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36"
      },
      body: JSON.stringify({ username: "princedavid", password: "Oladelel" })
    });

    if (!loginRes.ok) {
      return res.status(loginRes.status).json({ error: "LagosLife rejected login credentials" });
    }

    const setCookies = loginRes.headers.getSetCookie ? loginRes.headers.getSetCookie() : [];
    const newCookieStr = setCookies.map(c => c.split(';')[0]).join('; ');

    const accounts = await readJson(ACCOUNTS_FILE, []);
    const prince = accounts.find(a => a.user === "princedavid" || a.id === "acc_3");
    if (prince && newCookieStr) {
      prince.cookie = newCookieStr;
      await writeJson(ACCOUNTS_FILE, accounts);
      cachedBalances.delete(prince.id);
    }

    res.json({ success: true, message: "PrinceDavid session refreshed seamlessly!" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Dynamic Recipient Resolution (/api/resolve-recipient?q=...)
app.get("/api/resolve-recipient", async (req, res) => {
  const query = (req.query.q || "").trim();
  if (!query) return res.status(400).json({ error: "Query required" });

  const rawId = extractTargetId(query);

  // If already a valid hex ID
  if (/^[a-f0-9]{20}$/i.test(rawId)) {
    return res.json({ id: rawId, username: query.replace(/^@/, ""), name: "Resolved Recipient" });
  }

  // Lookup via LagosLife API using an active account
  const accounts = await readJson(ACCOUNTS_FILE, []);
  const activeAcc = accounts.find(a => a.cookie) || accounts[0];
  const cleanUser = query.replace(/^@/, "");

  try {
    const pRes = await fetch(`https://lagoslife.app/api/players?q=${encodeURIComponent(cleanUser)}`, {
      headers: {
        "accept": "application/json",
        "cookie": activeAcc.cookie,
        "user-agent": "Mozilla/5.0"
      }
    });

    if (pRes.ok) {
      const data = await pRes.json();
      const players = data.players || [];
      const match = players.find(p => (p.username || "").toLowerCase() === cleanUser.toLowerCase()) || players[0];
      if (match) {
        return res.json({
          id: match.id,
          username: match.username,
          name: match.name,
          online: match.online,
          avatar: match.look
        });
      }
    }
  } catch (err) {
    console.error("Resolve error:", err.message);
  }

  return res.json({ id: rawId, username: cleanUser, name: cleanUser });
});

// -------------------------------------------------------------
// Transfer Execution & Queue
// -------------------------------------------------------------
app.get("/api/transfers/active", async (req, res) => {
  const jobs = await readJson(JOBS_FILE, []);
  const active = jobs.filter(j => j.status === "RUNNING");
  res.json(active);
});

app.get("/api/transfers/history", async (req, res) => {
  const jobs = await readJson(JOBS_FILE, []);
  res.json(jobs.slice(0, 50));
});

app.post("/api/transfers/stop", requirePin, async (req, res) => {
  const { jobId } = req.body;
  if (jobId && activeJobs.has(jobId)) {
    activeJobs.get(jobId).cancelled = true;
    activeJobs.delete(jobId);
    const jobs = await readJson(JOBS_FILE, []);
    const j = jobs.find(x => x.id === jobId);
    if (j) {
      j.status = "CANCELLED";
      await writeJson(JOBS_FILE, jobs);
    }
    return res.json({ success: true, message: "Job cancelled" });
  }
  res.status(404).json({ error: "Job not found or already completed" });
});

// Single Transfer Endpoint
app.post("/api/transfers/send", requirePin, async (req, res) => {
  const { accountId, to, amount, perTx, delaySeconds } = req.body;
  const accounts = await readJson(ACCOUNTS_FILE, []);
  const acc = accounts.find(a => a.id === accountId);
  if (!acc) return res.status(404).json({ error: "Sender account not found" });

  const resolvedTo = extractTargetId(to);
  if (!resolvedTo) return res.status(400).json({ error: "Recipient ID required" });

  const totalNum = Number(amount);
  const chunkSize = Number(perTx) || 10_000_000_000;
  const delayMs = (Number(delaySeconds) || 25) * 1000;

  const jobId = `tx_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  const totalTxs = Math.ceil(totalNum / chunkSize);

  const job = {
    id: jobId,
    type: "SINGLE",
    sender: acc.name,
    accountId: acc.id,
    target: resolvedTo,
    originalInput: to,
    total: totalNum,
    remaining: totalNum,
    chunkSize,
    totalTxs,
    txCount: 0,
    status: "RUNNING",
    startTime: new Date().toISOString(),
    logs: [`[${new Date().toLocaleTimeString()}] Transfer initialized: ${totalNum.toLocaleString()} to ${to}`]
  };

  const jobs = await readJson(JOBS_FILE, []);
  jobs.unshift(job);
  await writeJson(JOBS_FILE, jobs);

  const workerState = { cancelled: false };
  activeJobs.set(jobId, workerState);

  // Background worker
  (async () => {
    let remaining = totalNum;
    let count = 0;

    while (remaining > 0 && !workerState.cancelled) {
      const sendAmount = Math.min(chunkSize, remaining);
      count++;
      const r = await sendMoney(acc.cookie, resolvedTo, sendAmount);

      if (r.status === 200) {
        remaining -= sendAmount;
        job.remaining = remaining;
        job.txCount = count;
        job.logs.push(`[${new Date().toLocaleTimeString()}] [${count}/${totalTxs}] Sent ${sendAmount.toLocaleString()} ✅ (Remaining: ${remaining.toLocaleString()})`);
        await writeJson(JOBS_FILE, jobs);

        if (remaining > 0 && !workerState.cancelled) {
          await sleep(delayMs);
        }
      } else if (r.status === 429) {
        job.logs.push(`[${new Date().toLocaleTimeString()}] Rate limit (429). Retrying in 5s...`);
        await sleep(5000);
      } else {
        job.logs.push(`[${new Date().toLocaleTimeString()}] Error ${r.status}: ${JSON.stringify(r.data || r.error)}. Retrying in 5s...`);
        await sleep(5000);
      }
    }

    if (!workerState.cancelled) {
      job.status = "COMPLETED";
      job.logs.push(`[${new Date().toLocaleTimeString()}] 🎉 Finished delivering ${totalNum.toLocaleString()} to ${resolvedTo}!`);
    } else {
      job.status = "CANCELLED";
    }
    await writeJson(JOBS_FILE, jobs);
    activeJobs.delete(jobId);
  })();

  res.json({ success: true, job });
});

// Multi-Account Split Transfer (e.g. 200B Miles + 200B Prince + 100B Blaq)
app.post("/api/transfers/split", requirePin, async (req, res) => {
  const { to, plans } = req.body;
  // plans: [ { accountId: 'acc_1', amount: 200000000000 }, ... ]
  if (!to || !Array.isArray(plans) || plans.length === 0) {
    return res.status(400).json({ error: "Recipient and split plans required" });
  }

  const resolvedTo = extractTargetId(to);
  const accounts = await readJson(ACCOUNTS_FILE, []);
  const createdJobs = [];

  for (const plan of plans) {
    const acc = accounts.find(a => a.id === plan.accountId);
    if (!acc || plan.amount <= 0) continue;

    const totalNum = Number(plan.amount);
    const chunkSize = 10_000_000_000;
    const delayMs = 25000;
    const jobId = `split_${Date.now()}_${acc.user}_${Math.random().toString(36).substring(7)}`;
    const totalTxs = Math.ceil(totalNum / chunkSize);

    const job = {
      id: jobId,
      type: "SPLIT",
      sender: acc.name,
      accountId: acc.id,
      target: resolvedTo,
      originalInput: to,
      total: totalNum,
      remaining: totalNum,
      chunkSize,
      totalTxs,
      txCount: 0,
      status: "RUNNING",
      startTime: new Date().toISOString(),
      logs: [`[${new Date().toLocaleTimeString()}] Split leg started: ${acc.name} -> ${to} (${totalNum.toLocaleString()})`]
    };

    createdJobs.push(job);
    const workerState = { cancelled: false };
    activeJobs.set(jobId, workerState);

    // Run parallel leg worker
    (async () => {
      let remaining = totalNum;
      let count = 0;
      while (remaining > 0 && !workerState.cancelled) {
        const sendAmount = Math.min(chunkSize, remaining);
        count++;
        const r = await sendMoney(acc.cookie, resolvedTo, sendAmount);

        if (r.status === 200) {
          remaining -= sendAmount;
          job.remaining = remaining;
          job.txCount = count;
          job.logs.push(`[${new Date().toLocaleTimeString()}] [${count}/${totalTxs}] Leg ${acc.name} sent ${sendAmount.toLocaleString()} ✅`);

          if (remaining > 0 && !workerState.cancelled) {
            await sleep(delayMs);
          }
        } else if (r.status === 429) {
          job.logs.push(`[${new Date().toLocaleTimeString()}] Rate limit (429). Retrying in 5s...`);
          await sleep(5000);
        } else {
          job.logs.push(`[${new Date().toLocaleTimeString()}] Error ${r.status}. Retrying in 5s...`);
          await sleep(5000);
        }
      }

      job.status = workerState.cancelled ? "CANCELLED" : "COMPLETED";
      activeJobs.delete(jobId);
    })();
  }

  const jobs = await readJson(JOBS_FILE, []);
  jobs.unshift(...createdJobs);
  await writeJson(JOBS_FILE, jobs);

  res.json({ success: true, jobs: createdJobs });
});

// Batch List Distribution (e.g. 10B each to 8 users)
app.post("/api/transfers/batch", requirePin, async (req, res) => {
  const { accountId, recipients, amountPerUser } = req.body;
  if (!accountId || !Array.isArray(recipients) || recipients.length === 0) {
    return res.status(400).json({ error: "accountId and recipients array required" });
  }

  const accounts = await readJson(ACCOUNTS_FILE, []);
  const acc = accounts.find(a => a.id === accountId);
  if (!acc) return res.status(404).json({ error: "Account not found" });

  const amount = Number(amountPerUser) || 10_000_000_000;
  const jobId = `batch_${Date.now()}`;

  const job = {
    id: jobId,
    type: "BATCH",
    sender: acc.name,
    accountId: acc.id,
    recipientsCount: recipients.length,
    completedRecipients: 0,
    amountPerUser: amount,
    status: "RUNNING",
    startTime: new Date().toISOString(),
    logs: [`[${new Date().toLocaleTimeString()}] Batch job started for ${recipients.length} users (${amount.toLocaleString()} each)`]
  };

  const jobs = await readJson(JOBS_FILE, []);
  jobs.unshift(job);
  await writeJson(JOBS_FILE, jobs);

  const workerState = { cancelled: false };
  activeJobs.set(jobId, workerState);

  (async () => {
    for (let i = 0; i < recipients.length && !workerState.cancelled; i++) {
      const rawUser = recipients[i].trim();
      const targetId = extractTargetId(rawUser);

      let success = false;
      while (!success && !workerState.cancelled) {
        const r = await sendMoney(acc.cookie, targetId, amount);
        if (r.status === 200) {
          success = true;
          job.completedRecipients = i + 1;
          job.logs.push(`[${new Date().toLocaleTimeString()}] [${i + 1}/${recipients.length}] Sent to ${rawUser} (${targetId}) ✅`);
          await writeJson(JOBS_FILE, jobs);
          if (i < recipients.length - 1 && !workerState.cancelled) {
            await sleep(25000);
          }
        } else if (r.status === 429) {
          job.logs.push(`[${new Date().toLocaleTimeString()}] Rate limit (429). Retrying in 5s...`);
          await sleep(5000);
        } else {
          job.logs.push(`[${new Date().toLocaleTimeString()}] Error ${r.status} for ${rawUser}. Retrying in 5s...`);
          await sleep(5000);
        }
      }
    }

    job.status = workerState.cancelled ? "CANCELLED" : "COMPLETED";
    job.logs.push(`[${new Date().toLocaleTimeString()}] Batch job complete!`);
    await writeJson(JOBS_FILE, jobs);
    activeJobs.delete(jobId);
  })();

  res.json({ success: true, job });
});

// Periodic Session Keep-Alive Ping (Runs every 10 mins)
setInterval(async () => {
  try {
    const accounts = await readJson(ACCOUNTS_FILE, []);
    for (const acc of accounts) {
      if (!acc.cookie) continue;
      const res = await fetch("https://lagoslife.app/api/auth/me", {
        headers: { "accept": "application/json", "cookie": acc.cookie, "user-agent": "Mozilla/5.0" }
      });
      if (res.status === 401 && acc.user === "princedavid") {
        console.log("[KeepAlive] PrinceDavid session expired, auto-renewing...");
        await fetch("http://localhost:" + PORT + "/api/accounts/login-prince", {
          method: "POST",
          headers: { "x-admin-pin": ADMIN_PIN }
        }).catch(() => {});
      }
    }
  } catch (e) {}
}, 10 * 60 * 1000);

// Initialize storage and start server
initStorage().then(() => {
  app.listen(PORT, "0.0.0.0", () => {
    console.log("==================================================");
    console.log(`⚡ LagosLife Mobile Cloud Hub online at http://localhost:${PORT}`);
    console.log(`🔒 Admin PIN: ${ADMIN_PIN}`);
    console.log("==================================================");
  });
});
