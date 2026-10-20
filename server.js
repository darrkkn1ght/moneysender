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
  "mr_who": "d4f4aed94d6e491989cf",
  "lldc": "802ef46ea4eb4b1b8b47",
  "kvngdre": "1ab3a45045544574afe8",
  "dre": "1ab3a45045544574afe8",
  "bigola2823": "6e3c4bdaac6f4765ba52",
  "mr_ace": "6e3c4bdaac6f4765ba52"
};

async function resolveTargetIdAsync(input, cookie) {
  if (!input) return null;
  const trimmed = input.trim();

  // 1. Check if URL with ?with=...
  const urlMatch = trimmed.match(/[?&]with=([a-f0-9]{16,})/i);
  if (urlMatch) return { id: urlMatch[1], username: urlMatch[1] };

  // 2. Check if player profile URL
  const profileMatch = trimmed.match(/lagoslife\.app\/.*?([a-f0-9]{16,})/i);
  if (profileMatch) return { id: profileMatch[1], username: profileMatch[1] };

  // 3. Check if exact 20-character hex ID
  if (/^[a-f0-9]{20}$/i.test(trimmed)) {
    return { id: trimmed, username: trimmed };
  }

  // 4. Check known static map
  const clean = trimmed.toLowerCase().replace(/^@/, "");
  if (USERNAME_MAP[clean]) {
    return { id: USERNAME_MAP[clean], username: clean };
  }

  // 5. Query LagosLife API live to resolve username
  try {
    const res = await fetch(`https://lagoslife.app/api/players?q=${encodeURIComponent(clean)}`, {
      headers: {
        "accept": "application/json",
        "cookie": cookie || "",
        "user-agent": "Mozilla/5.0"
      }
    });
    if (res.ok) {
      const data = await res.json();
      const players = data.players || [];
      const match = players.find(p => (p.username || "").toLowerCase() === clean) || players[0];
      if (match) {
        return { id: match.id, username: match.username, name: match.name, avatar: match.look };
      }
    }
  } catch (err) {
    console.error("Resolve error:", err.message);
  }

  return null;
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
    // Cache for 25 seconds
    if (!cached || now - cached.timestamp > 25000) {
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

  const accounts = await readJson(ACCOUNTS_FILE, []);
  const activeAcc = accounts.find(a => a.cookie) || accounts[0];

  const resolved = await resolveTargetIdAsync(query, activeAcc.cookie);
  if (!resolved) {
    return res.status(404).json({ error: `Could not find player '${query}'. Please check spelling.` });
  }

  return res.json(resolved);
});

// -------------------------------------------------------------
// Transfer Execution & Queue
// -------------------------------------------------------------
const MONITORED_PIPELINES = [
  {
    id: "pipe_miles_lldc",
    sender: "Miles Peter (@milespete)",
    target: "802ef46ea4eb4b1b8b47",
    originalInput: "@LLDC",
    total: 2_000_000_000_000,
    totalTxs: 200,
    chunkSize: 10_000_000_000,
    stateFile: path.join(__dirname, "balances_miles_to_lldc_2t_oct20.json"),
    logFile: path.join(__dirname, "pipeline_miles_to_lldc_2t_oct20.log")
  },
  {
    id: "pipe_mrwho_lldc",
    sender: "mr_who (Idkwetulma)",
    target: "802ef46ea4eb4b1b8b47",
    originalInput: "@LLDC",
    total: 1_000_000_000_000,
    totalTxs: 100,
    chunkSize: 10_000_000_000,
    stateFile: path.join(__dirname, "balances_mrwho_to_lldc_1t_oct20.json"),
    logFile: path.join(__dirname, "pipeline_mrwho_to_lldc_1t_oct20.log")
  },
  {
    id: "pipe_kvngdre_blaq",
    sender: "Kvngdre (Dre)",
    target: "7785cae4f157450490d5",
    originalInput: "@blaqsebastian",
    total: 5_000_000_000_000,
    totalTxs: 500,
    chunkSize: 10_000_000_000,
    stateFile: path.join(__dirname, "balances_kvngdre_to_blaq_5t_oct20.json"),
    logFile: path.join(__dirname, "pipeline_kvngdre_to_blaq_5t_oct20.log")
  },
  {
    id: "pipe_prince_mrnasiru",
    sender: "PrinceDavid",
    target: "5568b53900504f9abcae",
    originalInput: "@MrNasiru",
    total: 200_000_000_000,
    totalTxs: 20,
    chunkSize: 10_000_000_000,
    stateFile: path.join(__dirname, "balances_prince_to_mrnasiru_200b_oct20.json"),
    logFile: path.join(__dirname, "pipeline_prince_to_mrnasiru_200b_oct20.log")
  }
];

