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

app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.static(path.join(__dirname, "public")));

const DATA_DIR = path.join(__dirname, "data");
const ACCOUNTS_FILE = path.join(DATA_DIR, "accounts.json");
const RECIPIENTS_FILE = path.join(DATA_DIR, "recipients.json");
const JOBS_FILE = path.join(DATA_DIR, "jobs.json");
const SHOPS_FILE = path.join(DATA_DIR, "shops.json");

const USERNAME_MAP = {
  "blaqsebastian": "7785cae4f157450490d5",
  "@blaqsebastian": "7785cae4f157450490d5",
  "sebastian": "7785cae4f157450490d5",
  "milespete": "bc745837935d45efbf47",
  "@milespete": "bc745837935d45efbf47",
  "miles": "bc745837935d45efbf47",
  "princedavid": "7e791760cd644f13ba5a",
  "@princedavid": "7e791760cd644f13ba5a"
};

function resolveRecipientId(input) {
  if (!input) return "";
  const trimmed = input.trim();

  // Extract from URLs like ?with=XXXXX
  const urlMatch = trimmed.match(/[?&]with=([a-f0-9]+)/i);
  if (urlMatch) return urlMatch[1];

  // Extract from player profile URLs
  const profileMatch = trimmed.match(/lagoslife\.app\/.*?([a-f0-9]{16,})/i);
  if (profileMatch) return profileMatch[1];

  const cleaned = trimmed.toLowerCase();
  if (USERNAME_MAP[cleaned]) return USERNAME_MAP[cleaned];
  if (cleaned.startsWith("@") && USERNAME_MAP[cleaned.substring(1)]) {
    return USERNAME_MAP[cleaned.substring(1)];
  }
  return trimmed;
}

async function initStorage() {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });

    try { await fs.access(ACCOUNTS_FILE); } catch {
      const defaultAccounts = [
        {
          id: "acc_1",
          name: "Miles Peter (@milespete)",
          user: "milespete",
          cookie: "ll_vid=e2c5139529b14929bd43; ll_session=778892b94ea1f4c36ffde880a8bc6ea0bbd0618c651b69fe4659bcf488de52b8; ll_dev=165o5s0h0y6i4x6k; ll_pass=eyJpIjoiYmM3NDU4Mzc5MzVkNDVlZmJmNDciLCJ1IjoibWlsZXNwZXRlIiwibiI6Ik1pbGVzIFBldGVyIiwidCI6IlRVVkdqWXdLU3MyaFI5VEYiLCJlIjoxNzkxNTQ0ODQ4MTAzfQ.oxLDmu3-MgFQ7M1ybgW20DshT9nixQa9uwb_kI_m1V8"
        },
        {
          id: "acc_2",
          name: "Sebastian (@blaqsebastian)",
          user: "blaqsebastian",
          cookie: "ll_dev=4o3z111w5i470l2f; ll_session=efcc189dc5a49de670dd1e040b3aa38eaddeed5bedc2c1abe0f1f0dd6979092e; ll_vid=2fe99f9ce0624c4abb14; ll_pass=eyJpIjoiNzc4NWNhZTRmMTU3NDUwNDkwZDUiLCJ1IjoiYmxhcXNlYmFzdGlhbiIsIm4iOiJTZWJhc3RpYW4iLCJ0IjoiQ2JDQmMtYzFUTV93QmdZRiIsImUiOjE3OTE1NDQ1OTUzMjV9.ZMpscBk0UIB5URuR1xNPsoJ4KVHbtnBMJztnSoYqTkk"
        }
      ];
      await fs.writeFile(ACCOUNTS_FILE, JSON.stringify(defaultAccounts, null, 2));
    }

    try { await fs.access(RECIPIENTS_FILE); } catch {
      const defaultRecipients = [
        { id: "7785cae4f157450490d5", name: "@blaqsebastian" },
        { id: "0760cfa07f7e44779b20", name: "User 0760" },
        { id: "a0a1a780476e46b5a032", name: "User a0a1" },
        { id: "601dcbd56fa84bb68f3c", name: "User 601d" },
        { id: "e1162ef87cca48f590b5", name: "User e116" },
        { id: "5b8864d403704ef9a954", name: "User 5b88" }
      ];
      await fs.writeFile(RECIPIENTS_FILE, JSON.stringify(defaultRecipients, null, 2));
    }

    try { await fs.access(JOBS_FILE); } catch {
      await fs.writeFile(JOBS_FILE, JSON.stringify([], null, 2));
    }

    try { await fs.access(SHOPS_FILE); } catch {
      await fs.writeFile(SHOPS_FILE, JSON.stringify([], null, 2));
    }
  } catch (err) {
    console.error("Storage init error:", err);
  }
}