async function getPipelineJobs() {
  const result = [];
  for (const p of MONITORED_PIPELINES) {
    try {
      const stateRaw = await fs.readFile(p.stateFile, "utf8").catch(() => null);
      if (!stateRaw) continue;
      const state = JSON.parse(stateRaw);
      
      let logs = [];
      let isRunning = false;
      const stat = await fs.stat(p.logFile).catch(() => null);
      if (stat) {
        const timeDiff = Date.now() - stat.mtimeMs;
        isRunning = timeDiff < 180000 && state.remaining > 0;
        const logContent = await fs.readFile(p.logFile, "utf8").catch(() => "");
        logs = logContent.trim().split("\n").filter(Boolean).slice(-3);
      }

      const isCompleted = state.remaining === 0;

      result.push({
        id: p.id,
        type: "PIPELINE",
        sender: p.sender,
        target: p.target,
        originalInput: p.originalInput,
        targetLabel: p.originalInput,
        total: p.total,
        remaining: state.remaining,
        chunkSize: p.chunkSize,
        totalTxs: p.totalTxs,
        txCount: state.txCount,
        status: isRunning ? "RUNNING" : (isCompleted ? "COMPLETED" : "IDLE"),
        logs: logs.length > 0 ? logs : ["Standing by..."]
      });
    } catch {}
  }
  return result;
}

app.get("/api/transfers/active", async (req, res) => {
  const jobs = await readJson(JOBS_FILE, []);
  const serverActive = jobs.filter(j => j.status === "RUNNING");
  const pipeJobs = await getPipelineJobs();
  const pipeActive = pipeJobs.filter(j => j.status === "RUNNING");
  res.json([...pipeActive, ...serverActive]);
});

app.get("/api/transfers/history", async (req, res) => {
  const jobs = await readJson(JOBS_FILE, []);
  const serverHist = jobs.filter(j => j.status !== "RUNNING");
  const pipeJobs = await getPipelineJobs();
  const pipeHist = pipeJobs.filter(j => j.status !== "RUNNING");
  res.json([...pipeHist, ...serverHist].slice(0, 50));
});

app.post("/api/transfers/clear-history", async (req, res) => {
  await writeJson(JOBS_FILE, []);
  res.json({ success: true, message: "History cleared!" });
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

  // Resolve recipient ID
  const resolved = await resolveTargetIdAsync(to, acc.cookie);
  if (!resolved || !resolved.id) {
    return res.status(400).json({ error: `Player '${to}' could not be found. Check username or chat link.` });
  }

  const resolvedTo = resolved.id;
  const targetLabel = resolved.name ? `${resolved.name} (@${resolved.username})` : (resolved.username || resolvedTo);

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
    targetLabel,
    total: totalNum,
    remaining: totalNum,
    chunkSize,
    totalTxs,
    txCount: 0,
    status: "RUNNING",
    startTime: new Date().toISOString(),
    logs: [`[${new Date().toLocaleTimeString()}] Transfer initialized: ${totalNum.toLocaleString()} to ${targetLabel}`]
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
        await writeJson(JOBS_FILE, jobs);
        await sleep(5000);
      } else {
        const errMsg = r.data?.error || JSON.stringify(r.data || r.error);
        job.logs.push(`[${new Date().toLocaleTimeString()}] Error ${r.status}: ${errMsg}`);
        
        // Fatal non-retryable errors
        if (r.status === 404 || (r.status === 400 && errMsg.includes("need"))) {
          job.status = "FAILED";
          job.logs.push(`[${new Date().toLocaleTimeString()}] ⛔ Job stopped: ${errMsg}`);
          await writeJson(JOBS_FILE, jobs);
          activeJobs.delete(jobId);
          return;
        }

        await writeJson(JOBS_FILE, jobs);
        await sleep(5000);
      }
    }

    if (!workerState.cancelled && job.status === "RUNNING") {
      job.status = "COMPLETED";
      job.logs.push(`[${new Date().toLocaleTimeString()}] 🎉 Finished delivering ${totalNum.toLocaleString()} to ${targetLabel}!`);
    } else if (workerState.cancelled) {
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
  if (!to || !Array.isArray(plans) || plans.length === 0) {
    return res.status(400).json({ error: "Recipient and split plans required" });
  }

  const accounts = await readJson(ACCOUNTS_FILE, []);
  const activeAcc = accounts.find(a => a.cookie) || accounts[0];

  // Resolve recipient ID
  const resolved = await resolveTargetIdAsync(to, activeAcc.cookie);
  if (!resolved || !resolved.id) {
    return res.status(400).json({ error: `Player '${to}' could not be found. Check username or chat link.` });
  }

  const resolvedTo = resolved.id;
  const targetLabel = resolved.name ? `${resolved.name} (@${resolved.username})` : (resolved.username || resolvedTo);
  const createdJobs = [];
  const jobs = await readJson(JOBS_FILE, []);

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
      targetLabel,
      total: totalNum,
      remaining: totalNum,
      chunkSize,
      totalTxs,
      txCount: 0,
      status: "RUNNING",
      startTime: new Date().toISOString(),
      logs: [`[${new Date().toLocaleTimeString()}] Split leg started: ${acc.name} -> ${targetLabel} (${totalNum.toLocaleString()})`]
    };

    createdJobs.push(job);
    jobs.unshift(job);
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
          await writeJson(JOBS_FILE, jobs);

          if (remaining > 0 && !workerState.cancelled) {
            await sleep(delayMs);
          }
        } else if (r.status === 429) {
          job.logs.push(`[${new Date().toLocaleTimeString()}] Rate limit (429). Retrying in 5s...`);
          await writeJson(JOBS_FILE, jobs);
          await sleep(5000);
        } else {
          const errMsg = r.data?.error || JSON.stringify(r.data || r.error);
          job.logs.push(`[${new Date().toLocaleTimeString()}] Error ${r.status}: ${errMsg}`);
          
          if (r.status === 404 || (r.status === 400 && errMsg.includes("need"))) {
            job.status = "FAILED";
            job.logs.push(`[${new Date().toLocaleTimeString()}] ⛔ Leg stopped: ${errMsg}`);
            await writeJson(JOBS_FILE, jobs);
            activeJobs.delete(jobId);
            return;
          }

          await writeJson(JOBS_FILE, jobs);
          await sleep(5000);
        }
      }

      if (job.status === "RUNNING") {
        job.status = workerState.cancelled ? "CANCELLED" : "COMPLETED";
      }
      await writeJson(JOBS_FILE, jobs);
      activeJobs.delete(jobId);
    })();
  }

  await writeJson(JOBS_FILE, jobs);
  res.json({ success: true, jobs: createdJobs });
});

// -------------------------------------------------------------
// VIP Client Portal API (Multi-Tenant & Isolated)
// -------------------------------------------------------------
const clientSessions = new Map(); // token -> { account, jobs: [] }

app.get(["/client", "/vip", "/portal"], (req, res) => {
  res.sendFile(path.join(__dirname, "public", "client.html"));
});