const activeJobs = new Map();

async function readJson(file) {
  try {
    const data = await fs.readFile(file, "utf8");
    return JSON.parse(data);
  } catch {
    return [];
  }
}

async function writeJson(file, data) {
  await fs.writeFile(file, JSON.stringify(data, null, 2), "utf8");
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function parseCookieFromHeaders(headerText) {
  const match = headerText.match(/cookie:\s*([^\r\n]+)/i);
  if (match) return match[1].trim();

  const matchPass = headerText.match(/(ll_vid=[^;\r\n]+;?\s*ll_session=[^;\r\n]+;?\s*ll_dev=[^;\r\n]+;?\s*ll_pass=[^\s\r\n]+)/i);
  if (matchPass) return matchPass[1].trim();

  return null;
}

// Routes
app.get("/api/accounts", async (req, res) => {
  const accounts = await readJson(ACCOUNTS_FILE);
  res.json(accounts);
});

app.post("/api/accounts", async (req, res) => {
  const { name, cookie, rawHeaders } = req.body;
  let cookieString = cookie ? cookie.trim() : "";

  if (rawHeaders && !cookieString) {
    const extracted = parseCookieFromHeaders(rawHeaders);
    if (extracted) cookieString = extracted;
  }

  if (!cookieString) {
    return res.status(400).json({ error: "Cookie string or valid raw headers required." });
  }

  const accounts = await readJson(ACCOUNTS_FILE);
  const id = `acc_${Date.now()}`;
  const newAcc = {
    id,
    name: name || `Account ${accounts.length + 1}`,
    cookie: cookieString
  };

  accounts.push(newAcc);
  await writeJson(ACCOUNTS_FILE, accounts);
  res.json(newAcc);
});

// 1-Click Sync Endpoint from Browser Console
app.post("/api/sync", async (req, res) => {
  const { cookie, user, context, shops } = req.body;
  if (!cookie) return res.status(400).json({ error: "Cookie required" });

  const accounts = await readJson(ACCOUNTS_FILE);
  const userName = user || (context && (context.username || context.uid)) || "Synced Account";
  
  const existingIdx = accounts.findIndex(a => a.name.includes(userName) || a.cookie === cookie);
  if (existingIdx >= 0) {
    accounts[existingIdx].cookie = cookie;
  } else {
    accounts.push({
      id: `acc_${Date.now()}`,
      name: `${userName} (Synced)`,
      cookie: cookie
    });
  }
  await writeJson(ACCOUNTS_FILE, accounts);

  if (shops) {
    await writeJson(SHOPS_FILE, shops);
  }

  res.json({ success: true, message: "Synced successfully!" });
});

app.delete("/api/accounts/:id", async (req, res) => {
  let accounts = await readJson(ACCOUNTS_FILE);
  accounts = accounts.filter(a => a.id !== req.params.id);
  await writeJson(ACCOUNTS_FILE, accounts);
  res.json({ success: true });
});

app.get("/api/recipients", async (req, res) => {
  const recipients = await readJson(RECIPIENTS_FILE);
  res.json(recipients);
});

app.get("/api/jobs", async (req, res) => {
  const jobs = await readJson(JOBS_FILE);
  res.json(jobs);
});

app.get("/api/transfers/live", async (req, res) => {
  try {
    const pipelines = [];
    const files = await fs.readdir(__dirname);
    const balanceFiles = files.filter(f => f.startsWith("balances_") && f.endsWith(".json"));

    const PIPELINE_LABELS = {
      "balances_miles_to_08c2_2nd_1t.json": { name: "Pipeline: @milespete → 08c2 (2nd 1T)", sender: "@milespete", recipientLabel: "User 08c2" },
      "balances_blaq_to_cbf9_500b.json": { name: "Pipeline: @blaqsebastian → cbf9 (500B)", sender: "@blaqsebastian", recipientLabel: "User cbf9" },
      "balances_miles_to_08c2_1t.json": { name: "Pipeline: @milespete → 08c2 (1T)", sender: "@milespete", recipientLabel: "User 08c2" },
      "balances_blaq_to_6cdd_1t.json": { name: "Pipeline: @blaqsebastian → 6cdd (1T)", sender: "@blaqsebastian", recipientLabel: "User 6cdd" },
      "balances_miles_to_cfb8_1t.json": { name: "Pipeline: @milespete → cfb8 (1T)", sender: "@milespete", recipientLabel: "User cfb8" },
      "balances_blaq_to_15fa_200b.json": { name: "Pipeline: @blaqsebastian → 15fa (200B)", sender: "@blaqsebastian", recipientLabel: "User 15fa" },
      "balances_miles_to_96cf_200b.json": { name: "Pipeline: @milespete → 96cf (200B)", sender: "@milespete", recipientLabel: "User 96cf" },
      "balances_david_to_e92e_200b.json": { name: "Pipeline: @princedavid → e92e (200B)", sender: "@princedavid", recipientLabel: "User e92e" },
      "balances_david_to_ae9d_1t.json": { name: "Pipeline: @princedavid → ae9d (1T)", sender: "@princedavid", recipientLabel: "User ae9d" },
      "balances_7b17_1t.json": { name: "Pipeline: @milespete → 7b17 (1T)", sender: "@milespete", recipientLabel: "User 7b17" },
      "balances_blaq_to_16a4_500b.json": { name: "Pipeline: @blaqsebastian → 16a4 (500B)", sender: "@blaqsebastian", recipientLabel: "User 16a4" },
      "balances_6cdd_1t.json": { name: "Pipeline: @milespete → 6cdd (1T)", sender: "@milespete", recipientLabel: "User 6cdd" },
      "balances_blaq_to_cfb8_500b.json": { name: "Pipeline: @blaqsebastian → cfb8 (500B)", sender: "@blaqsebastian", recipientLabel: "User cfb8" },
      "balances_blaq_to_bbf2_500b.json": { name: "Pipeline: @blaqsebastian → bbf2 (500B)", sender: "@blaqsebastian", recipientLabel: "User bbf2" },
      "balances_miles_to_blaq_2t.json": { name: "Pipeline: @milespete → @blaqsebastian (2T)", sender: "@milespete", recipientLabel: "@blaqsebastian" },
      "balances_c353_100b.json": { name: "Pipeline: @milespete → c353 (100B)", sender: "@milespete", recipientLabel: "User c353" },
      "balances_8c61_100b.json": { name: "Pipeline: @milespete → 8c61 (100B)", sender: "@milespete", recipientLabel: "User 8c61" },
      "balances_3295_500b.json": { name: "Pipeline: @milespete → 3295 (500B)", sender: "@milespete", recipientLabel: "User 3295" },
      "balances_d87b_1t.json": { name: "Pipeline: @blaqsebastian → d87b (1T)", sender: "@blaqsebastian", recipientLabel: "User d87b" },
      "balances_3609_1t.json": { name: "Pipeline: @milespete → 3609 (1T)", sender: "@milespete", recipientLabel: "User 3609" },
      "balances_pipeline_miles_blaq_5t.json": { name: "Pipeline: @milespete → @blaqsebastian (5T)", sender: "@milespete", recipientLabel: "@blaqsebastian" },
      "balances_pipeline_blaq_7e79_5t.json": { name: "Pipeline: @blaqsebastian → 7e79 (5T)", sender: "@blaqsebastian", recipientLabel: "User 7e79" },
      "balances_miles_to_be1c_3t.json": { name: "Pipeline: @milespete → be1c (3T)", sender: "@milespete", recipientLabel: "User be1c" },
      "balances_miles_to_blaq_3t.json": { name: "Pipeline: @milespete → @blaqsebastian (3T)", sender: "@milespete", recipientLabel: "@blaqsebastian" },
      "balances_miles_to_c060_1t.json": { name: "Pipeline: @milespete → c060 (1T)", sender: "@milespete", recipientLabel: "User c060" },
      "balances_miles_to_7b17_550b.json": { name: "Pipeline: @milespete → 7b17 (550B)", sender: "@milespete", recipientLabel: "User 7b17" }
    };

    let idx = 0;
    for (const file of balanceFiles) {
      try {
        const raw = await fs.readFile(path.join(__dirname, file), "utf8");
        const data = JSON.parse(raw);
        for (const [recipientId, info] of Object.entries(data)) {
          if (!info.target || !info.remaining) continue;
          idx++;
          const target = BigInt(info.target);
          const remaining = BigInt(info.remaining);
          const sent = target - remaining;
          const pct = target > 0n ? Number((sent * 10000n) / target) / 100 : 0;
          const label = PIPELINE_LABELS[file] || {};
          pipelines.push({
            id: `pipeline-${idx}`,
            name: label.name || file.replace("balances_", "").replace(".json", ""),
            sender: label.sender || "unknown",
            recipient: label.recipientLabel ? `${label.recipientLabel} (${recipientId})` : recipientId,
            target: target.toString(),
            sent: sent.toString(),
            remaining: remaining.toString(),
            transactions: info.transaction || 0,
            totalTransactions: Number(target / 10_000_000_000n),
            percent: pct,
            status: remaining === 0n ? "COMPLETED" : "STREAMING",
            file
          });
        }
      } catch (e) {}
    }

    // Sort: active first, then by most sent
    pipelines.sort((a, b) => {
      if (a.status !== b.status) return a.status === "STREAMING" ? -1 : 1;
      return BigInt(b.sent) > BigInt(a.sent) ? 1 : -1;
    });

    res.json({
      success: true,
      timestamp: Date.now(),
      pipelines
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/jobs/stop/:id", async (req, res) => {
  const jobId = req.params.id;
  const worker = activeJobs.get(jobId);
  if (worker) {
    worker.cancelled = true;
    activeJobs.delete(jobId);
  }

  const jobs = await readJson(JOBS_FILE);
  const job = jobs.find(j => j.id === jobId);
  if (job) {
    job.status = "STOPPED";
    await writeJson(JOBS_FILE, jobs);
  }

  res.json({ success: true });
});

app.post("/api/jobs/transfer", async (req, res) => {
  const { accountId, to, targetAmount, batchSize, delayMs } = req.body;
  const accounts = await readJson(ACCOUNTS_FILE);
  const account = accounts.find(a => a.id === accountId);

  if (!account) return res.status(400).json({ error: "Selected account not found." });
  
  const resolvedTo = resolveRecipientId(to);
  if (!resolvedTo) return res.status(400).json({ error: "Recipient ID or Username required." });

  const target = BigInt(targetAmount || "100000000000");
  const perTx = BigInt(batchSize || "10000000000");
  const delay = Number(delayMs) || 21000;

  const jobId = `job_tx_${Date.now()}`;
  const jobs = await readJson(JOBS_FILE);

  const job = {
    id: jobId,
    type: "TRANSFER",
    accountId: account.id,
    accountName: account.name,
    to: resolvedTo,
    originalInput: to,
    target: target.toString(),
    remaining: target.toString(),
    completedCount: 0,
    status: "RUNNING",
    startTime: new Date().toISOString(),
    logs: [`[${new Date().toLocaleTimeString()}] Transfer job initialized for ${to} (${resolvedTo})`]
  };

  jobs.unshift(job);
  await writeJson(JOBS_FILE, jobs);

  const workerState = { cancelled: false };
  activeJobs.set(jobId, workerState);

  (async () => {
    let remaining = target;
    let transactionCount = 0;

    while (remaining > 0n && !workerState.cancelled) {
      transactionCount++;
      const amount = remaining >= perTx ? perTx : remaining;
      const txId = `${jobId}-${transactionCount}`;

      let success = false;
      let attempt = 0;
      const maxRetries = 15;

      while (!success && attempt < maxRetries && !workerState.cancelled) {
        attempt++;
        try {
          const resp = await fetch("https://lagoslife.app/api/send", {
            method: "POST",
            headers: {
              "accept": "*/*",
              "content-type": "application/json",
              "origin": "https://lagoslife.app",
              "referer": "https://lagoslife.app/",
              "cookie": account.cookie,
              "idempotency-key": txId
            },
            body: JSON.stringify({ to: resolvedTo, amount: Number(amount) })
          });

          const resText = await resp.text();
          if (resp.ok) {
            success = true;
            remaining -= amount;
            job.remaining = remaining.toString();
            job.completedCount = transactionCount;
            job.logs.push(`[${new Date().toLocaleTimeString()}] Tx #${transactionCount}: Sent ${amount.toString()} → Status 200`);
            await writeJson(JOBS_FILE, jobs);
          } else {
            job.logs.push(`[${new Date().toLocaleTimeString()}] Tx #${transactionCount} Attempt ${attempt}: Status ${resp.status} - ${resText}`);
            await sleep(5000);
          }
        } catch (err) {
          job.logs.push(`[${new Date().toLocaleTimeString()}] Network Error: ${err.message}`);
          await sleep(5000);
        }
      }

      if (!success) {
        job.status = "FAILED";
        await writeJson(JOBS_FILE, jobs);
        activeJobs.delete(jobId);
        return;
      }

      if (remaining > 0n && !workerState.cancelled) {
        await sleep(delay);
      }
    }

    if (!workerState.cancelled) {
      job.status = "COMPLETED";
      job.logs.push(`[${new Date().toLocaleTimeString()}] Finished transfer of ${target.toString()}.`);
      await writeJson(JOBS_FILE, jobs);
    }
    activeJobs.delete(jobId);
  })();

  res.json(job);
});

app.post("/api/jobs/buy", async (req, res) => {
  const { accountId, product, price, owner, company, qty, delayMs } = req.body;
  const accounts = await readJson(ACCOUNTS_FILE);
  const account = accounts.find(a => a.id === accountId);

  if (!account) return res.status(400).json({ error: "Selected account not found." });

  const totalQty = Number(qty) || 100;
  const itemPrice = Number(price) || 500;
  const delay = Number(delayMs) || 3000;
  const shopOwner = owner || "bc745837935d45efbf47";
  const shopCo = company || "co_1321462dbc6c455183d1";
  const pId = product || "p-bread";

  const jobId = `job_buy_${Date.now()}`;
  const jobs = await readJson(JOBS_FILE);

  const job = {
    id: jobId,
    type: "SHOP_BUY",
    accountId: account.id,
    accountName: account.name,
    product: pId,
    targetQty: totalQty,
    completedCount: 0,
    status: "RUNNING",
    startTime: new Date().toISOString(),
    logs: [`[${new Date().toLocaleTimeString()}] Bulk buy job started for ${totalQty} x ${pId}`]
  };

  jobs.unshift(job);
  await writeJson(JOBS_FILE, jobs);

  const workerState = { cancelled: false };
  activeJobs.set(jobId, workerState);

  (async () => {
    let bought = 0;
    for (let i = 1; i <= totalQty && !workerState.cancelled; i++) {
      const key = crypto.randomBytes(12).toString("hex");
      let attempt = 0;
      let success = false;

      while (!success && attempt < 10 && !workerState.cancelled) {
        attempt++;
        try {
          const resp = await fetch("https://lagoslife.app/api/shop", {
            method: "POST",
            headers: {
              "accept": "*/*",
              "content-type": "application/json",
              "origin": "https://lagoslife.app",
              "referer": "https://lagoslife.app/",
              "cookie": account.cookie
            },
            body: JSON.stringify({
              action: "buy",
              owner: shopOwner,
              co: shopCo,
              p: pId,
              price: itemPrice,
              qty: 1,
              key: key
            })
          });

          const resText = await resp.text();
          if (resp.ok) {
            success = true;
            bought++;
            job.completedCount = bought;
            job.logs.push(`[${new Date().toLocaleTimeString()}] Bought ${bought}/${totalQty}`);
            await writeJson(JOBS_FILE, jobs);
          } else if (resText.includes("sold out") || resText.includes("insufficient")) {
            job.logs.push(`[${new Date().toLocaleTimeString()}] Stopped: ${resText}`);
            job.status = "STOPPED";
            await writeJson(JOBS_FILE, jobs);
            activeJobs.delete(jobId);
            return;
          } else {
            await sleep(5000);
          }
        } catch (err) {
          await sleep(5000);
        }
      }

      if (i < totalQty && !workerState.cancelled) {
        await sleep(delay);
      }
    }

    if (!workerState.cancelled && job.status === "RUNNING") {
      job.status = "COMPLETED";
      job.logs.push(`[${new Date().toLocaleTimeString()}] Bulk buy finished.`);
      await writeJson(JOBS_FILE, jobs);
    }
    activeJobs.delete(jobId);
  })();

  res.json(job);
});

// For Vercel serverless: export the app
// For Render/local: start listening
if (process.env.VERCEL) {
  // Vercel handles listening — just init storage
  initStorage();
} else {
  initStorage().then(() => {
    app.listen(PORT, () => {
      console.log(`LagosLife Sender running on http://localhost:${PORT}`);
    });
  });
}

export default app;