// Client Login (Username & Password)
app.post("/api/client/login", async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: "Username and password required" });

  try {
    const cleanUser = username.trim().replace(/^@/, "");
    const loginRes = await fetch("https://lagoslife.app/api/auth/login", {
      method: "POST",
      headers: {
        "accept": "application/json",
        "content-type": "application/json",
        "origin": "https://lagoslife.app",
        "referer": "https://lagoslife.app/",
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36"
      },
      body: JSON.stringify({ username: cleanUser, password })
    });

    if (!loginRes.ok) {
      const err = await loginRes.json().catch(() => ({}));
      return res.status(loginRes.status).json({ error: err.error || "Login rejected by LagosLife. Check credentials." });
    }

    const setCookies = loginRes.headers.getSetCookie ? loginRes.headers.getSetCookie() : [];
    const cookieStr = setCookies.map(c => c.split(";")[0]).join("; ");
    if (!cookieStr) {
      return res.status(401).json({ error: "No session cookies received" });
    }

    const authRes = await fetch("https://lagoslife.app/api/auth/me", {
      headers: { "cookie": cookieStr, "user-agent": "Mozilla/5.0" }
    });
    const authData = await authRes.json().catch(() => ({}));
    const user = authData.user || {};

    const live = await fetchAccountData(cookieStr);
    const token = "vip_" + crypto.randomUUID().replace(/-/g, "");

    const clientData = {
      token,
      account: {
        uid: user.id || "client",
        user: user.username || cleanUser,
        name: user.name || user.username || cleanUser,
        money: live.ok ? live.money : 0,
        cookie: cookieStr
      },
      jobs: []
    };

    clientSessions.set(token, clientData);
    res.json({ success: true, token, account: clientData.account });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Client Cookie Import
app.post("/api/client/import-cookie", async (req, res) => {
  const { cookie } = req.body;
  if (!cookie) return res.status(400).json({ error: "Cookie string required" });

  try {
    const cleanCookie = cookie.trim();
    const authRes = await fetch("https://lagoslife.app/api/auth/me", {
      headers: { "cookie": cleanCookie, "user-agent": "Mozilla/5.0" }
    });
    const authData = await authRes.json().catch(() => ({}));
    if (!authData.user) {
      return res.status(401).json({ error: "Invalid or expired LagosLife session cookie" });
    }

    const live = await fetchAccountData(cleanCookie);
    const user = authData.user;
    const token = "vip_" + crypto.randomUUID().replace(/-/g, "");

    const clientData = {
      token,
      account: {
        uid: user.id,
        user: user.username,
        name: user.name || user.username,
        money: live.ok ? live.money : 0,
        cookie: cleanCookie
      },
      jobs: []
    };

    clientSessions.set(token, clientData);
    res.json({ success: true, token, account: clientData.account });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Client Session Status & Balance
app.get("/api/client/status", async (req, res) => {
  const token = req.headers["x-client-token"] || req.query.token;
  if (!token || !clientSessions.has(token)) {
    return res.status(401).json({ error: "Unauthenticated" });
  }
  const session = clientSessions.get(token);
  const live = await fetchAccountData(session.account.cookie);
  if (live.ok) session.account.money = live.money;

  res.json({ account: session.account, jobs: session.jobs });
});

// Client Single Transfer
app.post("/api/client/send", async (req, res) => {
  const token = req.headers["x-client-token"] || req.query.token;
  if (!token || !clientSessions.has(token)) return res.status(401).json({ error: "Unauthenticated" });

  const session = clientSessions.get(token);
  const { to, amount } = req.body;
  if (!to || !amount) return res.status(400).json({ error: "Recipient and amount required" });

  // Resolve target
  const resolved = await resolveTargetIdAsync(to, session.account.cookie);
  if (!resolved || !resolved.id) {
    return res.status(400).json({ error: `Player '${to}' could not be found` });
  }

  const resolvedTo = resolved.id;
  const targetLabel = resolved.name ? `${resolved.name} (@${resolved.username})` : (resolved.username || resolvedTo);
  const totalNum = Number(amount);
  const chunkSize = 10_000_000_000;
  const delayMs = 25000;
  const jobId = `client_tx_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  const totalTxs = Math.ceil(totalNum / chunkSize);

  const job = {
    id: jobId,
    sender: session.account.name,
    target: resolvedTo,
    originalInput: to,
    targetLabel,
    total: totalNum,
    remaining: totalNum,
    chunkSize,
    totalTxs,
    txCount: 0,
    status: "RUNNING",
    logs: [`[${new Date().toLocaleTimeString()}] Transfer initialized: ${totalNum.toLocaleString()} to ${targetLabel}`]
  };

  session.jobs.unshift(job);
  const workerState = { cancelled: false };
  activeJobs.set(jobId, workerState);

  (async () => {
    let remaining = totalNum;
    let count = 0;
    while (remaining > 0 && !workerState.cancelled) {
      const sendAmt = Math.min(chunkSize, remaining);
      count++;
      const r = await sendMoney(session.account.cookie, resolvedTo, sendAmt);

      if (r.status === 200) {
        remaining -= sendAmt;
        job.remaining = remaining;
        job.txCount = count;
        job.logs.push(`[${new Date().toLocaleTimeString()}] [${count}/${totalTxs}] Sent ${sendAmt.toLocaleString()} ✅ (Remaining: ${remaining.toLocaleString()})`);
        if (remaining > 0 && !workerState.cancelled) await sleep(delayMs);
      } else if (r.status === 429) {
        job.logs.push(`[${new Date().toLocaleTimeString()}] Rate limit (429). Retrying in 5s...`);
        await sleep(5000);
      } else {
        const errMsg = r.data?.error || JSON.stringify(r.data || r.error);
        job.logs.push(`[${new Date().toLocaleTimeString()}] Error ${r.status}: ${errMsg}`);
        if (r.status === 404 || (r.status === 400 && String(errMsg).includes("need"))) {
          job.status = "FAILED";
          activeJobs.delete(jobId);
          return;
        }
        await sleep(5000);
      }
    }
    if (job.status === "RUNNING") {
      job.status = workerState.cancelled ? "CANCELLED" : "COMPLETED";
    }
    activeJobs.delete(jobId);
  })();

  res.json({ success: true, job });
});

// Client Batch Send
app.post("/api/client/batch", async (req, res) => {
  const token = req.headers["x-client-token"] || req.query.token;
  if (!token || !clientSessions.has(token)) return res.status(401).json({ error: "Unauthenticated" });

  const session = clientSessions.get(token);
  const { recipients, amountPerUser } = req.body;
  if (!Array.isArray(recipients) || recipients.length === 0) {
    return res.status(400).json({ error: "At least one recipient required" });
  }

  const amount = Number(amountPerUser) || 10_000_000_000;
  const jobId = `client_batch_${Date.now()}`;
  const totalAmount = recipients.length * amount;

  const job = {
    id: jobId,
    sender: session.account.name,
    target: `${recipients.length} players`,
    originalInput: `${recipients.length} recipients`,
    targetLabel: `Batch (${recipients.length} users)`,
    total: totalAmount,
    remaining: totalAmount,
    chunkSize: amount,
    totalTxs: recipients.length,
    txCount: 0,
    status: "RUNNING",
    logs: [`[${new Date().toLocaleTimeString()}] Batch started: ${recipients.length} recipients`]
  };

  session.jobs.unshift(job);
  const workerState = { cancelled: false };
  activeJobs.set(jobId, workerState);

  (async () => {
    let count = 0;
    for (const rawUser of recipients) {
      if (workerState.cancelled) break;
      const resolved = await resolveTargetIdAsync(rawUser, session.account.cookie);
      if (!resolved || !resolved.id) {
        job.logs.push(`⚠️ Skipped unknown user: ${rawUser}`);
        continue;
      }

      count++;
      const r = await sendMoney(session.account.cookie, resolved.id, amount);
      if (r.status === 200) {
        job.remaining -= amount;
        job.txCount = count;
        job.logs.push(`[${count}/${recipients.length}] Sent ${amount.toLocaleString()} to @${resolved.username} ✅`);
        await sleep(25000);
      } else {
        job.logs.push(`Error sending to @${resolved.username}: ${r.status}`);
        await sleep(5000);
      }
    }
    job.status = workerState.cancelled ? "CANCELLED" : "COMPLETED";
    activeJobs.delete(jobId);
  })();

  res.json({ success: true, job });
});

// Client Stop Job
app.post("/api/client/stop", async (req, res) => {
  const token = req.headers["x-client-token"];
  const { jobId } = req.body;
  if (jobId && activeJobs.has(jobId)) {
    activeJobs.get(jobId).cancelled = true;
    activeJobs.delete(jobId);
    if (token && clientSessions.has(token)) {
      const j = clientSessions.get(token).jobs.find(x => x.id === jobId);
      if (j) j.status = "CANCELLED";
    }
    return res.json({ success: true, message: "Job cancelled" });
  }
  res.status(404).json({ error: "Job not found" });
});

// Client Logout
app.post("/api/client/logout", async (req, res) => {
  const token = req.headers["x-client-token"];
  if (token && clientSessions.has(token)) {
    const session = clientSessions.get(token);
    for (const j of session.jobs) {
      if (activeJobs.has(j.id)) activeJobs.get(j.id).cancelled = true;
    }
    clientSessions.delete(token);
  }
  res.json({ success: true, message: "Session wiped" });
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
