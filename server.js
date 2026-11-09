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
const ADMIN_PASSCODE = process.env.ADMIN_PASSCODE || process.env.ADMIN_PIN || "2026";
const MAX_TRANSFER_CHUNK = 100_000_000_000; // 100 Billion max per request enforced by LagosLife API

app.use(cors());
app.use(express.json({ limit: "50mb" }));

// Only genuinely public assets are served statically
app.use(express.static(path.join(__dirname, "public"), {
  setHeaders: (res) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
  }
}));

const DATA_DIR = path.join(__dirname, "data");
const ACCOUNTS_FILE = path.join(DATA_DIR, "accounts.json");
const JOBS_FILE = path.join(DATA_DIR, "jobs.json");
const LEDGER_FILE = path.join(DATA_DIR, "ledger.json");
const PRIVATE_ADMIN_DIR = path.join(__dirname, "private_admin");

// In-memory sessions & active transfer workers
const adminSessions = new Map(); // token -> { createdAt, ip }
const loginAttempts = new Map(); // ip -> { count, lockedUntil }
const activeJobs = new Map();
const cachedBalances = new Map();
const clientSessions = new Map(); // token -> { account, jobs: [] }

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function waitInterval(delayMs, workerState) {
  const step = Math.min(50, Math.max(10, delayMs));
  let elapsed = 0;
  while (elapsed < delayMs && !workerState?.cancelled && !workerState?.paused) {
    await sleep(step);
    elapsed += step;
  }
}

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

// -------------------------------------------------------------
// Authentication Helpers
// -------------------------------------------------------------
function parseCookies(req) {
  const list = {};
  const rc = req.headers.cookie;
  if (rc) {
    rc.split(";").forEach(c => {
      const parts = c.split("=");
      list[parts.shift().trim()] = decodeURI(parts.join("="));
    });
  }
  return list;
}

function mergeCookies(baseCookie, setCookieHeaders) {
  if (!setCookieHeaders || !setCookieHeaders.length) return baseCookie;
  const cookieMap = new Map();
  if (baseCookie) {
    baseCookie.split(";").forEach(part => {
      const idx = part.indexOf("=");
      if (idx !== -1) {
        cookieMap.set(part.slice(0, idx).trim(), part.slice(idx + 1).trim());
      }
    });
  }
  for (const c of setCookieHeaders) {
    const raw = c.split(";")[0];
    const idx = raw.indexOf("=");
    if (idx !== -1) {
      cookieMap.set(raw.slice(0, idx).trim(), raw.slice(idx + 1).trim());
    }
  }
  return Array.from(cookieMap.entries()).map(([k, v]) => `${k}=${v}`).join("; ");
}

function checkAdminAuth(req) {
  const cookies = parseCookies(req);
  const token = req.headers["x-admin-token"] || cookies.ll_admin_session;
  if (token && adminSessions.has(token)) {
    return true;
  }
  const pin = req.headers["x-admin-pin"] || req.query.pin;
  if (pin && pin === ADMIN_PASSCODE) {
    return true;
  }
  return false;
}

function requireAdminAuth(req, res, next) {
  if (checkAdminAuth(req)) {
    return next();
  }
  return res.status(401).json({ error: "Access Denied: Master Authentication Required." });
}

function parseAmount(raw) {
  if (raw === null || raw === undefined) return 0;
  if (typeof raw === "number") return isFinite(raw) && raw > 0 ? raw : 0;
  const s = String(raw).trim().toLowerCase().replace(/,/g, "").replace(/₦/g, "").replace(/\s/g, "");
  if (!s) return 0;
  const m = s.match(/^(\d+(?:\.\d+)?)([kmbtq])?$/);
  if (m) {
    const val = parseFloat(m[1]);
    const unit = m[2];
    if (unit === "q") return Math.round(val * 1e15);
    if (unit === "t") return Math.round(val * 1e12);
    if (unit === "b") return Math.round(val * 1e9);
    if (unit === "m") return Math.round(val * 1e6);
    if (unit === "k") return Math.round(val * 1e3);
    return Math.round(val);
  }
  if (s.endsWith("q")) return Math.round(parseFloat(s) * 1e15) || 0;
  if (s.endsWith("t")) return Math.round(parseFloat(s) * 1e12) || 0;
  if (s.endsWith("b")) return Math.round(parseFloat(s) * 1e9) || 0;
  if (s.endsWith("m")) return Math.round(parseFloat(s) * 1e6) || 0;
  if (s.endsWith("k")) return Math.round(parseFloat(s) * 1e3) || 0;
  return Math.round(parseFloat(s)) || 0;
}

// Parse bulk recipient lines safely without corrupting usernames starting with digits or misparsing numbers
function parseBulkRecipientEntries(rawList, defaultAmountPerUser) {
  const fallbackAmt = parseAmount(defaultAmountPerUser) || MAX_TRANSFER_CHUNK;
  const lines = [];

  if (Array.isArray(rawList)) {
    for (const item of rawList) {
      if (item && typeof item === "object" && item.rawInput) {
        lines.push(item);
      } else if (item !== null && item !== undefined) {
        // Split by newline or comma ONLY when comma is not inside a formatted number like 50,000,000,000
        const sub = String(item).split(/\r?\n|,(?!\d{3})\s*/);
        for (const s of sub) {
          if (s && s.trim()) lines.push(s.trim());
        }
      }
    }
  } else if (typeof rawList === "string") {
    const sub = rawList.split(/\r?\n|,(?!\d{3})\s*/);
    for (const s of sub) {
      if (s && s.trim()) lines.push(s.trim());
    }
  }

  const queue = [];
  for (const entry of lines) {
    if (typeof entry === "object" && entry.rawInput) {
      const tAmt = Number(entry.targetAmount) || fallbackAmt;
      const rem = entry.remaining !== undefined ? Number(entry.remaining) : tAmt;
      queue.push({
        rawInput: String(entry.rawInput).trim(),
        targetAmount: tAmt,
        remaining: Math.max(0, rem),
        sent: Number(entry.sent) || 0,
        txCount: Number(entry.txCount) || 0,
        completed: Boolean(entry.completed || rem <= 0),
        resolvedId: entry.resolvedId || null,
        resolvedUsername: entry.resolvedUsername || null
      });
      continue;
    }

    // Strip only genuine list numbering ("1. ", "2) ") or bullet symbols ("- ", "• ") — never strip digits from usernames!
    let cleaned = String(entry)
      .trim()
      .replace(/^\s*(?:\d+[\.\)]\s+|[\-\*\•]+\s*)/, "")
      .replace(/^[\"\'\s]+|[\"\'\,\s]+$/g, "")
      .trim();

    if (!cleaned) continue;

    let targetUser = cleaned;
    let userTargetAmt = fallbackAmt;

    // Check if the line ends with an explicit custom amount: e.g. "@user 50b", "user: 200B", "user 50,000,000,000"
    // Only match if the trailing token has an explicit unit (k/m/b/t/q) OR is >= 1,000,000 (7+ digits or comma groups)
    const customMatch = cleaned.match(/^(.+?)[\s:=\-]+(₦?\s*\d[\d,]*(?:\.\d+)?\s*[kmbtqKMBTQ]|₦?\s*\d{1,3}(?:,\d{3}){2,}|₦?\s*\d{7,})$/);
    if (customMatch) {
      const candidateUser = customMatch[1].trim().replace(/[:=\-]+$/, "").trim();
      const candidateAmt = parseAmount(customMatch[2]);
      if (candidateUser && candidateAmt > 0) {
        targetUser = candidateUser;
        userTargetAmt = candidateAmt;
      }
    }

    targetUser = targetUser.replace(/^@/, "").trim();
    if (!targetUser) continue;

    queue.push({
      rawInput: targetUser,
      targetAmount: userTargetAmt,
      remaining: userTargetAmt,
      sent: 0,
      txCount: 0,
      completed: false,
      resolvedId: null,
      resolvedUsername: null
    });
  }

  return queue;
}

// -------------------------------------------------------------
// Core Known Usernames Map
// -------------------------------------------------------------
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
  "mr_ace": "6e3c4bdaac6f4765ba52",
  "_iamking_": "7b17dab5715d43c1b042",
  "iamking": "7b17dab5715d43c1b042",
  "annie05": "156cda27568c4876b9ec"
};

// Fast Offline Contacts Cache (26,000+ players loaded from disk)
const CONTACTS_MAP = new Map();
(async () => {
  try {
    const contactsPath = path.join(__dirname, "mega_contacts_list.json");
    if (await fs.stat(contactsPath).catch(() => null)) {
      const raw = await fs.readFile(contactsPath, "utf8");
      const list = JSON.parse(raw);
      for (const item of list) {
        if (item.username && item.id) {
          const u = String(item.username).toLowerCase().replace(/^@/, "").trim();
          CONTACTS_MAP.set(u, { id: item.id, username: item.username.replace(/^@/, ""), name: item.name });
        }
      }
      console.log(`⚡ Cached ${CONTACTS_MAP.size} offline contacts for instant 0ms username resolution.`);
    }
  } catch (err) {
    console.error("Error loading mega contacts into cache:", err.message);
  }
})();

async function resolveTargetIdAsync(input, cookie) {
  if (!input) return null;
  // Strip numbered list prefixes like "1. " or "2) " and surrounding quotes/spaces without eating usernames or hex IDs
  let trimmed = String(input)
    .trim()
    .replace(/^\s*\d+[\.\)]\s+/, "")
    .replace(/^[\-\*\•\)\(\]\"\'\s]+/, "")
    .replace(/[\"\'\,\s]+$/g, "")
    .trim();

  // 1. Check if URL with ?with=... or ?host=... or ?of=...
  const urlMatch = trimmed.match(/[?&](?:with|host|of)=([a-f0-9]{16,})/i);
  if (urlMatch) return { id: urlMatch[1], username: urlMatch[1] };

  // 2. Check if player profile URL
  const profileMatch = trimmed.match(/lagoslife\.app\/.*?([a-f0-9]{16,})/i);
  if (profileMatch) return { id: profileMatch[1], username: profileMatch[1] };

  // 3. Check if exact 20-character hex ID (with or without leading @)
  const hexCandidate = trimmed.replace(/^@/, "");
  if (/^[a-f0-9]{20}$/i.test(hexCandidate)) {
    return { id: hexCandidate.toLowerCase(), username: hexCandidate.toLowerCase() };
  }

  // 4. Check known static map
  const clean = hexCandidate.toLowerCase();
  if (USERNAME_MAP[clean]) {
    return { id: USERNAME_MAP[clean], username: clean };
  }

  // 5. Check offline contacts cache (instant, no rate limits)
  if (CONTACTS_MAP.has(clean)) {
    const c = CONTACTS_MAP.get(clean);
    return { id: c.id, username: c.username, name: c.name };
  }

  // 6. Query LagosLife APIs live to resolve username (require exact username match so typos never pay the wrong player)
  const searchTerms = [clean];
  const strippedUnderscore = clean.replace(/^_+|_+$/g, "");
  if (strippedUnderscore && strippedUnderscore !== clean) {
    searchTerms.push(strippedUnderscore);
  }

  const reqHeaders = {
    "accept": "application/json",
    "cookie": cookie || "",
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36"
  };

  for (const term of searchTerms) {
    try {
      const res = await fetch(`https://lagoslife.app/api/players?q=${encodeURIComponent(term)}`, { headers: reqHeaders });
      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        const players = data.players || [];
        const exact = players.find(p => {
          const u = (p.username || "").toLowerCase();
          return u === clean || u === term;
        });
        if (exact && exact.id) {
          CONTACTS_MAP.set(clean, { id: exact.id, username: exact.username, name: exact.name });
          return { id: exact.id, username: exact.username, name: exact.name, avatar: exact.look };
        }
      }
    } catch (err) {
      console.error("Resolve /api/players error:", err.message);
    }

    try {
      const resBills = await fetch(`https://lagoslife.app/api/bills?people=1&q=${encodeURIComponent(term)}`, { headers: reqHeaders });
      if (resBills.ok) {
        const bData = await resBills.json().catch(() => ({}));
        const people = bData.people || bData.players || bData.users || [];
        const exact = people.find(p => {
          const u = (p.username || "").toLowerCase();
          return u === clean || u === term;
        });
        if (exact && exact.id) {
          CONTACTS_MAP.set(clean, { id: exact.id, username: exact.username, name: exact.name });
          return { id: exact.id, username: exact.username, name: exact.name, avatar: exact.look };
        }
      }
    } catch {}
  }

  // 7. Check active parties list (/api/parties) and current save state (/api/save)
  try {
    const pRes = await fetch("https://lagoslife.app/api/parties", { headers: reqHeaders });
    if (pRes.ok) {
      const pData = await pRes.json().catch(() => ({}));
      const parties = Array.isArray(pData.parties) ? pData.parties : [];
      const found = parties.find(
        p => (p.username || "").toLowerCase() === clean || (p.host || "").toLowerCase() === clean || (p.id || "").toLowerCase() === clean
      );
      if (found && (found.host || found.id)) {
        const hid = found.host || found.id;
        const huser = found.username || clean;
        CONTACTS_MAP.set(clean, { id: hid, username: huser, name: found.name });
        return { id: hid, username: huser, name: found.name };
      }
    }
  } catch {}

  try {
    const sRes = await fetch("https://lagoslife.app/api/save", { headers: reqHeaders });
    if (sRes.ok) {
      const sData = await sRes.json().catch(() => ({}));
      const pool = [
        ...(Array.isArray(sData.players) ? sData.players : []),
        ...(Array.isArray(sData.guests) ? sData.guests : []),
        ...(sData.me ? [sData.me] : [])
      ];
      const found = pool.find(p => (p.username || "").toLowerCase() === clean || (p.id || "").toLowerCase() === clean);
      if (found && found.id) {
        CONTACTS_MAP.set(clean, { id: found.id, username: found.username || clean, name: found.name });
        return { id: found.id, username: found.username || clean, name: found.name };
      }
    }
  } catch {}

  return null;
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

async function sendMoney(cookie, to, amount, key, twoStepCode, pin) {
  try {
    const body = { to, amount };
    const effectivePin = pin || twoStepCode;
    if (effectivePin && String(effectivePin).trim()) {
      body.pin = String(effectivePin).trim();
    }
    if (twoStepCode && String(twoStepCode).trim() && twoStepCode !== pin) {
      const codeStr = String(twoStepCode).trim();
      body.code = codeStr;
      body.twoStep = codeStr;
    }
    const headers = {
      "accept": "application/json",
      "content-type": "application/json",
      "origin": "https://lagoslife.app",
      "referer": "https://lagoslife.app/",
      "cookie": cookie,
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36"
    };
    headers["idempotency-key"] = key || crypto.randomUUID();
    const res = await fetch("https://lagoslife.app/api/send", {
      method: "POST",
      headers,
      body: JSON.stringify(body)
    });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data };
  } catch (err) {
    return { status: 0, error: err.message };
  }
}

// -------------------------------------------------------------
// Ledger & Audit Log Recording
// -------------------------------------------------------------
async function recordLedgerEntry(entry) {
  try {
    const ledger = await readJson(LEDGER_FILE, []);
    const idx = ledger.findIndex(x => x.id === entry.id);
    if (idx >= 0) {
      ledger[idx] = { ...ledger[idx], ...entry };
    } else {
      ledger.unshift({
        id: entry.id || `rec_${Date.now()}_${Math.random().toString(36).slice(7)}`,
        timestamp: entry.timestamp || Date.now(),
        timeStr: new Date(entry.timestamp || Date.now()).toLocaleString("en-GB", {
          day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true
        }),
        ...entry
      });
    }
    await writeJson(LEDGER_FILE, ledger);
  } catch (err) {
    console.error("Ledger write error:", err.message);
  }
}

// -------------------------------------------------------------
// Admin Authentication Routes
// -------------------------------------------------------------

// Admin Login
app.post("/api/admin/login", (req, res) => {
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  const now = Date.now();
  const attempt = loginAttempts.get(ip) || { count: 0, lockedUntil: 0 };

  if (attempt.lockedUntil > now) {
    const waitSec = Math.ceil((attempt.lockedUntil - now) / 1000);
    return res.status(429).json({ error: `Too many failed attempts. Try again in ${waitSec}s.` });
  }

  const { passcode } = req.body;
  if (!passcode || passcode !== ADMIN_PASSCODE) {
    attempt.count++;
    if (attempt.count >= 5) {
      attempt.lockedUntil = now + 15 * 60 * 1000; // 15 min lockout
    }
    loginAttempts.set(ip, attempt);
    return res.status(401).json({ error: "Invalid master security code." });
  }

  // Clear failed attempts on success
  loginAttempts.delete(ip);

  // Generate cryptographic session token
  const token = "adm_" + crypto.randomBytes(32).toString("hex");
  adminSessions.set(token, { createdAt: now, ip });

  // Set secure HTTP-only cookie
  res.setHeader("Set-Cookie", `ll_admin_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${7 * 24 * 3600}`);
  res.json({ success: true, token });
});

// Admin Logout
app.post("/api/admin/logout", (req, res) => {
  const cookies = parseCookies(req);
  const token = req.headers["x-admin-token"] || cookies.ll_admin_session;
  if (token) adminSessions.delete(token);

  res.setHeader("Set-Cookie", "ll_admin_session=; Path=/; HttpOnly; Max-Age=0");
  res.json({ success: true, message: "Logged out successfully" });
});

// -------------------------------------------------------------
// Admin Dashboard & Protected View Serving
// -------------------------------------------------------------

// Master Admin View
app.get(["/admin", "/master", "/vault"], (req, res) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  if (checkAdminAuth(req)) {
    return res.sendFile(path.join(PRIVATE_ADMIN_DIR, "admin.html"));
  }
  return res.sendFile(path.join(PRIVATE_ADMIN_DIR, "login.html"));
});

// Dedicated Login Page
app.get("/login", (req, res) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  if (checkAdminAuth(req)) {
    return res.redirect("/admin");
  }
  return res.sendFile(path.join(PRIVATE_ADMIN_DIR, "login.html"));
});

// Protected Admin Static Assets
app.get("/admin-assets/style.css", (req, res) => {
  if (checkAdminAuth(req)) {
    res.setHeader("Content-Type", "text/css");
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    return res.sendFile(path.join(PRIVATE_ADMIN_DIR, "style.css"));
  }
  res.status(403).send("Forbidden");
});

app.get("/admin-assets/app.js", (req, res) => {
  if (checkAdminAuth(req)) {
    res.setHeader("Content-Type", "application/javascript");
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    return res.sendFile(path.join(PRIVATE_ADMIN_DIR, "app.js"));
  }
  res.status(403).send("Forbidden");
});

// -------------------------------------------------------------
// Admin Data & Control APIs (All Require Authentication)
// -------------------------------------------------------------

// Accounts Overview (Sanitized - Never leaks raw cookies!)
app.get("/api/accounts", requireAdminAuth, async (req, res) => {
  const accounts = await readJson(ACCOUNTS_FILE, []);
  const now = Date.now();
  const enriched = new Array(accounts.length);

  // Identify accounts needing fresh data
  const toFetch = [];
  for (let i = 0; i < accounts.length; i++) {
    const acc = accounts[i];
    let cached = cachedBalances.get(acc.id);
    if (!cached || now - cached.timestamp > 30000) {
      toFetch.push({ idx: i, acc });
    } else {
      enriched[i] = {
        id: acc.id,
        name: acc.name,
        user: acc.user,
        uid: acc.uid,
        money: cached.money,
        status: cached.status
      };
    }
  }

  // Concurrently fetch stale accounts in pools of 15
  if (toFetch.length > 0) {
    const CONCURRENCY = 15;
    let ptr = 0;
    async function worker() {
      while (ptr < toFetch.length) {
        const item = toFetch[ptr++];
        const live = await fetchAccountData(item.acc.cookie);
        const cached = {
          money: live.ok ? live.money : (cachedBalances.get(item.acc.id)?.money || 0),
          status: live.ok ? "ACTIVE" : (live.status === 401 ? "EXPIRED" : "ERROR"),
          timestamp: Date.now()
        };
        cachedBalances.set(item.acc.id, cached);
        enriched[item.idx] = {
          id: item.acc.id,
          name: item.acc.name,
          user: item.acc.user,
          uid: item.acc.uid,
          money: cached.money,
          status: cached.status
        };
      }
    }
    const workers = Array.from({ length: Math.min(CONCURRENCY, toFetch.length) }, () => worker());
    await Promise.all(workers);
  }

  res.json(enriched);
});

// Update Cookie for Account
app.post("/api/accounts/update-cookie", requireAdminAuth, async (req, res) => {
  const { accountId, cookie } = req.body;
  if (!accountId || !cookie) return res.status(400).json({ error: "accountId and cookie required" });

  const accounts = await readJson(ACCOUNTS_FILE, []);
  const idx = accounts.findIndex(a => a.id === accountId);
  if (idx === -1) return res.status(404).json({ error: "Account not found" });

  accounts[idx].cookie = cookie.trim();
  await writeJson(ACCOUNTS_FILE, accounts);
  cachedBalances.delete(accountId);

  res.json({ success: true, message: "Session cookie updated" });
});

// Resolve Recipient (Autocomplete)
app.get("/api/resolve-recipient", requireAdminAuth, async (req, res) => {
  const query = (req.query.q || "").trim();
  if (!query) return res.status(400).json({ error: "Query required" });

  const accounts = await readJson(ACCOUNTS_FILE, []);
  const activeAcc = accounts.find(a => a.cookie) || accounts[0];

  const resolved = await resolveTargetIdAsync(query, activeAcc?.cookie);
  if (!resolved) {
    return res.status(404).json({ error: `Could not find player '${query}'.` });
  }

  return res.json(resolved);
});

// Active Transfers (Running, Paused, or Scheduled)
app.get("/api/transfers/active", requireAdminAuth, async (req, res) => {
  const jobs = await readJson(JOBS_FILE, []);
  const serverActive = jobs.filter(j => j.status === "RUNNING" || j.status === "PAUSED" || j.status === "SCHEDULED");
  res.json(serverActive);
});

// Transfer History
app.get("/api/transfers/history", requireAdminAuth, async (req, res) => {
  const jobs = await readJson(JOBS_FILE, []);
  const serverHist = jobs.filter(j => j.status !== "RUNNING" && j.status !== "PAUSED" && j.status !== "SCHEDULED");
  res.json(serverHist.slice(0, 30));
});

// Helper: Revive worker loop if server rebooted while job was PAUSED or RUNNING, or when a SCHEDULED job triggers
function reviveJobWorker(job) {
  if (activeJobs.has(job.id)) return;
  const workerState = { cancelled: false, paused: false };
  activeJobs.set(job.id, workerState);

  (async () => {
    try {
      const accounts = await readJson(ACCOUNTS_FILE, []);
      const acc = accounts.find(a => a.id === job.accountId) || accounts.find(a => a.name === job.sender);
      if (!acc || !acc.cookie) {
        job.status = "FAILED";
        job.logs = job.logs || [];
        job.logs.push(`[${new Date().toLocaleTimeString()}] ❌ Failed to execute: Sender account session unavailable.`);
        const jobs = await readJson(JOBS_FILE, []);
        const idx = jobs.findIndex(x => x.id === job.id);
        if (idx !== -1) jobs[idx] = job;
        await writeJson(JOBS_FILE, jobs);
        activeJobs.delete(job.id);
        return;
      }

      const jobs = await readJson(JOBS_FILE, []);
      const currentJob = jobs.find(x => x.id === job.id) || job;

      // Handle Batch Transfers
      if (currentJob.type === "BATCH" && (Array.isArray(currentJob.recipientQueue) || Array.isArray(currentJob.recipients))) {
        const defaultAmt = parseAmount(currentJob.amountPerUser || currentJob.chunkSize) || MAX_TRANSFER_CHUNK;
        if (!Array.isArray(currentJob.recipientQueue) || currentJob.recipientQueue.length === 0) {
          currentJob.recipientQueue = parseBulkRecipientEntries(currentJob.recipients || [], defaultAmt);
        }
        const queue = currentJob.recipientQueue;
        const maxChunk = MAX_TRANSFER_CHUNK;
        const delayMs = 400;
        let totalTxCount = currentJob.txCount || 0;

        for (let i = 0; i < queue.length; i++) {
          const entry = queue[i];
          if (!entry || entry.completed || entry.remaining <= 0) continue;

          while (workerState.paused && !workerState.cancelled) {
            await sleep(1000);
          }
          if (workerState.cancelled) break;

          let resolved = entry.resolvedId ? { id: entry.resolvedId, username: entry.resolvedUsername || entry.rawInput } : null;
          if (!resolved) {
            resolved = await resolveTargetIdAsync(entry.rawInput, acc.cookie);
            if (!resolved || !resolved.id) {
              entry.completed = true;
              entry.remaining = 0;
              currentJob.logs.push(`⚠️ Skipped unknown player: ${entry.rawInput}`);
              await writeJson(JOBS_FILE, jobs);
              continue;
            }
            entry.resolvedId = resolved.id;
            entry.resolvedUsername = resolved.username;
          }

          const userTotalChunks = Math.ceil(entry.targetAmount / maxChunk);

          while (entry.remaining > 0 && !workerState.cancelled) {
            while (workerState.paused && !workerState.cancelled) {
              await sleep(1000);
            }
            if (workerState.cancelled) break;

            const sendAmt = Math.min(maxChunk, entry.remaining);
            let sendSuccess = false;
            let attempts = 0;

            while (!sendSuccess && attempts < 4 && !workerState.cancelled) {
              attempts++;
              const r = await sendMoney(acc.cookie, resolved.id, sendAmt, null, null, acc.pin);

              if (r.status === 200) {
                sendSuccess = true;
                entry.remaining = Math.max(0, entry.remaining - sendAmt);
                entry.sent = (entry.sent || 0) + sendAmt;
                entry.txCount = (entry.txCount || 0) + 1;
                if (entry.remaining <= 0) entry.completed = true;

                currentJob.remaining = queue.reduce((sum, item) => sum + (item.completed ? 0 : Math.max(0, item.remaining || 0)), 0);
                totalTxCount++;
                currentJob.txCount = totalTxCount;

                const chunkLabel = userTotalChunks > 1 ? ` (chunk ${entry.txCount}/${userTotalChunks})` : "";
                currentJob.logs.push(`[${new Date().toLocaleTimeString()}] [${i + 1}/${queue.length}] Sent ₦${sendAmt.toLocaleString()} to @${resolved.username}${chunkLabel} ✅`);
                await writeJson(JOBS_FILE, jobs);
                await recordLedgerEntry({ id: job.id, chunksCompleted: totalTxCount });

                if (entry.remaining > 0 || i < queue.length - 1) {
                  await waitInterval(delayMs, workerState);
                }
              } else if (r.status === 429) {
                currentJob.logs.push(`[${new Date().toLocaleTimeString()}] ⏳ Rate limit (429) on @${resolved.username}. Rapid re-check in 2.5s...`);
                await writeJson(JOBS_FILE, jobs);
                await sleep(2500);
              } else {
                const errMsg = r.data?.error || r.data?.message || JSON.stringify(r.data || r.error || `HTTP ${r.status}`);
                currentJob.logs.push(`[${new Date().toLocaleTimeString()}] ❌ Error sending to @${resolved.username}: ${errMsg}`);
                await writeJson(JOBS_FILE, jobs);

                if (r.status === 400 && (String(errMsg).toLowerCase().includes("need") || String(errMsg).toLowerCase().includes("money") || String(errMsg).toLowerCase().includes("balance"))) {
                  currentJob.logs.push(`[${new Date().toLocaleTimeString()}] 🛑 Insufficient treasury balance. Pipeline stopped.`);
                  currentJob.status = "FAILED";
                  await writeJson(JOBS_FILE, jobs);
                  await recordLedgerEntry({ id: job.id, status: "FAILED", notes: `Failed: ${errMsg}` });
                  return;
                }
                await sleep(6000);
                break;
              }
            }

            if (!sendSuccess) {
              currentJob.logs.push(`⚠️ Skipping remaining chunks for @${resolved.username} due to transfer errors.`);
              await writeJson(JOBS_FILE, jobs);
              break;
            }
          }
        }

        if (currentJob.status === "RUNNING") {
          currentJob.status = workerState.cancelled ? "CANCELLED" : "COMPLETED";
        }
        await recordLedgerEntry({
          id: job.id,
          status: currentJob.status === "COMPLETED" ? "COMPLETED" : "STOPPED",
          chunksCompleted: totalTxCount
        });
        await writeJson(JOBS_FILE, jobs);
        activeJobs.delete(job.id);
        return;
      }

      // Handle Single and Split Transfers
      const delayMs = 400;
      const chunkSize = Math.min(Number(currentJob.chunkSize) || MAX_TRANSFER_CHUNK, MAX_TRANSFER_CHUNK);
      let remaining = Number(currentJob.remaining);
      let count = Number(currentJob.txCount) || 0;
      const totalTxs = currentJob.totalTxs || Math.ceil(currentJob.total / chunkSize);
      const resolvedTo = currentJob.target;

      while (remaining > 0 && !workerState.cancelled) {
        while (workerState.paused && !workerState.cancelled) {
          await sleep(1000);
        }
        if (workerState.cancelled) break;

        const sendAmount = Math.min(chunkSize, remaining);
        count++;
        const r = await sendMoney(acc.cookie, resolvedTo, sendAmount, null, null, acc.pin);

        if (r.status === 200) {
          remaining -= sendAmount;
          currentJob.remaining = remaining;
          currentJob.txCount = count;
          currentJob.logs.push(`[${new Date().toLocaleTimeString()}] [${count}/${totalTxs}] Sent ₦${sendAmount.toLocaleString()} ✅`);
          await writeJson(JOBS_FILE, jobs);
          await recordLedgerEntry({ id: job.id, chunksCompleted: count });

          if (remaining > 0 && !workerState.cancelled) {
            await waitInterval(delayMs, workerState);
          }
        } else if (r.status === 429) {
          currentJob.logs.push(`[${new Date().toLocaleTimeString()}] ⏳ Rate limit (429) hit. Rapid re-check in 2.5s...`);
          await writeJson(JOBS_FILE, jobs);
          await sleep(2500);
        } else {
          const errMsg = r.data?.error || JSON.stringify(r.data || r.error);
          currentJob.logs.push(`[${new Date().toLocaleTimeString()}] Error ${r.status}: ${errMsg}`);
          if (r.status === 404 || (r.status === 400 && String(errMsg).includes("need"))) {
            currentJob.status = "FAILED";
            await writeJson(JOBS_FILE, jobs);
            await recordLedgerEntry({ id: job.id, status: "FAILED", notes: `Failed: ${errMsg}` });
            activeJobs.delete(job.id);
            return;
          }
          await writeJson(JOBS_FILE, jobs);
          await sleep(5000);
        }
      }

      if (!workerState.cancelled && currentJob.status === "RUNNING") {
        currentJob.status = "COMPLETED";
        currentJob.logs.push(`[${new Date().toLocaleTimeString()}] 🎉 Finished delivering ₦${Number(currentJob.total).toLocaleString()}!`);
        await recordLedgerEntry({ id: job.id, status: "COMPLETED", chunksCompleted: count });
      } else if (workerState.cancelled) {
        currentJob.status = "CANCELLED";
        await recordLedgerEntry({ id: job.id, status: "STOPPED", chunksCompleted: count });
      }
      await writeJson(JOBS_FILE, jobs);
      activeJobs.delete(job.id);
    } catch (err) {
      console.error("Worker error for job:", job.id, err);
      activeJobs.delete(job.id);
    }
  })();
}

// Background Scheduler: Checks and triggers queued jobs when their appointed time arrives
async function checkScheduledQueue() {
  try {
    const jobs = await readJson(JOBS_FILE, []);
    const now = Date.now();
    let updated = false;

    for (const job of jobs) {
      if (job.status === "SCHEDULED" && job.scheduledTimestamp && job.scheduledTimestamp <= now) {
        job.status = "RUNNING";
        job.logs = job.logs || [];
        job.logs.push(`[${new Date().toLocaleTimeString()}] ⏰ Scheduled time reached (${new Date(job.scheduledTimestamp).toLocaleTimeString()}). Commencing pipeline!`);
        await recordLedgerEntry({ id: job.id, status: "RUNNING", notes: "Scheduled transfer triggered automatically" });
        reviveJobWorker(job);
        updated = true;
      }
    }

    if (updated) {
      await writeJson(JOBS_FILE, jobs);
    }

    // Also check active client sessions for scheduled transfers
    for (const session of clientSessions.values()) {
      if (!session || !Array.isArray(session.jobs)) continue;
      for (const cJob of session.jobs) {
        if (cJob.status === "SCHEDULED" && cJob.scheduledTimestamp && cJob.scheduledTimestamp <= now) {
          cJob.status = "RUNNING";
          cJob.logs = cJob.logs || [];
          cJob.logs.push(`[${new Date().toLocaleTimeString()}] ⏰ Scheduled time reached (${new Date(cJob.scheduledTimestamp).toLocaleTimeString()}). Commencing transfer!`);
          runClientWorker(cJob, session);
        }
      }
    }
  } catch (err) {
    console.error("Scheduled queue check error:", err.message);
  }
}

// Start recurring scheduler tick every 5 seconds
setInterval(checkScheduledQueue, 5000);
checkScheduledQueue();

// Start Scheduled Job Immediately Ahead of Time
app.post("/api/transfers/start-now", requireAdminAuth, async (req, res) => {
  const { jobId } = req.body;
  if (!jobId) return res.status(400).json({ error: "jobId required" });

  const jobs = await readJson(JOBS_FILE, []);
  const j = jobs.find(x => x.id === jobId);
  if (!j) return res.status(404).json({ error: "Job not found" });

  if (j.status !== "SCHEDULED") {
    return res.status(400).json({ error: `Job is currently ${j.status}, not SCHEDULED.` });
  }

  j.status = "RUNNING";
  j.logs = j.logs || [];
  j.logs.push(`[${new Date().toLocaleTimeString()}] ⚡ Manually triggered by administrator ahead of schedule.`);
  await writeJson(JOBS_FILE, jobs);
  await recordLedgerEntry({ id: jobId, status: "RUNNING", notes: "Manually triggered early" });

  reviveJobWorker(j);
  res.json({ success: true, message: "Job launched immediately", job: j });
});

// Reschedule Existing Job
app.post("/api/transfers/reschedule", requireAdminAuth, async (req, res) => {
  const { jobId, scheduledAt } = req.body;
  if (!jobId || !scheduledAt) return res.status(400).json({ error: "jobId and scheduledAt required" });

  const targetTs = new Date(scheduledAt).getTime();
  if (isNaN(targetTs) || targetTs <= Date.now()) {
    return res.status(400).json({ error: "Scheduled time must be in the future." });
  }

  const jobs = await readJson(JOBS_FILE, []);
  const j = jobs.find(x => x.id === jobId);
  if (!j) return res.status(404).json({ error: "Job not found" });

  j.status = "SCHEDULED";
  j.scheduledAt = new Date(targetTs).toISOString();
  j.scheduledTimestamp = targetTs;
  j.logs = j.logs || [];
  j.logs.push(`[${new Date().toLocaleTimeString()}] ⏰ Rescheduled for ${new Date(targetTs).toLocaleString()}.`);
  await writeJson(JOBS_FILE, jobs);
  await recordLedgerEntry({ id: jobId, status: "SCHEDULED", notes: `Rescheduled for ${new Date(targetTs).toLocaleString()}` });

  res.json({ success: true, message: "Job rescheduled", job: j });
});

// Pause Transfer
app.post("/api/transfers/pause", requireAdminAuth, async (req, res) => {
  const { jobId } = req.body;
  if (!jobId) return res.status(400).json({ error: "jobId required" });

  const jobs = await readJson(JOBS_FILE, []);
  const j = jobs.find(x => x.id === jobId);
  if (!j) return res.status(404).json({ error: "Job not found" });

  if (j.status !== "RUNNING") {
    return res.status(400).json({ error: `Job is currently ${j.status}, cannot pause.` });
  }

  j.status = "PAUSED";
  j.logs = j.logs || [];
  j.logs.push(`[${new Date().toLocaleTimeString()}] ⏸️ Transfer pipeline paused by administrator.`);
  await writeJson(JOBS_FILE, jobs);
  await recordLedgerEntry({ id: jobId, status: "PAUSED" });

  if (activeJobs.has(jobId)) {
    activeJobs.get(jobId).paused = true;
  }

  res.json({ success: true, message: "Job paused", job: j });
});

// Resume Transfer
app.post("/api/transfers/resume", requireAdminAuth, async (req, res) => {
  const { jobId } = req.body;
  if (!jobId) return res.status(400).json({ error: "jobId required" });

  const jobs = await readJson(JOBS_FILE, []);
  const j = jobs.find(x => x.id === jobId);
  if (!j) return res.status(404).json({ error: "Job not found" });

  if (j.status !== "PAUSED") {
    return res.status(400).json({ error: `Job is currently ${j.status}, cannot resume.` });
  }

  j.status = "RUNNING";
  j.logs = j.logs || [];
  j.logs.push(`[${new Date().toLocaleTimeString()}] ▶️ Transfer pipeline resumed.`);
  await writeJson(JOBS_FILE, jobs);
  await recordLedgerEntry({ id: jobId, status: "RUNNING" });

  if (activeJobs.has(jobId)) {
    activeJobs.get(jobId).paused = false;
  } else {
    // If worker process was cleared from memory, revive it!
    reviveJobWorker(j);
  }

  res.json({ success: true, message: "Job resumed", job: j });
});

// Stop / Cancel Transfer
app.post("/api/transfers/stop", requireAdminAuth, async (req, res) => {
  const { jobId } = req.body;
  if (!jobId) return res.status(400).json({ error: "jobId required" });

  if (activeJobs.has(jobId)) {
    activeJobs.get(jobId).cancelled = true;
    activeJobs.delete(jobId);
  }

  const jobs = await readJson(JOBS_FILE, []);
  const j = jobs.find(x => x.id === jobId);
  if (j) {
    j.status = "CANCELLED";
    j.logs = j.logs || [];
    j.logs.push(`[${new Date().toLocaleTimeString()}] ⏹️ Transfer cancelled by administrator.`);
    await writeJson(JOBS_FILE, jobs);
    await recordLedgerEntry({ id: jobId, status: "STOPPED" });
    return res.json({ success: true, message: "Job cancelled" });
  }
  res.status(404).json({ error: "Job not found" });
});

// Single Transfer Execution
app.post("/api/transfers/send", requireAdminAuth, async (req, res) => {
  const { accountId, to, amount, scheduledAt } = req.body;
  const accounts = await readJson(ACCOUNTS_FILE, []);
  const acc = accounts.find(a => a.id === accountId);
  if (!acc) return res.status(404).json({ error: "Sender account not found" });

  const resolved = await resolveTargetIdAsync(to, acc.cookie);
  if (!resolved || !resolved.id) {
    return res.status(400).json({ error: `Player '${to}' could not be found.` });
  }

  const resolvedTo = resolved.id;
  const targetLabel = resolved.name ? `${resolved.name} (@${resolved.username})` : `@${resolved.username || resolvedTo}`;
  const totalNum = parseAmount(amount);
  if (!totalNum || totalNum <= 0) return res.status(400).json({ error: "Valid amount required" });
  const chunkSize = Math.min(totalNum, MAX_TRANSFER_CHUNK);
  const delayMs = 400;
  const jobId = `tx_${Date.now()}_${Math.random().toString(36).slice(7)}`;
  const totalTxs = Math.ceil(totalNum / chunkSize);

  const scheduledTs = scheduledAt ? new Date(scheduledAt).getTime() : null;
  const isScheduled = Boolean(scheduledTs && !isNaN(scheduledTs) && scheduledTs > Date.now());
  const initialStatus = isScheduled ? "SCHEDULED" : "RUNNING";
  const initialLog = isScheduled
    ? `[${new Date().toLocaleTimeString()}] ⏰ Transfer scheduled for ${new Date(scheduledTs).toLocaleString()} (₦${totalNum.toLocaleString()} to ${targetLabel})`
    : `[${new Date().toLocaleTimeString()}] Transfer initialized: ₦${totalNum.toLocaleString()} to ${targetLabel}`;

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
    status: initialStatus,
    startTime: new Date().toISOString(),
    scheduledAt: isScheduled ? new Date(scheduledTs).toISOString() : null,
    scheduledTimestamp: isScheduled ? scheduledTs : null,
    logs: [initialLog]
  };

  const jobs = await readJson(JOBS_FILE, []);
  jobs.unshift(job);
  await writeJson(JOBS_FILE, jobs);

  // Initial ledger entry
  await recordLedgerEntry({
    id: jobId,
    timestamp: Date.now(),
    sender: acc.name,
    recipient: targetLabel,
    targetId: resolvedTo,
    amount: totalNum,
    chunkSize,
    chunksCompleted: 0,
    totalChunks: totalTxs,
    status: initialStatus,
    notes: isScheduled ? `Scheduled for ${new Date(scheduledTs).toLocaleString()}` : `Initiated transfer of ₦${totalNum.toLocaleString()}`
  });

  if (isScheduled) {
    return res.json({ success: true, scheduled: true, job });
  }

  const workerState = { cancelled: false, paused: false };
  activeJobs.set(jobId, workerState);

  // Background worker
  (async () => {
    let remaining = totalNum;
    let count = 0;

    while (remaining > 0 && !workerState.cancelled) {
      while (workerState.paused && !workerState.cancelled) {
        await sleep(1000);
      }
      if (workerState.cancelled) break;

      const sendAmount = Math.min(chunkSize, remaining);
      count++;
      const r = await sendMoney(acc.cookie, resolvedTo, sendAmount, null, null, acc.pin);

      if (r.status === 200) {
        remaining -= sendAmount;
        job.remaining = remaining;
        job.txCount = count;
        job.logs.push(`[${new Date().toLocaleTimeString()}] [${count}/${totalTxs}] Sent ₦${sendAmount.toLocaleString()} ✅`);
        await writeJson(JOBS_FILE, jobs);
        await recordLedgerEntry({ id: jobId, chunksCompleted: count });

        if (remaining > 0 && !workerState.cancelled) {
          await waitInterval(delayMs, workerState);
        }
      } else if (r.status === 429) {
        job.logs.push(`[${new Date().toLocaleTimeString()}] ⏳ Rate limit (429) hit. Rapid re-check in 2.5s...`);
        await writeJson(JOBS_FILE, jobs);
        await sleep(2500);
      } else {
        const errMsg = r.data?.error || JSON.stringify(r.data || r.error);
        job.logs.push(`[${new Date().toLocaleTimeString()}] Error ${r.status}: ${errMsg}`);
        if (r.status === 404 || (r.status === 400 && String(errMsg).includes("need"))) {
          job.status = "FAILED";
          await writeJson(JOBS_FILE, jobs);
          await recordLedgerEntry({ id: jobId, status: "FAILED", notes: `Failed: ${errMsg}` });
          activeJobs.delete(jobId);
          return;
        }
        await writeJson(JOBS_FILE, jobs);
        await sleep(5000);
      }
    }

    if (!workerState.cancelled && job.status === "RUNNING") {
      job.status = "COMPLETED";
      job.logs.push(`[${new Date().toLocaleTimeString()}] 🎉 Finished delivering ₦${totalNum.toLocaleString()} to ${targetLabel}!`);
      await recordLedgerEntry({ id: jobId, status: "COMPLETED", chunksCompleted: count });
    } else if (workerState.cancelled) {
      job.status = "CANCELLED";
      await recordLedgerEntry({ id: jobId, status: "STOPPED", chunksCompleted: count });
    }
    await writeJson(JOBS_FILE, jobs);
    activeJobs.delete(jobId);
  })();

  res.json({ success: true, job });
});

// Multi-Account Split Transfer
app.post("/api/transfers/split", requireAdminAuth, async (req, res) => {
  const { to, plans, scheduledAt } = req.body;
  if (!to || !Array.isArray(plans) || plans.length === 0) {
    return res.status(400).json({ error: "Recipient and split plans required" });
  }

  const accounts = await readJson(ACCOUNTS_FILE, []);
  const activeAcc = accounts.find(a => a.cookie) || accounts[0];

  const resolved = await resolveTargetIdAsync(to, activeAcc?.cookie);
  if (!resolved || !resolved.id) {
    return res.status(400).json({ error: `Player '${to}' could not be found.` });
  }

  const resolvedTo = resolved.id;
  const targetLabel = resolved.name ? `${resolved.name} (@${resolved.username})` : `@${resolved.username || resolvedTo}`;
  const createdJobs = [];
  const jobs = await readJson(JOBS_FILE, []);

  const scheduledTs = scheduledAt ? new Date(scheduledAt).getTime() : null;
  const isScheduled = Boolean(scheduledTs && !isNaN(scheduledTs) && scheduledTs > Date.now());
  const initialStatus = isScheduled ? "SCHEDULED" : "RUNNING";

  for (const plan of plans) {
    const acc = accounts.find(a => a.id === plan.accountId);
    if (!acc || plan.amount <= 0) continue;

    const totalNum = parseAmount(plan.amount);
    if (!totalNum || totalNum <= 0) continue;
    const chunkSize = Math.min(totalNum, MAX_TRANSFER_CHUNK);
    const delayMs = 400;
    const jobId = `split_${Date.now()}_${acc.user}_${Math.random().toString(36).slice(7)}`;
    const totalTxs = Math.ceil(totalNum / chunkSize);

    const initialLog = isScheduled
      ? `[${new Date().toLocaleTimeString()}] ⏰ Split leg scheduled for ${new Date(scheduledTs).toLocaleString()}: ${acc.name} -> ${targetLabel} (₦${totalNum.toLocaleString()})`
      : `[${new Date().toLocaleTimeString()}] Split leg started: ${acc.name} -> ${targetLabel} (₦${totalNum.toLocaleString()})`;

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
      status: initialStatus,
      startTime: new Date().toISOString(),
      scheduledAt: isScheduled ? new Date(scheduledTs).toISOString() : null,
      scheduledTimestamp: isScheduled ? scheduledTs : null,
      logs: [initialLog]
    };

    createdJobs.push(job);
    jobs.unshift(job);

    await recordLedgerEntry({
      id: jobId,
      timestamp: Date.now(),
      sender: acc.name,
      recipient: targetLabel,
      targetId: resolvedTo,
      amount: totalNum,
      chunkSize,
      chunksCompleted: 0,
      totalChunks: totalTxs,
      status: initialStatus,
      notes: isScheduled ? `Scheduled split leg for ${new Date(scheduledTs).toLocaleString()}` : `Split transfer leg of ₦${totalNum.toLocaleString()}`
    });

    if (isScheduled) {
      continue;
    }

    const workerState = { cancelled: false, paused: false };
    activeJobs.set(jobId, workerState);

    (async () => {
      let remaining = totalNum;
      let count = 0;
      while (remaining > 0 && !workerState.cancelled) {
        while (workerState.paused && !workerState.cancelled) {
          await sleep(1000);
        }
        if (workerState.cancelled) break;

        const sendAmount = Math.min(chunkSize, remaining);
        count++;
        const r = await sendMoney(acc.cookie, resolvedTo, sendAmount, null, null, acc.pin);

        if (r.status === 200) {
          remaining -= sendAmount;
          job.remaining = remaining;
          job.txCount = count;
          job.logs.push(`[${new Date().toLocaleTimeString()}] [${count}/${totalTxs}] Leg ${acc.name} sent ₦${sendAmount.toLocaleString()} ✅`);
          await writeJson(JOBS_FILE, jobs);
          await recordLedgerEntry({ id: jobId, chunksCompleted: count });

          if (remaining > 0 && !workerState.cancelled) {
            await waitInterval(delayMs, workerState);
          }
        } else if (r.status === 429) {
          job.logs.push(`[${new Date().toLocaleTimeString()}] ⏳ Rate limit (429) hit on ${acc.name}. Rapid re-check in 2.5s...`);
          await writeJson(JOBS_FILE, jobs);
          await sleep(2500);
        } else {
          const errMsg = r.data?.error || JSON.stringify(r.data || r.error);
          job.logs.push(`[${new Date().toLocaleTimeString()}] Error ${r.status}: ${errMsg}`);
          if (r.status === 404 || (r.status === 400 && String(errMsg).includes("need"))) {
            job.status = "FAILED";
            await writeJson(JOBS_FILE, jobs);
            await recordLedgerEntry({ id: jobId, status: "FAILED" });
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
      await recordLedgerEntry({
        id: jobId,
        status: job.status === "COMPLETED" ? "COMPLETED" : "STOPPED",
        chunksCompleted: count
      });
      await writeJson(JOBS_FILE, jobs);
      activeJobs.delete(jobId);
    })();
  }

  await writeJson(JOBS_FILE, jobs);
  res.json({ success: true, scheduled: isScheduled, jobs: createdJobs });
});

// Batch Distribution Execution
app.post("/api/transfers/batch", requireAdminAuth, async (req, res) => {
  const { accountId, recipients, amountPerUser, scheduledAt } = req.body;
  if (!Array.isArray(recipients) || recipients.length === 0) {
    return res.status(400).json({ error: "Recipients array required" });
  }

  const accounts = await readJson(ACCOUNTS_FILE, []);
  const acc = accounts.find(a => a.id === accountId);
  if (!acc) return res.status(404).json({ error: "Sender account not found" });

  const amount = parseAmount(amountPerUser);
  if (!amount || amount <= 0) {
    return res.status(400).json({ error: "Valid amount per recipient is required" });
  }

  const recipientQueue = parseBulkRecipientEntries(recipients, amount);
  if (recipientQueue.length === 0) {
    return res.status(400).json({ error: "No valid recipients found in list" });
  }

  const jobId = `batch_${Date.now()}_${Math.random().toString(36).slice(7)}`;
  const totalAmount = recipientQueue.reduce((sum, item) => sum + item.targetAmount, 0);
  const totalTxs = recipientQueue.reduce((sum, item) => sum + Math.ceil(item.targetAmount / MAX_TRANSFER_CHUNK), 0);

  const scheduledTs = scheduledAt ? new Date(scheduledAt).getTime() : null;
  const isScheduled = Boolean(scheduledTs && !isNaN(scheduledTs) && scheduledTs > Date.now());
  const initialStatus = isScheduled ? "SCHEDULED" : "RUNNING";

  const job = {
    id: jobId,
    type: "BATCH",
    sender: acc.name,
    accountId: acc.id,
    recipients: recipientQueue.map(r => r.rawInput),
    recipientQueue,
    amountPerUser: amount,
    target: `${recipientQueue.length} recipients`,
    targetLabel: `Batch (${recipientQueue.length} users)`,
    total: totalAmount,
    remaining: totalAmount,
    chunkSize: Math.min(amount, MAX_TRANSFER_CHUNK),
    totalTxs,
    txCount: 0,
    status: initialStatus,
    startTime: new Date().toISOString(),
    scheduledAt: isScheduled ? new Date(scheduledTs).toISOString() : null,
    scheduledTimestamp: isScheduled ? scheduledTs : null,
    logs: [isScheduled 
      ? `[${new Date().toLocaleTimeString()}] ⏰ Batch scheduled for ${new Date(scheduledTs).toLocaleString()} (${recipientQueue.length} recipients, Total: ₦${totalAmount.toLocaleString()})`
      : `[${new Date().toLocaleTimeString()}] Batch started: ${recipientQueue.length} recipients (Total: ₦${totalAmount.toLocaleString()})`
    ]
  };

  const jobs = await readJson(JOBS_FILE, []);
  jobs.unshift(job);
  await writeJson(JOBS_FILE, jobs);

  await recordLedgerEntry({
    id: jobId,
    timestamp: Date.now(),
    sender: acc.name,
    recipient: `Batch (${recipientQueue.length} users)`,
    targetId: "BATCH",
    amount: totalAmount,
    chunkSize: Math.min(amount, MAX_TRANSFER_CHUNK),
    chunksCompleted: 0,
    totalChunks: totalTxs,
    status: initialStatus,
    notes: isScheduled ? `Scheduled batch distribution for ${new Date(scheduledTs).toLocaleString()}` : `Batch distribution of ₦${amount.toLocaleString()} default (${recipientQueue.length} users)`
  });

  if (isScheduled) {
    return res.json({ success: true, scheduled: true, job });
  }

  reviveJobWorker(job);
  res.json({ success: true, job });
});

// Official Ledger & Audit Records API
app.get("/api/admin/ledger", requireAdminAuth, async (req, res) => {
  const ledger = await readJson(LEDGER_FILE, []);
  
  // Calculate summary metrics
  let totalVolume = 0;
  let todayVolume = 0;
  let totalTxs = 0;
  const uniqueRecipients = new Set();
  const todayStart = new Date().setHours(0, 0, 0, 0);

  for (const item of ledger) {
    const amt = Number(item.amount) || 0;
    totalVolume += amt;
    totalTxs += (Number(item.chunksCompleted) || 1);
    if (item.targetId) uniqueRecipients.add(item.targetId);
    if (item.timestamp >= todayStart) {
      todayVolume += amt;
    }
  }

  res.json({
    records: ledger,
    metrics: {
      totalVolume,
      todayVolume,
      totalTxs,
      uniqueRecipients: uniqueRecipients.size
    }
  });
});

// -------------------------------------------------------------
// VIP Client Portal API (Multi-Tenant & Isolated)
// -------------------------------------------------------------
app.get(["/client", "/vip", "/portal", "/sprayer", "/spray"], (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const pendingTwoFactorChallenges = new Map();

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
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36"
      },
      body: JSON.stringify({ username: cleanUser, password })
    });

    const loginData = await loginRes.json().catch(() => ({}));

    // If account has Two-Step Login (2FA) enabled
    if (loginData.code === "two_factor" || loginData.challenge) {
      const setCookies = typeof loginRes.headers.getSetCookie === "function" ? loginRes.headers.getSetCookie() : [];
      const interimCookies = setCookies.map(c => c.split(";")[0]).join("; ");
      if (loginData.challenge) {
        pendingTwoFactorChallenges.set(loginData.challenge, {
          username: cleanUser,
          interimCookies,
          createdAt: Date.now()
        });
      }
      return res.json({
        twoFactorRequired: true,
        challenge: loginData.challenge,
        method: loginData.method || "app",
        to: loginData.to || null,
        error: loginData.error || "Two-step login code required"
      });
    }

    if (!loginRes.ok) {
      return res.status(loginRes.status).json({ error: loginData.error || "Login rejected by LagosLife. Check credentials." });
    }

    const setCookies = typeof loginRes.headers.getSetCookie === "function" ? loginRes.headers.getSetCookie() : [];
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

// Complete Two-Step (2FA) Login
app.post("/api/client/2fa", async (req, res) => {
  const { challenge, code } = req.body;
  if (!challenge || !code) return res.status(400).json({ error: "Challenge and 6-digit code required" });

  try {
    const pending = pendingTwoFactorChallenges.get(challenge);
    const headers = {
      "accept": "application/json",
      "content-type": "application/json",
      "origin": "https://lagoslife.app",
      "referer": "https://lagoslife.app/",
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36"
    };
    if (pending?.interimCookies) {
      headers["cookie"] = pending.interimCookies;
    }

    const twoFaRes = await fetch("https://lagoslife.app/api/auth/2fa", {
      method: "POST",
      headers,
      body: JSON.stringify({ action: "login", challenge, code: String(code).trim().toUpperCase() })
    });

    const twoFaData = await twoFaRes.json().catch(() => ({}));
    if (!twoFaRes.ok) {
      return res.status(twoFaRes.status).json({ error: twoFaData.error || "Invalid 2FA code" });
    }

    const newCookies = (typeof twoFaRes.headers.getSetCookie === "function" ? twoFaRes.headers.getSetCookie() : [])
      .map(c => c.split(";")[0]);
    const interimList = pending?.interimCookies ? pending.interimCookies.split("; ").filter(Boolean) : [];
    const cookieMap = new Map();
    for (const c of [...interimList, ...newCookies]) {
      const idx = c.indexOf("=");
      if (idx !== -1) {
        cookieMap.set(c.slice(0, idx).trim(), c.slice(idx + 1).trim());
      }
    }
    const cookieStr = Array.from(cookieMap.entries()).map(([k, v]) => `${k}=${v}`).join("; ");

    if (!cookieStr) {
      return res.status(401).json({ error: "No session cookies received from 2FA" });
    }

    pendingTwoFactorChallenges.delete(challenge);

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
        user: user.username || pending?.username || "client",
        name: user.name || user.username || pending?.username || "VIP Client",
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

// Re-send Two-Step (2FA) Code (if email method)
app.post("/api/client/2fa/resend", async (req, res) => {
  const { challenge } = req.body;
  if (!challenge) return res.status(400).json({ error: "Challenge required" });

  try {
    const resendRes = await fetch("https://lagoslife.app/api/auth/2fa", {
      method: "POST",
      headers: {
        "accept": "application/json",
        "content-type": "application/json",
        "origin": "https://lagoslife.app",
        "referer": "https://lagoslife.app/",
        "user-agent": "Mozilla/5.0"
      },
      body: JSON.stringify({ action: "send", challenge })
    });
    const data = await resendRes.json().catch(() => ({}));
    if (!resendRes.ok) {
      return res.status(resendRes.status).json({ error: data.error || "Failed to resend code" });
    }
    res.json({ success: true, to: data.to });
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

// Client Status
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

// Client Transfer Worker Function
function runClientWorker(job, session) {
  if (activeJobs.has(job.id)) {
    return;
  }
  const workerState = { cancelled: false, paused: false };
  activeJobs.set(job.id, workerState);

  (async () => {
    try {
      if (job.type === "batch" || job.type === "BATCH") {
        const defaultAmt = parseAmount(job.amountPerUser || job.chunkSize) || MAX_TRANSFER_CHUNK;
        if (!Array.isArray(job.recipientQueue) || job.recipientQueue.length === 0) {
          job.recipientQueue = parseBulkRecipientEntries(job.recipients || [], defaultAmt);
        }
        const queue = job.recipientQueue;
        const maxChunk = MAX_TRANSFER_CHUNK;
        const delayMs = job.delayMs || 400;

        for (let i = 0; i < queue.length; i++) {
          const entry = queue[i];
          if (!entry || entry.completed || entry.remaining <= 0) continue;

          while (workerState.paused && !workerState.cancelled) {
            await sleep(1000);
          }
          if (workerState.cancelled) break;

          let resolved = entry.resolvedId
            ? { id: entry.resolvedId, username: entry.resolvedUsername || entry.rawInput }
            : null;

          if (!resolved) {
            resolved = await resolveTargetIdAsync(entry.rawInput, session.account.cookie);
            if (!resolved || !resolved.id) {
              entry.completed = true;
              entry.remaining = 0;
              job.remaining = queue.reduce((sum, item) => sum + (item.completed ? 0 : Math.max(0, item.remaining || 0)), 0);
              job.logs.push(`⚠️ Skipped unknown player: ${entry.rawInput}`);
              continue;
            }
            entry.resolvedId = resolved.id;
            entry.resolvedUsername = resolved.username;
          }

          const senderUser = (session.account.user || "").toLowerCase().replace(/^@/, "");
          const targetUserLower = (resolved.username || "").toLowerCase().replace(/^@/, "");
          if (resolved.id === session.account.uid || (targetUserLower && targetUserLower === senderUser)) {
            entry.completed = true;
            entry.remaining = 0;
            job.remaining = queue.reduce((sum, item) => sum + (item.completed ? 0 : Math.max(0, item.remaining || 0)), 0);
            job.logs.push(`⚠️ Skipped self-transfer (@${resolved.username})`);
            continue;
          }

          if ((entry.sent || 0) === 0) {
            job.logs.push(`[${new Date().toLocaleTimeString()}] 🚀 Commencing delivery to @${resolved.username} (${i + 1}/${queue.length}) — Target: ₦${entry.targetAmount.toLocaleString()}`);
          } else {
            job.logs.push(`[${new Date().toLocaleTimeString()}] ▶️ Resuming delivery to @${resolved.username} (${i + 1}/${queue.length}) — Remaining: ₦${entry.remaining.toLocaleString()} of ₦${entry.targetAmount.toLocaleString()}`);
          }

          const userTotalChunks = Math.ceil(entry.targetAmount / maxChunk);

          while (entry.remaining > 0 && !workerState.cancelled) {
            while (workerState.paused && !workerState.cancelled) {
              await sleep(1000);
            }
            if (workerState.cancelled) break;

            const sendAmt = Math.min(maxChunk, entry.remaining);
            let sendSuccess = false;
            let attempts = 0;

            while (!sendSuccess && !workerState.cancelled) {
              while (workerState.paused && !workerState.cancelled) {
                await sleep(1000);
              }
              if (workerState.cancelled) break;

              attempts++;
              const effectivePin = job.pin || session.account.pin || null;
              const effectiveCode = job.twoStepCode || session.account.twoStepCode || null;
              const r = await sendMoney(session.account.cookie, resolved.id, sendAmt, null, effectiveCode, effectivePin);

              if (r.status === 200) {
                sendSuccess = true;
                if (effectivePin) {
                  session.account.pin = effectivePin;
                  job.pin = effectivePin;
                }
                if (effectiveCode) {
                  session.account.twoStepCode = effectiveCode;
                  job.twoStepCode = effectiveCode;
                }
                entry.remaining = Math.max(0, entry.remaining - sendAmt);
                entry.sent = (entry.sent || 0) + sendAmt;
                entry.txCount = (entry.txCount || 0) + 1;
                if (entry.remaining <= 0) {
                  entry.completed = true;
                }

                job.remaining = queue.reduce((sum, item) => sum + (item.completed ? 0 : Math.max(0, item.remaining || 0)), 0);
                job.txCount = (job.txCount || 0) + 1;

                const chunkLabel = userTotalChunks > 1 ? ` (chunk ${entry.txCount}/${userTotalChunks})` : "";
                job.logs.push(`[${new Date().toLocaleTimeString()}] [${i + 1}/${queue.length}] Sent ₦${sendAmt.toLocaleString()} to @${resolved.username}${chunkLabel} ✅`);

                if (entry.remaining > 0 || i < queue.length - 1) {
                  await waitInterval(delayMs, workerState);
                }
              } else if (r.status === 429) {
                job.logs.push(`[${new Date().toLocaleTimeString()}] ⏳ Rate limit (429) on @${resolved.username}. Rapid re-check in 2.5s...`);
                await sleep(2500);
              } else {
                const errMsg = r.data?.error || r.data?.message || JSON.stringify(r.data || r.error || `HTTP ${r.status}`);
                job.logs.push(`[${new Date().toLocaleTimeString()}] ⚠️ Notice (${r.status || 'Network'}): ${errMsg}`);

                const errLower = String(errMsg).toLowerCase();
                if (errLower.includes("pin") || errLower.includes("passcode")) {
                  job.status = "PAUSED";
                  job.needsTwoStep = true;
                  job.twoStepType = "pin";
                  if (errLower.includes("incorrect") || errLower.includes("invalid") || errLower.includes("wrong")) {
                    job.pin = null;
                    session.account.pin = null;
                  }
                  job.logs.push(`[${new Date().toLocaleTimeString()}] 🛡️ Transaction PIN required: "${errMsg}". Enter your PIN above to resume.`);
                  activeJobs.delete(job.id);
                  return;
                }

                if (errLower.includes("two-step") || errLower.includes("two step") || errLower.includes("twofactor") || errLower.includes("two factor") || errLower.includes("2fa") || errLower.includes("verification") || errLower.includes("challenge") || errLower.includes("code required")) {
                  job.status = "PAUSED";
                  job.needsTwoStep = true;
                  job.twoStepType = "2fa";
                  job.twoStepCode = null;
                  session.account.twoStepCode = null;
                  job.logs.push(`[${new Date().toLocaleTimeString()}] 🛡️ Two-step 2FA required: "${errMsg}". Enter your 6-digit 2FA code above to resume.`);
                  activeJobs.delete(job.id);
                  return;
                }

                if (errLower.includes("100,000,000,000") || errLower.includes("at a time")) {
                  job.chunkSize = MAX_TRANSFER_CHUNK;
                  job.logs.push(`[${new Date().toLocaleTimeString()}] 🔄 Automatically adjusted chunk to ₦100B. Retrying next chunk immediately...`);
                  break;
                }

                if (errLower.includes("need") || errLower.includes("money") || errLower.includes("balance") || errLower.includes("insufficient")) {
                  job.logs.push(`[${new Date().toLocaleTimeString()}] 🛑 Insufficient treasury balance. Transfer paused.`);
                  job.status = "PAUSED";
                  activeJobs.delete(job.id);
                  return;
                }

                if (r.status === 400 || r.status === 401 || r.status === 403 || r.status === 404) {
                  job.logs.push(`[${new Date().toLocaleTimeString()}] ⚠️ Notice from server (${r.status}): ${errMsg}`);
                  job.status = "PAUSED";
                  activeJobs.delete(job.id);
                  return;
                }

                const backoffSec = Math.min(10 + attempts * 5, 45);
                job.logs.push(`[${new Date().toLocaleTimeString()}] 🔄 Retrying chunk to @${resolved.username} in ${backoffSec}s (attempt ${attempts}) to see transfer through...`);
                let cd = 0;
                while (cd < backoffSec * 1000 && !workerState.cancelled && !workerState.paused) {
                  await sleep(1000);
                  cd += 1000;
                }
              }
            }
          }

          if (entry.remaining === 0) {
            const nextMsg = i < queue.length - 1 ? `Moving to next account (${i + 2}/${queue.length})...` : "All accounts in bulk queue finished!";
            job.logs.push(`[${new Date().toLocaleTimeString()}] 🎯 Completed all transfers to @${resolved.username} (₦${entry.sent.toLocaleString()})! ${nextMsg}`);
          }
        }
      } else if (job.type === "spray" || job.type === "SPRAY") {
        const delayMs = job.delayMs || 350;
        const totalSprays = job.totalTxs || 100;
        const stackObj = resolveSprayStack(job.stackId || job.stackValue || job.chunkSize || 1000000000);
        const stackId = stackObj.id;
        const numStack = stackObj.amount;
        let count = job.txCount || 0;

        while (count < totalSprays && !workerState.cancelled) {
          while (workerState.paused && !workerState.cancelled) {
            await sleep(500);
          }
          if (workerState.cancelled) break;

          let spraySuccess = false;
          let attempts = 0;

          while (!spraySuccess && !workerState.cancelled) {
            while (workerState.paused && !workerState.cancelled) {
              await sleep(500);
            }
            if (workerState.cancelled) break;

            attempts++;
            const effectivePin = job.pin || session.account.pin || null;

            const payload = job.rawPayload
              ? {
                  ...job.rawPayload,
                  stack: resolveSprayStack(job.rawPayload.stack || stackId).id,
                  ...(effectivePin ? { pin: String(effectivePin).trim() } : {})
                }
              : {
                  ...(job.partyKind === "venue" ? { at: job.hostOrVenue } : { host: job.hostId }),
                  to: job.target,
                  stack: stackId,
                  ...(effectivePin ? { pin: String(effectivePin).trim() } : {})
                };

            let r;
            try {
              const controller = new AbortController();
              const timer = setTimeout(() => controller.abort(), 12000);
              const res = await fetch("https://lagoslife.app/api/spray/party", {
                method: "POST",
                headers: {
                  cookie: session.account.cookie,
                  "content-type": "application/json",
                  accept: "*/*",
                  origin: "https://lagoslife.app",
                  referer: "https://lagoslife.app/",
                  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36"
                },
                body: JSON.stringify(payload),
                signal: controller.signal
              });
              clearTimeout(timer);
              const data = await res.json().catch(() => ({}));
              r = { status: res.status, data };
            } catch (netErr) {
              r = { status: 0, error: netErr.message };
            }

            if (r.status === 200) {
              spraySuccess = true;
              if (effectivePin) {
                session.account.pin = effectivePin;
                job.pin = effectivePin;
              }
              count++;
              job.txCount = count;
              const actualAmount = Number(r.data?.amount) || numStack;
              job.remaining = Math.max(0, job.total - count * actualAmount);
              job.logs.push(`[${new Date().toLocaleTimeString()}] [${count}/${totalSprays}] 💸 Sprayed ₦${actualAmount.toLocaleString()} (${stackObj.label}) on ${job.targetLabel} ✅`);
              if (count < totalSprays && !workerState.cancelled) {
                await waitInterval(delayMs, workerState);
              }
            } else if (r.status === 429) {
              const retryWait = Math.max(800, Math.min(Number(r.data?.retryIn) || 1200, 5000));
              job.logs.push(`[${new Date().toLocaleTimeString()}] ⏳ Spray cooldown (429). Retrying in ${(retryWait / 1000).toFixed(1)}s...`);
              await sleep(retryWait);
            } else {
              const errMsg = r.data?.error || r.data?.message || JSON.stringify(r.data || r.error || `HTTP ${r.status}`);
              const errCode = String(r.data?.code || "").toLowerCase();
              job.logs.push(`[${new Date().toLocaleTimeString()}] ⚠️ Spray notice (${r.status || "Network"}): ${errMsg}`);
              const errLower = String(errMsg).toLowerCase();

              if (errCode === "pin" || errCode === "pin_wrong" || errCode === "pin_setup" || errLower.includes("pin") || errLower.includes("passcode")) {
                job.status = "PAUSED";
                job.needsTwoStep = true;
                job.twoStepType = "pin";
                if (errCode === "pin_wrong" || errLower.includes("incorrect") || errLower.includes("invalid") || errLower.includes("wrong")) {
                  job.pin = null;
                  session.account.pin = null;
                }
                job.logs.push(`[${new Date().toLocaleTimeString()}] 🛡️ Transaction PIN required: "${errMsg}". Enter your PIN on the card to resume spraying.`);
                activeJobs.delete(job.id);
                return;
              }

              if (errLower.includes("two-step") || errLower.includes("two step") || errLower.includes("2fa") || errLower.includes("verification") || errLower.includes("code required")) {
                job.status = "PAUSED";
                job.needsTwoStep = true;
                job.twoStepType = "2fa";
                job.twoStepCode = null;
                session.account.twoStepCode = null;
                job.logs.push(`[${new Date().toLocaleTimeString()}] 🛡️ Two-step 2FA required: "${errMsg}". Enter your 6-digit 2FA code to resume spraying.`);
                activeJobs.delete(job.id);
                return;
              }

              if (r.status === 400 || r.status === 401 || r.status === 403 || r.status === 404 || r.status === 409) {
                if (attempts === 1) {
                  // Auto-recover: try knocking/entering house or switching to event venue if hosted at a venue
                  const evList = await fetchActiveEventsList(session.account.cookie);
                  const matchEv = evList.find((ev) =>
                    ev.code === job.eventCode ||
                    ev.host?.id === job.hostId ||
                    ev.cohost?.id === job.hostId ||
                    ev.host?.id === job.target ||
                    ev.cohost?.id === job.target
                  );
                  if (matchEv && matchEv.partyKind === "venue" && job.partyKind !== "venue") {
                    job.partyKind = "venue";
                    job.hostOrVenue = matchEv.place;
                    job.eventCode = matchEv.code;
                    job.logs.push(`[${new Date().toLocaleTimeString()}] 🔄 Auto-switched to Venue "${matchEv.placeLabel}" (${matchEv.place}) for event "${matchEv.title}"...`);
                  }
                  await ensureInPartyOrVenue(session.account.cookie, {
                    partyKind: job.partyKind,
                    hostId: job.hostId,
                    venueId: job.hostOrVenue,
                    eventCode: job.eventCode || matchEv?.code || null
                  });
                  await sleep(400);
                  continue;
                }
                job.logs.push(`[${new Date().toLocaleTimeString()}] ⏸️ Spray paused (${r.status}): ${errMsg}. Make sure the party/event has started & you are inside, then tap Resume.`);
                job.status = "PAUSED";
                activeJobs.delete(job.id);
                return;
              }

              const backoffSec = Math.min(3 + attempts * 2, 15);
              job.logs.push(`[${new Date().toLocaleTimeString()}] 🔄 Retrying spray in ${backoffSec}s...`);
              await sleep(backoffSec * 1000);
            }
          }
        }
      } else {
        const delayMs = job.delayMs || 400;
        job.chunkSize = Math.min(job.chunkSize || MAX_TRANSFER_CHUNK, MAX_TRANSFER_CHUNK);
        job.totalTxs = Math.ceil(job.total / job.chunkSize);
        let remaining = job.remaining;
        let count = job.txCount || 0;

        while (remaining > 0 && !workerState.cancelled) {
          while (workerState.paused && !workerState.cancelled) {
            await sleep(1000);
          }
          if (workerState.cancelled) break;

          const sendAmt = Math.min(job.chunkSize, remaining, MAX_TRANSFER_CHUNK);
          let sendSuccess = false;
          let attempts = 0;

          while (!sendSuccess && !workerState.cancelled) {
            while (workerState.paused && !workerState.cancelled) {
              await sleep(1000);
            }
            if (workerState.cancelled) break;

            attempts++;
            const effectivePin = job.pin || session.account.pin || null;
            const effectiveCode = job.twoStepCode || session.account.twoStepCode || null;
            const r = await sendMoney(session.account.cookie, job.target, sendAmt, null, effectiveCode, effectivePin);

            if (r.status === 200) {
              sendSuccess = true;
              if (effectivePin) {
                session.account.pin = effectivePin;
                job.pin = effectivePin;
              }
              if (effectiveCode) {
                session.account.twoStepCode = effectiveCode;
                job.twoStepCode = effectiveCode;
              }
              remaining -= sendAmt;
              job.remaining = remaining;
              count++;
              job.txCount = count;
              job.logs.push(`[${new Date().toLocaleTimeString()}] [${count}/${job.totalTxs}] Sent ₦${sendAmt.toLocaleString()} ✅`);
              if (remaining > 0 && !workerState.cancelled) {
                await waitInterval(delayMs, workerState);
              }
            } else if (r.status === 429) {
              job.logs.push(`[${new Date().toLocaleTimeString()}] ⏳ Rate limit (429) hit. Rapid re-check in 2.5s...`);
              await sleep(2500);
            } else {
              const errMsg = r.data?.error || r.data?.message || JSON.stringify(r.data || r.error || `HTTP ${r.status}`);
              job.logs.push(`[${new Date().toLocaleTimeString()}] ⚠️ Notice (${r.status || 'Network'}): ${errMsg}`);

              const errLower = String(errMsg).toLowerCase();
              if (errLower.includes("pin") || errLower.includes("passcode")) {
                job.status = "PAUSED";
                job.needsTwoStep = true;
                job.twoStepType = "pin";
                if (errLower.includes("incorrect") || errLower.includes("invalid") || errLower.includes("wrong")) {
                  job.pin = null;
                  session.account.pin = null;
                }
                job.logs.push(`[${new Date().toLocaleTimeString()}] 🛡️ Transaction PIN required: "${errMsg}". Enter your PIN above to resume.`);
                activeJobs.delete(job.id);
                return;
              }

              if (errLower.includes("two-step") || errLower.includes("two step") || errLower.includes("twofactor") || errLower.includes("two factor") || errLower.includes("2fa") || errLower.includes("verification") || errLower.includes("challenge") || errLower.includes("code required")) {
                job.status = "PAUSED";
                job.needsTwoStep = true;
                job.twoStepType = "2fa";
                job.twoStepCode = null;
                session.account.twoStepCode = null;
                job.logs.push(`[${new Date().toLocaleTimeString()}] 🛡️ Two-step 2FA required: "${errMsg}". Enter your 6-digit 2FA code above to resume.`);
                activeJobs.delete(job.id);
                return;
              }

              // Auto-recover if chunk limit was exceeded
              if (errLower.includes("100,000,000,000") || errLower.includes("at a time")) {
                job.chunkSize = MAX_TRANSFER_CHUNK;
                job.totalTxs = Math.ceil(job.total / job.chunkSize);
                job.logs.push(`[${new Date().toLocaleTimeString()}] 🔄 Automatically clamped chunk to ₦100B per LagosLife rule. Retrying next chunk immediately...`);
                break;
              }

              // Fatal balance errors
              if (errLower.includes("need") || errLower.includes("money") || errLower.includes("balance") || errLower.includes("insufficient")) {
                job.logs.push(`[${new Date().toLocaleTimeString()}] 🛑 Insufficient treasury balance. Transfer paused.`);
                job.status = "PAUSED";
                activeJobs.delete(job.id);
                return;
              }

              // Other 4xx errors - mark as PAUSED so user can retry or adjust
              if (r.status === 400 || r.status === 401 || r.status === 403 || r.status === 404) {
                job.logs.push(`[${new Date().toLocaleTimeString()}] ⚠️ Notice from server (${r.status}): ${errMsg}`);
                job.status = "PAUSED";
                activeJobs.delete(job.id);
                return;
              }

              // Transient network/server error backoff
              const backoffSec = Math.min(10 + attempts * 5, 30);
              job.logs.push(`[${new Date().toLocaleTimeString()}] 🔄 Retrying in ${backoffSec}s (attempt ${attempts})...`);
              let cd = 0;
              while (cd < backoffSec * 1000 && !workerState.cancelled && !workerState.paused) {
                await sleep(1000);
                cd += 1000;
              }
            }
          }
        }
      }

      if (workerState.cancelled) {
        job.status = "CANCELLED";
        job.logs.push(`[${new Date().toLocaleTimeString()}] 🛑 Transfer cancelled by user.`);
      } else if (job.remaining === 0) {
        job.status = "COMPLETED";
        job.logs.push(`[${new Date().toLocaleTimeString()}] 🎉 100% Complete! All funds successfully delivered.`);
      } else {
        job.status = "PAUSED";
        job.logs.push(`[${new Date().toLocaleTimeString()}] ⏸️ Transfer stopped with ₦${job.remaining.toLocaleString()} remaining.`);
      }
    } catch (err) {
      console.error("Client worker exception:", err);
    } finally {
      activeJobs.delete(job.id);
    }
  })();
}

// Client Send
app.post("/api/client/send", async (req, res) => {
  const token = req.headers["x-client-token"] || req.query.token;
  if (!token || !clientSessions.has(token)) return res.status(401).json({ error: "Unauthenticated" });

  const session = clientSessions.get(token);
  const { to, amount, scheduledAt, twoStepCode, pin } = req.body;
  if (!to || !amount) return res.status(400).json({ error: "Recipient and amount required" });

  const cleanPin = pin ? String(pin).trim() : (session.account.pin || null);
  const cleanTwoStep = twoStepCode ? String(twoStepCode).trim() : (session.account.twoStepCode || null);
  if (cleanPin) session.account.pin = cleanPin;
  if (cleanTwoStep) session.account.twoStepCode = cleanTwoStep;

  // If user explicitly provided a separate 6-digit 2FA code upfront, pre-elevate session
  if (cleanTwoStep && cleanTwoStep.length === 6 && cleanTwoStep !== cleanPin) {
    try {
      const twoFaRes = await fetch("https://lagoslife.app/api/auth/2fa", {
        method: "POST",
        headers: {
          cookie: session.account.cookie,
          "content-type": "application/json",
          "origin": "https://lagoslife.app",
          "referer": "https://lagoslife.app/",
          "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36"
        },
        body: JSON.stringify({ action: "step", code: cleanTwoStep })
      });
      if (twoFaRes.ok) {
        const newCookies = (typeof twoFaRes.headers.getSetCookie === "function" ? twoFaRes.headers.getSetCookie() : [])
          .map(c => c.split(";")[0]);
        if (newCookies.length) {
          session.account.cookie = mergeCookies(session.account.cookie, newCookies);
        }
      }
    } catch {}
  }

  const resolved = await resolveTargetIdAsync(to, session.account.cookie);
  if (!resolved || !resolved.id) {
    return res.status(400).json({ error: `Player '${to}' could not be found` });
  }

  const resolvedTo = resolved.id;
  const senderUser = (session.account.user || "").toLowerCase().replace(/^@/, "");
  const targetUser = (resolved.username || "").toLowerCase().replace(/^@/, "");
  if (resolvedTo === session.account.uid || (targetUser && targetUser === senderUser)) {
    return res.status(400).json({ error: "Cannot send money to yourself. Please enter a different recipient." });
  }
  const targetLabel = resolved.name ? `${resolved.name} (@${resolved.username})` : `@${resolved.username || resolvedTo}`;
  const totalNum = parseAmount(amount);
  if (!totalNum || totalNum <= 0) {
    return res.status(400).json({ error: "Please enter a valid transfer amount." });
  }
  const chunkSize = Math.min(totalNum, MAX_TRANSFER_CHUNK);
  const delayMs = 400;
  const jobId = `client_tx_${Date.now()}_${Math.random().toString(36).slice(7)}`;
  const totalTxs = Math.ceil(totalNum / chunkSize);

  let isScheduled = false;
  let scheduledTimestamp = null;
  if (scheduledAt) {
    const targetMs = new Date(scheduledAt).getTime();
    if (!isNaN(targetMs) && targetMs > Date.now()) {
      isScheduled = true;
      scheduledTimestamp = targetMs;
    }
  }

  const job = {
    id: jobId,
    type: "single",
    sender: session.account.name,
    target: resolvedTo,
    originalInput: to,
    targetLabel,
    total: totalNum,
    remaining: totalNum,
    chunkSize,
    totalTxs,
    txCount: 0,
    delayMs,
    pin: cleanPin,
    twoStepCode: cleanTwoStep,
    status: isScheduled ? "SCHEDULED" : "RUNNING",
    scheduledTimestamp,
    logs: [
      isScheduled
        ? `[${new Date().toLocaleTimeString()}] ⏰ Scheduled transfer queued for ${new Date(scheduledTimestamp).toLocaleString()}: ₦${totalNum.toLocaleString()} to ${targetLabel}`
        : `[${new Date().toLocaleTimeString()}] Transfer initialized: ₦${totalNum.toLocaleString()} to ${targetLabel}`
    ]
  };

  session.jobs.unshift(job);
  if (!isScheduled) {
    runClientWorker(job, session);
  }

  res.json({ success: true, job });
});

// Client Batch Send
app.post("/api/client/batch", async (req, res) => {
  const token = req.headers["x-client-token"] || req.query.token;
  if (!token || !clientSessions.has(token)) return res.status(401).json({ error: "Unauthenticated" });

  const session = clientSessions.get(token);
  const { recipients, amountPerUser, scheduledAt, twoStepCode, pin } = req.body;
  if (!Array.isArray(recipients) || recipients.length === 0) {
    return res.status(400).json({ error: "Recipients array required" });
  }

  const cleanPin = pin ? String(pin).trim() : (session.account.pin || null);
  const cleanTwoStep = twoStepCode ? String(twoStepCode).trim() : (session.account.twoStepCode || null);
  if (cleanPin) session.account.pin = cleanPin;
  if (cleanTwoStep) session.account.twoStepCode = cleanTwoStep;

  // If user explicitly provided a separate 6-digit 2FA code upfront, pre-elevate session
  if (cleanTwoStep && cleanTwoStep.length === 6 && cleanTwoStep !== cleanPin) {
    try {
      const twoFaRes = await fetch("https://lagoslife.app/api/auth/2fa", {
        method: "POST",
        headers: {
          cookie: session.account.cookie,
          "content-type": "application/json",
          "origin": "https://lagoslife.app",
          "referer": "https://lagoslife.app/",
          "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36"
        },
        body: JSON.stringify({ action: "step", code: cleanTwoStep })
      });
      if (twoFaRes.ok) {
        const newCookies = (typeof twoFaRes.headers.getSetCookie === "function" ? twoFaRes.headers.getSetCookie() : [])
          .map(c => c.split(";")[0]);
        if (newCookies.length) {
          session.account.cookie = mergeCookies(session.account.cookie, newCookies);
        }
      }
    } catch {}
  }

  const amount = parseAmount(amountPerUser);
  if (!amount || amount <= 0) {
    return res.status(400).json({ error: "Please enter a valid Amount Per Recipient (e.g. 50B, 100B)" });
  }

  const recipientQueue = parseBulkRecipientEntries(recipients, amount);
  if (recipientQueue.length === 0) {
    return res.status(400).json({ error: "No valid recipients found in the list" });
  }

  const jobId = `client_batch_${Date.now()}_${Math.random().toString(36).slice(7)}`;
  const totalAmount = recipientQueue.reduce((sum, item) => sum + item.targetAmount, 0);
  const totalTxs = recipientQueue.reduce((sum, item) => sum + Math.ceil(item.targetAmount / MAX_TRANSFER_CHUNK), 0);

  let isScheduled = false;
  let scheduledTimestamp = null;
  if (scheduledAt) {
    const targetMs = new Date(scheduledAt).getTime();
    if (!isNaN(targetMs) && targetMs > Date.now()) {
      isScheduled = true;
      scheduledTimestamp = targetMs;
    }
  }

  const job = {
    id: jobId,
    type: "batch",
    sender: session.account.name,
    target: `${recipientQueue.length} recipients`,
    recipients: recipientQueue.map(r => r.rawInput),
    recipientQueue,
    amountPerUser: amount,
    targetLabel: `Bulk (${recipientQueue.length} players)`,
    total: totalAmount,
    remaining: totalAmount,
    chunkSize: Math.min(amount, MAX_TRANSFER_CHUNK),
    totalTxs,
    txCount: 0,
    pin: cleanPin,
    twoStepCode: cleanTwoStep,
    status: isScheduled ? "SCHEDULED" : "RUNNING",
    scheduledTimestamp,
    logs: [
      isScheduled
        ? `[${new Date().toLocaleTimeString()}] ⏰ Scheduled bulk transfer queued for ${new Date(scheduledTimestamp).toLocaleString()}: ${recipientQueue.length} recipients (Total: ₦${totalAmount.toLocaleString()})`
        : `[${new Date().toLocaleTimeString()}] Bulk transfer queued for ${recipientQueue.length} recipients (Total: ₦${totalAmount.toLocaleString()})`
    ]
  };

  session.jobs.unshift(job);
  if (!isScheduled) {
    runClientWorker(job, session);
  }

  res.json({ success: true, job });
});

// Client Start Scheduled Job Now
app.post("/api/client/start-now", async (req, res) => {
  const token = req.headers["x-client-token"] || req.query.token;
  if (!token || !clientSessions.has(token)) return res.status(401).json({ error: "Unauthenticated" });
  const { jobId } = req.body;
  const session = clientSessions.get(token);
  const job = session.jobs.find(j => j.id === jobId);
  if (!job) return res.status(404).json({ error: "Job not found" });

  if (job.status !== "SCHEDULED") {
    return res.status(400).json({ error: `Job is currently ${job.status}, not SCHEDULED.` });
  }

  job.status = "RUNNING";
  job.logs = job.logs || [];
  job.logs.push(`[${new Date().toLocaleTimeString()}] ⚡ Manually triggered by user ahead of schedule.`);
  runClientWorker(job, session);
  res.json({ success: true, message: "Job launched immediately", job });
});

// Client Pause Job
app.post("/api/client/pause", async (req, res) => {
  const token = req.headers["x-client-token"] || req.query.token;
  if (!token || !clientSessions.has(token)) return res.status(401).json({ error: "Unauthenticated" });
  const { jobId } = req.body;
  const session = clientSessions.get(token);
  const job = session.jobs.find(j => j.id === jobId);
  if (!job) return res.status(404).json({ error: "Job not found" });

  job.status = "PAUSED";
  job.logs.push(`[${new Date().toLocaleTimeString()}] ⏸️ Transfer paused by user.`);
  if (activeJobs.has(jobId)) {
    activeJobs.get(jobId).paused = true;
  }
  res.json({ success: true, message: "Transfer paused", job });
});

// Client Resume Job
app.post("/api/client/resume", async (req, res) => {
  const token = req.headers["x-client-token"] || req.query.token;
  if (!token || !clientSessions.has(token)) return res.status(401).json({ error: "Unauthenticated" });
  const { jobId, twoStepCode, code, pin } = req.body;
  const session = clientSessions.get(token);
  const job = session.jobs.find(j => j.id === jobId);
  if (!job) return res.status(404).json({ error: "Job not found" });

  const providedCode = pin || twoStepCode || code;
  if (providedCode) {
    const cleanCode = String(providedCode).trim();

    // Only call /api/auth/2fa if the job specifically paused for a 2FA Authenticator/Email challenge
    if (job.twoStepType === "2fa") {
      try {
        const twoFaRes = await fetch("https://lagoslife.app/api/auth/2fa", {
          method: "POST",
          headers: {
            cookie: session.account.cookie,
            "content-type": "application/json",
            "origin": "https://lagoslife.app",
            "referer": "https://lagoslife.app/",
            "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36"
          },
          body: JSON.stringify({ action: "step", code: cleanCode })
        });
        const twoFaData = await twoFaRes.json().catch(() => ({}));

        if (twoFaRes.ok) {
          const newCookies = (typeof twoFaRes.headers.getSetCookie === "function" ? twoFaRes.headers.getSetCookie() : [])
            .map(c => c.split(";")[0]);
          if (newCookies.length) {
            session.account.cookie = mergeCookies(session.account.cookie, newCookies);
          }
          job.logs.push(`[${new Date().toLocaleTimeString()}] 🛡️ Two-Step 2FA verified with LagosLife! Session elevated ✅`);
          job.twoStepCode = cleanCode;
          session.account.twoStepCode = cleanCode;
          job.needsTwoStep = false;
          job.twoStepType = null;
        } else if (twoFaData.error && (twoFaData.error.toLowerCase().includes("code") || twoFaData.error.toLowerCase().includes("expired"))) {
          job.logs.push(`[${new Date().toLocaleTimeString()}] ❌ Two-step 2FA verification failed: ${twoFaData.error}`);
          return res.status(400).json({ error: twoFaData.error, job });
        } else {
          // Fallback: treat as PIN if 2FA endpoint wasn't expecting a step code
          job.pin = cleanCode;
          session.account.pin = cleanCode;
          job.needsTwoStep = false;
          job.twoStepType = null;
        }
      } catch (err) {
        console.error("2FA step error:", err.message);
        job.twoStepCode = cleanCode;
        session.account.twoStepCode = cleanCode;
        job.needsTwoStep = false;
        job.twoStepType = null;
      }
    } else {
      // Transaction PIN — save once for the entire session and all bulk chunks
      job.pin = cleanCode;
      session.account.pin = cleanCode;
      job.needsTwoStep = false;
      job.twoStepType = null;
      job.logs.push(`[${new Date().toLocaleTimeString()}] 🔒 Transaction PIN saved (${cleanCode.replace(/./g, "•")}) — all remaining chunks will send automatically ✅`);
    }
  }

  // Enforce proper 100B chunks on resume (skip for spray jobs so stack size & count stay intact)
  if (job.type !== "spray" && job.type !== "SPRAY") {
    job.chunkSize = Math.min(job.chunkSize || MAX_TRANSFER_CHUNK, MAX_TRANSFER_CHUNK);
    if (job.type !== "batch" && job.type !== "BATCH") {
      job.totalTxs = Math.ceil(job.total / job.chunkSize);
    }
  }
  job.status = "RUNNING";
  job.logs.push(`[${new Date().toLocaleTimeString()}] ▶️ ${job.type === "spray" ? "Auto-Sprayer" : "Transfer"} resumed.`);
  if (activeJobs.has(jobId)) {
    activeJobs.get(jobId).paused = false;
  } else if (job.remaining > 0 || (job.type === "spray" && (job.txCount || 0) < (job.totalTxs || 100))) {
    runClientWorker(job, session);
  }
  res.json({ success: true, message: "Transfer resumed", job });
});

// Official LagosLife Party Spray Stacks (module 6332 SPRAY_STACKS)
function resolveSprayStack(raw) {
  const validStacks = [
    { id: "k1",   amount: 1000,       label: "₦1K" },
    { id: "k5",   amount: 5000,       label: "₦5K" },
    { id: "k50",  amount: 50000,      label: "₦50K" },
    { id: "k500", amount: 500000,     label: "₦500K" },
    { id: "m5",   amount: 5000000,    label: "₦5M" },
    { id: "m50",  amount: 50000000,   label: "₦50M" },
    { id: "b1",   amount: 1000000000, label: "₦1B" }
  ];
  if (typeof raw === "string") {
    const clean = raw.trim().toLowerCase();
    const byId = validStacks.find((s) => s.id === clean);
    if (byId) return byId;
  }
  const num = Number(raw) || 1000000000;
  let best = validStacks[validStacks.length - 1];
  let bestDiff = Infinity;
  for (const s of validStacks) {
    const diff = Math.abs(s.amount - num);
    if (diff <= bestDiff) {
      bestDiff = diff;
      best = s;
    }
  }
  return best;
}

// Helper: Automatically knock/enter house or RSVP/enter venue so /api/spray/party succeeds
async function ensureInPartyOrVenue(cookie, { partyKind, hostId, venueId, eventCode }) {
  const reqHeaders = {
    cookie,
    "content-type": "application/json",
    accept: "application/json",
    origin: "https://lagoslife.app",
    referer: "https://lagoslife.app/",
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36"
  };

  try {
    if (eventCode) {
      await fetch("https://lagoslife.app/api/events", {
        method: "POST",
        headers: reqHeaders,
        body: JSON.stringify({ action: "rsvp", code: eventCode, going: true })
      }).catch(() => null);
    }

    if (partyKind === "house" && hostId) {
      await fetch(`https://lagoslife.app/api/homes/${encodeURIComponent(hostId)}/knock`, {
        method: "POST",
        headers: reqHeaders
      }).catch(() => null);
      await fetch(`https://lagoslife.app/api/homes/${encodeURIComponent(hostId)}`, {
        method: "GET",
        headers: reqHeaders
      }).catch(() => null);
      const feedRes = await fetch(`https://lagoslife.app/api/spray/party?host=${encodeURIComponent(hostId)}`, {
        headers: reqHeaders
      }).catch(() => null);
      if (feedRes && feedRes.ok) {
        return await feedRes.json().catch(() => null);
      }
    } else if (partyKind === "venue" && venueId) {
      const feedRes = await fetch(`https://lagoslife.app/api/spray/party?at=${encodeURIComponent(venueId)}`, {
        headers: reqHeaders
      }).catch(() => null);
      if (feedRes && feedRes.ok) {
        return await feedRes.json().catch(() => null);
      }
    }
  } catch {}
  return null;
}

// Helper: Fetch active events from /api/events for smart host/venue matching
async function fetchActiveEventsList(cookie) {
  try {
    const res = await fetch("https://lagoslife.app/api/events", {
      headers: {
        cookie,
        accept: "application/json",
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36"
      }
    });
    if (!res.ok) return [];
    const data = await res.json().catch(() => ({}));
    const rawList = [
      ...(Array.isArray(data.hosting) ? data.hosting : []),
      ...(Array.isArray(data.invites) ? data.invites : []),
      ...(Array.isArray(data.going) ? data.going : [])
    ];
    const seen = new Set();
    const events = [];
    const now = Date.now();
    for (const ev of rawList) {
      if (!ev || !ev.code || seen.has(ev.code)) continue;
      seen.add(ev.code);
      const isVenue = Boolean(ev.place && ev.place !== "home");
      const startsAt = Number(ev.startsAt) || 0;
      const minsUntil = startsAt ? Math.round((startsAt - now) / 60000) : 0;
      events.push({
        code: ev.code,
        kind: ev.kind || "party",
        title: ev.title || "Party",
        status: ev.status || "on",
        place: ev.place || "home",
        placeLabel: ev.placeLabel || (isVenue ? ev.place : "House"),
        placeEmoji: ev.placeEmoji || (isVenue ? "🍾" : "🏠"),
        placeArea: ev.placeArea || "",
        partyKind: isVenue ? "venue" : "house",
        hostOrVenue: isVenue ? ev.place : (ev.host?.username || ev.host?.id || ""),
        startsAt,
        minsUntil,
        isLiveNow: minsUntil <= 15,
        host: ev.host ? { id: ev.host.id, username: ev.host.username } : null,
        cohost: ev.cohost ? { id: ev.cohost.id, username: ev.cohost.username } : null
      });
    }
    return events;
  } catch {
    return [];
  }
}

// Client Auto-Sprayer (Party Money Gun)
app.post("/api/client/spray", async (req, res) => {
  try {
    const token = req.headers["x-client-token"] || req.query.token;
    if (!token || !clientSessions.has(token)) return res.status(401).json({ error: "Unauthenticated" });

    const session = clientSessions.get(token);
    const { partyKind, hostOrVenue, target, stackAmount, stackId, count, delayMs, pin, twoStepCode, rawPayload, eventCode } = req.body || {};

    const cleanPin = pin ? String(pin).trim() : (session.account.pin || null);
    const cleanTwoStep = twoStepCode ? String(twoStepCode).trim() : (session.account.twoStepCode || null);
    if (cleanPin) session.account.pin = cleanPin;
    if (cleanTwoStep) session.account.twoStepCode = cleanTwoStep;

    let parsedRaw = null;
    if (rawPayload && typeof rawPayload === "object") {
      parsedRaw = rawPayload;
    } else if (typeof rawPayload === "string" && rawPayload.trim().startsWith("{")) {
      try {
        parsedRaw = JSON.parse(rawPayload.trim());
      } catch (e) {
        return res.status(400).json({ error: "Invalid Raw JSON payload format" });
      }
    }

    let kind = partyKind === "venue" ? "venue" : "house";
    let resolvedHostId = "";
    let resolvedHostLabel = "";
    let resolvedTargetId = "";
    let resolvedTargetLabel = "";
    let matchedEvent = null;

    // Fetch live /api/events so if the user typed a host/cohost @username or venue/event code, we auto-configure house vs venue!
    const liveEvents = await fetchActiveEventsList(session.account.cookie);

    if (parsedRaw) {
      resolvedTargetId = parsedRaw.to || "party-target";
      resolvedTargetLabel = parsedRaw.to ? `ID: ${parsedRaw.to}` : "Party Target";
      resolvedHostId = parsedRaw.host || parsedRaw.at || "party";
      resolvedHostLabel = parsedRaw.host ? `Host ${parsedRaw.host}` : `Venue ${parsedRaw.at || ""}`;
      kind = parsedRaw.at ? "venue" : "house";
    } else {
      const cleanInput = String(hostOrVenue || "").trim().replace(/^@/, "");
      const cleanTargetInput = String(target || "").trim().replace(/^@/, "");

      if (!cleanInput && !cleanTargetInput) {
        return res.status(400).json({ error: kind === "venue" ? "Club / Venue ID is required" : "Party Host @username or ID is required" });
      }

      // Check if input or target matches any event in /api/events (by code, place, host username/id, or cohost username/id)
      const lowerInput = cleanInput.toLowerCase();
      const lowerTarget = cleanTargetInput.toLowerCase();
      matchedEvent = liveEvents.find((ev) => {
        if (eventCode && ev.code === eventCode) return true;
        if (lowerInput && (
          ev.code.toLowerCase() === lowerInput ||
          (ev.place && ev.place.toLowerCase() === lowerInput && ev.place !== "home") ||
          ev.host?.username?.toLowerCase() === lowerInput ||
          ev.host?.id === cleanInput ||
          ev.cohost?.username?.toLowerCase() === lowerInput ||
          ev.cohost?.id === cleanInput
        )) return true;
        if (lowerTarget && (
          ev.host?.username?.toLowerCase() === lowerTarget ||
          ev.host?.id === cleanTargetInput ||
          ev.cohost?.username?.toLowerCase() === lowerTarget ||
          ev.cohost?.id === cleanTargetInput
        )) return true;
        return false;
      });

      // If matchedEvent is at a venue (e.g. boatCruise, lagRoyalHall, abjAsokoroHall), automatically use venue mode ({ at: ev.place })!
      if (matchedEvent && matchedEvent.partyKind === "venue") {
        kind = "venue";
        resolvedHostId = matchedEvent.place;
        resolvedHostLabel = `${matchedEvent.placeEmoji} ${matchedEvent.placeLabel} (${matchedEvent.title})`;
      } else if (matchedEvent && matchedEvent.partyKind === "house" && matchedEvent.host?.id) {
        kind = "house";
        resolvedHostId = matchedEvent.host.id;
        resolvedHostLabel = `@${matchedEvent.host.username} (${matchedEvent.title})`;
      } else if (kind === "house") {
        const hostRes = await resolveTargetIdAsync(cleanInput || cleanTargetInput, session.account.cookie);
        if (!hostRes || !hostRes.id) {
          return res.status(400).json({ error: `Could not resolve Party Host "${hostOrVenue}". Try pasting their 20-character ID or tap an active event card.` });
        }
        resolvedHostId = hostRes.id;
        resolvedHostLabel = `@${hostRes.username || cleanInput}`;
      } else {
        resolvedHostId = cleanInput;
        resolvedHostLabel = cleanInput;
      }

      // Resolve who to spray (celebrant / host / cohost / guest)
      if (!cleanTargetInput) {
        if (matchedEvent) {
          // If the user typed the cohost's username into the host box, spray the cohost; otherwise spray the host
          if (lowerInput && matchedEvent.cohost?.username?.toLowerCase() === lowerInput) {
            resolvedTargetId = matchedEvent.cohost.id;
            resolvedTargetLabel = `@${matchedEvent.cohost.username} (Celebrant)`;
          } else if (matchedEvent.host?.id) {
            resolvedTargetId = matchedEvent.host.id;
            resolvedTargetLabel = `@${matchedEvent.host.username} (Celebrant)`;
          }
        }
        if (!resolvedTargetId && kind === "house") {
          resolvedTargetId = resolvedHostId;
          resolvedTargetLabel = `${resolvedHostLabel} (Host)`;
        }
        if (!resolvedTargetId && kind === "venue") {
          return res.status(400).json({ error: "Please enter the @username of the Celebrant/Player you want to spray at the venue" });
        }
      } else {
        if (matchedEvent && matchedEvent.host?.username?.toLowerCase() === lowerTarget) {
          resolvedTargetId = matchedEvent.host.id;
          resolvedTargetLabel = `@${matchedEvent.host.username}`;
        } else if (matchedEvent && matchedEvent.cohost?.username?.toLowerCase() === lowerTarget) {
          resolvedTargetId = matchedEvent.cohost.id;
          resolvedTargetLabel = `@${matchedEvent.cohost.username}`;
        } else {
          const targRes = await resolveTargetIdAsync(cleanTargetInput, session.account.cookie);
          if (!targRes || !targRes.id) {
            return res.status(400).json({ error: `Could not resolve spray target "${target}". Check the @username spelling.` });
          }
          resolvedTargetId = targRes.id;
          resolvedTargetLabel = `@${targRes.username || cleanTargetInput}`;
        }
      }
    }

    // Pre-join / knock house or RSVP event automatically
    const feedInfo = await ensureInPartyOrVenue(session.account.cookie, {
      partyKind: kind,
      hostId: kind === "house" ? resolvedHostId : (matchedEvent?.host?.id || null),
      venueId: kind === "venue" ? resolvedHostId : null,
      eventCode: matchedEvent?.code || eventCode || null
    });

    const totalSprays = Math.max(1, Math.min(Number(count) || 100, 10000));
    const stackObj = resolveSprayStack(parsedRaw?.stack || stackId || stackAmount || 1000000000);
    const numericStack = stackObj.amount;
    const totalNaira = totalSprays * numericStack;
    const speedMs = Math.max(100, Number(delayMs) || 350);

    const initialLogs = [
      `[${new Date().toLocaleTimeString()}] 💸 Money Gun armed: ${totalSprays}x sprays of ${stackObj.label} [stack="${stackObj.id}"] (Total: ₦${totalNaira.toLocaleString()}) on ${resolvedTargetLabel} at ${resolvedHostLabel}`,
      ...(matchedEvent ? [`[${new Date().toLocaleTimeString()}] 🎉 Matched Event: "${matchedEvent.title}" (${matchedEvent.partyKind === "venue" ? `Venue: ${matchedEvent.place}` : `House Host: @${matchedEvent.host?.username}`})`] : []),
      ...(matchedEvent && !matchedEvent.isLiveNow && matchedEvent.minsUntil > 0
        ? [`[${new Date().toLocaleTimeString()}] ⏰ Note: "${matchedEvent.title}" is scheduled to start in ~${Math.floor(matchedEvent.minsUntil / 60)}h ${matchedEvent.minsUntil % 60}m. LagosLife only unlocks spraying once the event starts.`]
        : []),
      ...(cleanPin ? [`[${new Date().toLocaleTimeString()}] 🔒 Transaction PIN attached for automatic non-stop spraying.`] : [])
    ];

    const jobId = `cjob_spray_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const job = {
      id: jobId,
      type: "spray",
      partyKind: kind,
      hostOrVenue: resolvedHostId,
      hostId: resolvedHostId,
      hostLabel: resolvedHostLabel,
      eventCode: matchedEvent?.code || eventCode || null,
      alternateHostId: matchedEvent?.host?.id || null,
      alternateVenue: matchedEvent?.place !== "home" ? matchedEvent?.place : null,
      target: resolvedTargetId,
      targetLabel: `💸 ${resolvedTargetLabel}`,
      stackId: stackObj.id,
      stackValue: stackObj.id,
      rawPayload: parsedRaw,
      chunkSize: numericStack,
      totalTxs: totalSprays,
      txCount: 0,
      total: totalNaira,
      remaining: totalNaira,
      delayMs: speedMs,
      pin: cleanPin,
      twoStepCode: cleanTwoStep,
      status: "RUNNING",
      createdAt: new Date().toISOString(),
      logs: initialLogs
    };

    session.jobs.unshift(job);
    runClientWorker(job, session);
    return res.json({ success: true, message: "Auto-Sprayer started!", job, matchedEvent, feedInfo });
  } catch (err) {
    console.error("Spray endpoint error:", err);
    return res.status(500).json({ error: err.message || "Failed to start Auto-Sprayer" });
  }
});

// Auto-detect active party / venue / live events from /api/save, /api/events, and /api/homes
app.get("/api/client/detect-party", async (req, res) => {
  const token = req.headers["x-client-token"] || req.query.token;
  if (!token || !clientSessions.has(token)) return res.status(401).json({ error: "Unauthenticated" });
  const session = clientSessions.get(token);

  try {
    const reqHeaders = {
      cookie: session.account.cookie,
      accept: "application/json",
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36"
    };
    const [saveRes, events, homesRes] = await Promise.all([
      fetch("https://lagoslife.app/api/save", { headers: reqHeaders }).catch(() => null),
      fetchActiveEventsList(session.account.cookie),
      fetch("https://lagoslife.app/api/homes", { headers: reqHeaders }).catch(() => null)
    ]);

    const data = saveRes && saveRes.ok ? await saveRes.json().catch(() => ({})) : {};
    const homesData = homesRes && homesRes.ok ? await homesRes.json().catch(() => ({})) : {};
    const g = data?.game || {};

    let partyHost = g.visitingHouse || g.partyHost || g.atHouse || g.party?.host || null;
    const rawLoc = g.venue || g.atVenue || g.party?.venue || (g.location && g.location !== "home" ? g.location : null);
    let venue = rawLoc || null;
    let detectedEvent = null;

    // Check if any event is currently live or matches current venue/host
    const liveEvent = events.find((e) => e.isLiveNow) || events[0] || null;
    if (venue) {
      detectedEvent = events.find((e) => e.place === venue) || null;
    }
    if (!partyHost && !venue && liveEvent) {
      detectedEvent = liveEvent;
      if (liveEvent.partyKind === "venue") {
        venue = liveEvent.place;
      } else if (liveEvent.host?.username) {
        partyHost = liveEvent.host.username;
      }
    }

    const activeHomes = (Array.isArray(homesData?.homes) ? homesData.homes : [])
      .filter((h) => h && h.atHome)
      .slice(0, 12)
      .map((h) => ({
        id: h.id,
        username: h.username,
        home: h.home
      }));

    return res.json({
      success: true,
      partyHost,
      venue,
      detectedEvent,
      events,
      activeHomes,
      username: data?.account?.username || session.account.user,
      balance: g.money ?? 0
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Client Resend 2FA Email Code
app.post("/api/client/resend-code", async (req, res) => {
  const token = req.headers["x-client-token"] || req.query.token;
  if (!token || !clientSessions.has(token)) return res.status(401).json({ error: "Unauthenticated" });
  const session = clientSessions.get(token);

  try {
    const r = await fetch("https://lagoslife.app/api/auth/2fa", {
      method: "POST",
      headers: {
        cookie: session.account.cookie,
        "content-type": "application/json",
        accept: "application/json",
        "origin": "https://lagoslife.app",
        "referer": "https://lagoslife.app/",
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36"
      },
      body: JSON.stringify({ action: "send" })
    });
    const data = await r.json().catch(() => ({}));
    if (r.ok) {
      return res.json({ success: true, message: data.to ? `2FA code sent to ${data.to}` : "2FA code sent to your email!" });
    } else {
      return res.status(r.status).json({ error: data.error || "Failed to trigger email code" });
    }
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Client Stop Job
app.post("/api/client/stop", async (req, res) => {
  const token = req.headers["x-client-token"] || req.query.token;
  if (!token || !clientSessions.has(token)) return res.status(401).json({ error: "Unauthenticated" });
  const { jobId } = req.body;
  const session = clientSessions.get(token);
  const job = session.jobs.find(j => j.id === jobId);
  if (!job) return res.status(404).json({ error: "Job not found" });

  job.status = "CANCELLED";
  job.needsTwoStep = false;
  job.logs.push(`[${new Date().toLocaleTimeString()}] ⏹️ Transfer cancelled by user.`);
  if (activeJobs.has(jobId)) {
    activeJobs.get(jobId).cancelled = true;
    activeJobs.delete(jobId);
  }
  res.json({ success: true, message: "Transfer cancelled", job });
});

// Client Dismiss Job
app.post("/api/client/dismiss", async (req, res) => {
  const token = req.headers["x-client-token"] || req.query.token;
  if (!token || !clientSessions.has(token)) return res.status(401).json({ error: "Unauthenticated" });
  const { jobId } = req.body;
  const session = clientSessions.get(token);
  const idx = session.jobs.findIndex(j => j.id === jobId);
  if (idx !== -1) {
    if (activeJobs.has(jobId)) {
      activeJobs.get(jobId).cancelled = true;
      activeJobs.delete(jobId);
    }
    session.jobs.splice(idx, 1);
  }
  res.json({ success: true, message: "Job dismissed" });
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

// -------------------------------------------------------------
// LagosGist Private Fleet Command Center (/lagosgist)
// -------------------------------------------------------------
const BATCH_64_FILE = path.join(DATA_DIR, "batch_accounts_64_sessions.json");
const FLEET_ALL_FILE = path.join(DATA_DIR, "followers_fleet_all.json");
const gistJobs = [];
const activeGistWorkers = new Map();

app.get("/lagosgist", (req, res) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.sendFile(path.join(PRIVATE_ADMIN_DIR, "lagosgist.html"));
});

app.post("/api/gist-bot/auth", (req, res) => {
  const { passcode } = req.body;
  if (!passcode || passcode !== ADMIN_PASSCODE) {
    return res.status(401).json({ error: "Invalid master passcode." });
  }
  const token = "adm_" + crypto.randomBytes(32).toString("hex");
  adminSessions.set(token, { createdAt: Date.now(), ip: req.ip });
  res.setHeader("Set-Cookie", `ll_admin_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${7 * 24 * 3600}`);
  res.json({ success: true, token });
});

async function loadCombinedGistFleet() {
  const mainAccs = await readJson(ACCOUNTS_FILE, []);
  const fleetAll = await readJson(FLEET_ALL_FILE, []);
  const batchAccs = await readJson(BATCH_64_FILE, []);
  const combined = [];
  const seen = new Set();

  for (const a of mainAccs) {
    const uname = (a.user || a.name || a.id || "").replace(/^@/, "").trim();
    const key = uname.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    combined.push({
      username: uname,
      cookie: a.cookie || "",
      source: "registry"
    });
  }

  for (const f of fleetAll) {
    const uname = (f.username || f.user || "").replace(/^@/, "").trim();
    const key = uname.toLowerCase();
    if (!uname || seen.has(key)) continue;
    seen.add(key);
    combined.push({
      username: uname,
      cookie: f.cookie || "",
      source: "fleet"
    });
  }

  for (const b of batchAccs) {
    const uname = (b.username || "").replace(/^@/, "").trim();
    const key = uname.toLowerCase();
    if (!uname || seen.has(key)) continue;
    seen.add(key);
    combined.push({
      username: uname,
      password: b.password || "",
      cookie: b.cookie || "",
      source: "fleet64"
    });
  }

  return combined;
}

async function fetchAllGistPostsForUser(userId, authCookieOrCandidates, maxPosts = 200) {
  const candidateCookies = Array.isArray(authCookieOrCandidates)
    ? authCookieOrCandidates.map(a => (typeof a === "string" ? a : a.cookie)).filter(Boolean)
    : [authCookieOrCandidates].filter(Boolean);

  let allPosts = [];

  for (let cIdx = 0; cIdx < Math.min(candidateCookies.length, 6); cIdx++) {
    const activeCookie = candidateCookies[cIdx];
    allPosts = [];
    let before = null;
    let success = false;

    while (allPosts.length < maxPosts) {
      const url = `https://lagoslife.app/api/gist?feed=user&of=${encodeURIComponent(userId)}${before ? `&before=${before}` : ""}`;
      const res = await fetch(url, {
        headers: {
          cookie: activeCookie || "",
          "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36",
          accept: "application/json, text/plain, */*"
        }
      });
      if (res.status === 401) break; // try next candidate cookie
      if (!res.ok) break;
      const data = await res.json().catch(() => ({}));
      if (!data.posts) break;
      success = true;
      if (data.posts.length === 0) break;

      allPosts.push(...data.posts);
      const last = data.posts[data.posts.length - 1];
      if (before === last.at) break;
      before = last.at;
      if (data.posts.length < 30) break;
    }

    if (success) break;
  }

  return allPosts.slice(0, maxPosts);
}

async function callGistApi(cookie, body) {
  const res = await fetch("https://lagoslife.app/api/gist", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie,
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36",
      origin: "https://lagoslife.app",
      referer: "https://lagoslife.app/"
    },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

app.get("/api/gist-bot/fleet", requireAdminAuth, async (req, res) => {
  const fleet = await loadCombinedGistFleet();
  const ready = fleet.filter(a => Boolean(a.cookie));
  res.json({
    totalAccounts: fleet.length,
    readyAccounts: ready.length,
    accounts: fleet.map(a => ({
      username: a.username,
      hasCookie: Boolean(a.cookie),
      source: a.source
    })),
    jobs: gistJobs.slice(0, 15)
  });
});

app.post("/api/gist-bot/refresh-fleet", requireAdminAuth, async (req, res) => {
  const batchAccs = await readJson(BATCH_64_FILE, []);
  let activeCount = 0;
  let reloggedCount = 0;

  for (const acc of batchAccs) {
    try {
      const meRes = await fetch("https://lagoslife.app/api/auth/me", {
        headers: { cookie: acc.cookie || "", "user-agent": "Mozilla/5.0" }
      });
      const meData = await meRes.json().catch(() => ({}));
      if (meRes.ok && meData.user) {
        activeCount++;
        continue;
      }

      if (acc.username && acc.password) {
        const loginRes = await fetch("https://lagoslife.app/api/auth/login", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: "https://lagoslife.app",
            referer: "https://lagoslife.app/",
            "user-agent": "Mozilla/5.0"
          },
          body: JSON.stringify({ username: acc.username, password: acc.password })
        });
        if (loginRes.ok) {
          const setCookies = typeof loginRes.headers.getSetCookie === "function" ? loginRes.headers.getSetCookie() : [];
          const cookieStr = setCookies.map(c => c.split(";")[0]).join("; ");
          if (cookieStr) {
            acc.cookie = cookieStr;
            reloggedCount++;
            activeCount++;
          }
        }
      }
    } catch {}
  }

  await writeJson(BATCH_64_FILE, batchAccs);
  res.json({ success: true, activeCount, reloggedCount });
});

app.post("/api/gist-bot/inspect-user", requireAdminAuth, async (req, res) => {
  const { target } = req.body;
  if (!target) return res.status(400).json({ error: "Target @username or ID required" });

  const fleet = await loadCombinedGistFleet();
  const validCandidates = fleet.filter(a => Boolean(a.cookie));
  if (validCandidates.length === 0) {
    return res.status(400).json({ error: "No fleet accounts have active cookies" });
  }

  // Use fresh fleet cookies first
  const reversedCandidates = [...validCandidates].reverse();
  const authCookie = reversedCandidates[0]?.cookie || "";
  const resolved = await resolveTargetIdAsync(target, authCookie);
  if (!resolved || !resolved.id) {
    return res.status(404).json({ error: `Could not find player "${target}"` });
  }

  const posts = await fetchAllGistPostsForUser(resolved.id, reversedCandidates, 150);
  const resolvedUsername = posts[0]?.username || resolved.username || target.replace(/^@/, "");
  res.json({
    success: true,
    userId: resolved.id,
    username: resolvedUsername,
    posts
  });
});

app.post("/api/gist-bot/dominate-user", requireAdminAuth, async (req, res) => {
  const {
    target,
    accountLimit = 74,
    postLimit = "all",
    doFollow = true,
    doLike = true,
    doRegist = false,
    doComment = false,
    commentCount = 15,
    commentTargetMode = "spread",
    comments = []
  } = req.body;

  if (!target) return res.status(400).json({ error: "Target @username or ID required" });

  const fleet = (await loadCombinedGistFleet()).filter(a => a.cookie);
  if (fleet.length === 0) return res.status(400).json({ error: "No fleet accounts have active cookies" });

  const selectedAccounts = fleet.slice(0, Math.max(1, Number(accountLimit) || fleet.length));
  const resolved = await resolveTargetIdAsync(target, selectedAccounts[0].cookie);
  if (!resolved || !resolved.id) {
    return res.status(404).json({ error: `Could not resolve player "${target}"` });
  }

  const allPosts = await fetchAllGistPostsForUser(resolved.id, selectedAccounts, 200);
  const maxP = postLimit === "all" ? allPosts.length : Math.min(allPosts.length, Number(postLimit) || allPosts.length);
  const posts = allPosts.slice(0, maxP);
  const usernameLabel = allPosts[0]?.username || resolved.username || target.replace(/^@/, "");

  const jobId = `gist_dom_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const job = {
    id: jobId,
    title: `🎯 Dominate @${usernameLabel} (${selectedAccounts.length} accs · ${posts.length} posts)`,
    status: "RUNNING",
    totalSteps: selectedAccounts.length,
    completedSteps: 0,
    stats: { follows: 0, likes: 0, regists: 0, comments: 0, posts: 0 },
    logs: [
      `[${new Date().toLocaleTimeString()}] 🚀 Launching Turbo Profile Domination on @${usernameLabel} (${resolved.id})`,
      `[${new Date().toLocaleTimeString()}] 📋 Discovered ${posts.length} posts. Armed ${selectedAccounts.length} accounts.`
    ]
  };

  gistJobs.unshift(job);
  const workerState = { cancelled: false };
  activeGistWorkers.set(jobId, workerState);

  (async () => {
    try {
      const CONCURRENCY = 15;
      let cursor = 0;

      while (cursor < selectedAccounts.length && !workerState.cancelled) {
        const chunkAccs = selectedAccounts.slice(cursor, cursor + CONCURRENCY);
        await Promise.all(
          chunkAccs.map(async (acc) => {
            if (workerState.cancelled) return;

            if (doFollow) {
              const fRes = await callGistApi(acc.cookie, { action: "follow", id: resolved.id, on: true });
              if (fRes.ok) job.stats.follows++;
            }

            if (doLike && posts.length > 0) {
              const batchSize = 10;
              for (let i = 0; i < posts.length; i += batchSize) {
                if (workerState.cancelled) break;
                const pSlice = posts.slice(i, i + batchSize);
                const results = await Promise.allSettled(
                  pSlice.map(p => callGistApi(acc.cookie, { action: "like", id: p.id, on: true }))
                );
                for (const r of results) {
                  if (r.status === "fulfilled" && r.value?.ok) job.stats.likes++;
                }
              }
            }

            if (doRegist && posts.length > 0) {
              const regSlice = posts.slice(0, Math.min(posts.length, 10));
              const results = await Promise.allSettled(
                regSlice.map(p => callGistApi(acc.cookie, { action: "regist", id: p.id, on: true }))
              );
              for (const r of results) {
                if (r.status === "fulfilled" && r.value?.ok) job.stats.regists++;
              }
            }

            job.completedSteps++;
            job.logs.push(`[${new Date().toLocaleTimeString()}] ⚡ @${acc.username}: Followed & liked ${posts.length} posts ✅`);
          })
        );
        cursor += chunkAccs.length;
      }

      // Optional Comments Wave
      if (doComment && posts.length > 0 && comments.length > 0 && !workerState.cancelled) {
        const totalCommentsToDrop = Math.min(Number(commentCount) || 15, selectedAccounts.length);
        job.logs.push(`[${new Date().toLocaleTimeString()}] 💬 Dropping ${totalCommentsToDrop} comments on @${usernameLabel}'s posts...`);

        for (let cIdx = 0; cIdx < totalCommentsToDrop; cIdx++) {
          if (workerState.cancelled) break;
          const acc = selectedAccounts[cIdx % selectedAccounts.length];
          const commentText = comments[cIdx % comments.length];

          let targetPost = posts[0];
          if (commentTargetMode === "top3") {
            targetPost = posts[cIdx % Math.min(3, posts.length)];
          } else if (commentTargetMode === "spread") {
            targetPost = posts[cIdx % posts.length];
          }

          if (targetPost && commentText) {
            const cRes = await callGistApi(acc.cookie, {
              action: "comment",
              id: targetPost.id,
              text: commentText
            });
            if (cRes.ok) {
              job.stats.comments++;
              job.logs.push(`[${new Date().toLocaleTimeString()}] 💬 @${acc.username} commented: "${commentText}"`);
            }
            await sleep(250);
          }
        }
      }

      job.status = workerState.cancelled ? "CANCELLED" : "COMPLETED";
      job.logs.push(
        `[${new Date().toLocaleTimeString()}] 🏁 Finished! +${job.stats.follows} Follows, +${job.stats.likes} Likes, +${job.stats.regists} Regists, +${job.stats.comments} Comments.`
      );
    } catch (err) {
      job.status = "CANCELLED";
      job.logs.push(`[${new Date().toLocaleTimeString()}] ❌ Error: ${err.message}`);
    } finally {
      activeGistWorkers.delete(jobId);
    }
  })();

  res.json({ success: true, job });
});

app.post("/api/gist-bot/mass-post", requireAdminAuth, async (req, res) => {
  const { rawText, accountCount = 10, delayMs = 800, mode = "cycle" } = req.body;
  if (!rawText || !String(rawText).trim()) {
    return res.status(400).json({ error: "Post text required" });
  }

  const fleet = (await loadCombinedGistFleet()).filter(a => a.cookie);
  const selected = fleet.slice(0, Math.max(1, Math.min(Number(accountCount) || 10, fleet.length)));
  const lines = String(rawText).split("\n").map(s => s.trim()).filter(Boolean);

  const jobId = `gist_post_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const job = {
    id: jobId,
    title: `📢 Mass Fleet Post (${selected.length} accounts)`,
    status: "RUNNING",
    totalSteps: selected.length,
    completedSteps: 0,
    stats: { follows: 0, likes: 0, regists: 0, comments: 0, posts: 0 },
    logs: [`[${new Date().toLocaleTimeString()}] 📢 Publishing Gist posts across ${selected.length} accounts...`]
  };

  gistJobs.unshift(job);
  const workerState = { cancelled: false };
  activeGistWorkers.set(jobId, workerState);

  (async () => {
    try {
      for (let i = 0; i < selected.length; i++) {
        if (workerState.cancelled) break;
        const acc = selected[i];

        let textToPost = String(rawText).trim();
        if (mode === "cycle" && lines.length > 0) {
          textToPost = lines[i % lines.length];
        } else if (mode === "random" && lines.length > 0) {
          textToPost = lines[Math.floor(Math.random() * lines.length)];
        }

        const pRes = await callGistApi(acc.cookie, {
          action: "post",
          text: textToPost,
          chip: null
        });

        job.completedSteps++;
        if (pRes.ok) {
          job.stats.posts++;
          job.logs.push(`[${new Date().toLocaleTimeString()}] ✅ @${acc.username} posted: "${textToPost.slice(0, 50)}"`);
        } else {
          job.logs.push(`[${new Date().toLocaleTimeString()}] ⚠️ @${acc.username} failed (${pRes.status}): ${pRes.data?.error || "Error"}`);
        }

        if (Number(delayMs) > 0 && i < selected.length - 1 && !workerState.cancelled) {
          await sleep(Number(delayMs));
        }
      }

      job.status = workerState.cancelled ? "CANCELLED" : "COMPLETED";
      job.logs.push(`[${new Date().toLocaleTimeString()}] 🏁 Mass Posting Complete! ${job.stats.posts}/${selected.length} posts published.`);
    } catch (err) {
      job.status = "CANCELLED";
      job.logs.push(`[${new Date().toLocaleTimeString()}] ❌ Error: ${err.message}`);
    } finally {
      activeGistWorkers.delete(jobId);
    }
  })();

  res.json({ success: true, job });
});

app.post("/api/gist-bot/single-post-raid", requireAdminAuth, async (req, res) => {
  const { postId, likeCount = 70, commentCount = 10, doLike = true, doRegist = true, comments = [] } = req.body;
  if (!postId || !String(postId).trim()) {
    return res.status(400).json({ error: "Target Post ID required" });
  }

  const cleanPostId = String(postId).trim();
  const fleet = (await loadCombinedGistFleet()).filter(a => a.cookie);
  const likeAccs = fleet.slice(0, Math.max(1, Math.min(Number(likeCount) || 70, fleet.length)));
  const commentAccs = fleet.slice(0, Math.max(0, Math.min(Number(commentCount) || 0, fleet.length)));

  const jobId = `gist_raid_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const job = {
    id: jobId,
    title: `💥 Post Raid (${cleanPostId.slice(0, 10)}...)`,
    status: "RUNNING",
    totalSteps: likeAccs.length + commentAccs.length,
    completedSteps: 0,
    stats: { follows: 0, likes: 0, regists: 0, comments: 0, posts: 0 },
    logs: [`[${new Date().toLocaleTimeString()}] 💥 Raiding Post ${cleanPostId} with ${likeAccs.length} accounts...`]
  };

  gistJobs.unshift(job);
  const workerState = { cancelled: false };
  activeGistWorkers.set(jobId, workerState);

  (async () => {
    try {
      const batchSize = 10;
      for (let i = 0; i < likeAccs.length; i += batchSize) {
        if (workerState.cancelled) break;
        const slice = likeAccs.slice(i, i + batchSize);
        await Promise.all(
          slice.map(async (acc) => {
            if (doLike) {
              const r = await callGistApi(acc.cookie, { action: "like", id: cleanPostId, on: true });
              if (r.ok) job.stats.likes++;
            }
            if (doRegist) {
              const r2 = await callGistApi(acc.cookie, { action: "regist", id: cleanPostId, on: true });
              if (r2.ok) job.stats.regists++;
            }
            job.completedSteps++;
          })
        );
      }

      if (commentAccs.length > 0 && comments.length > 0 && !workerState.cancelled) {
        for (let i = 0; i < commentAccs.length; i++) {
          if (workerState.cancelled) break;
          const acc = commentAccs[i];
          const text = comments[i % comments.length];
          const r = await callGistApi(acc.cookie, { action: "comment", id: cleanPostId, text });
          if (r.ok) {
            job.stats.comments++;
            job.logs.push(`[${new Date().toLocaleTimeString()}] 💬 @${acc.username}: "${text}"`);
          }
          job.completedSteps++;
          await sleep(200);
        }
      }

      job.status = workerState.cancelled ? "CANCELLED" : "COMPLETED";
      job.logs.push(`[${new Date().toLocaleTimeString()}] 🏁 Post Raid Done! +${job.stats.likes} Likes, +${job.stats.regists} Regists, +${job.stats.comments} Comments.`);
    } catch (err) {
      job.status = "CANCELLED";
      job.logs.push(`[${new Date().toLocaleTimeString()}] ❌ Error: ${err.message}`);
    } finally {
      activeGistWorkers.delete(jobId);
    }
  })();

  res.json({ success: true, job });
});

app.post("/api/gist-bot/stop-job", requireAdminAuth, (req, res) => {
  const { jobId } = req.body;
  if (activeGistWorkers.has(jobId)) {
    activeGistWorkers.get(jobId).cancelled = true;
    activeGistWorkers.delete(jobId);
  }
  const j = gistJobs.find(x => x.id === jobId);
  if (j) {
    j.status = "CANCELLED";
    j.logs.push(`[${new Date().toLocaleTimeString()}] 🛑 Operation stopped by user.`);
  }
  res.json({ success: true });
});

// -------------------------------------------------------------
// DM & Contact List (CL) Hub Endpoints
// -------------------------------------------------------------
app.post("/api/gist-bot/scan-dms", requireAdminAuth, async (req, res) => {
  try {
    const { account = "milespete" } = req.body;
    const fleet = await loadCombinedGistFleet();

    if (account === "fleet_all") {
      const activeFleet = fleet.filter(a => a.cookie).slice(0, 100);
      const accountsSummary = [];
      let totalUnread = 0;
      let totalContacts = 0;

      const CONCURRENCY = 10;
      let ptr = 0;
      async function worker() {
        while (ptr < activeFleet.length) {
          const acc = activeFleet[ptr++];
          try {
            const mRes = await fetch("https://lagoslife.app/api/messages", {
              headers: { cookie: acc.cookie, "user-agent": "Mozilla/5.0", accept: "application/json" }
            });
            if (mRes.ok) {
              const data = await mRes.json().catch(() => ({}));
              const threads = data.threads || [];
              const unread = threads.reduce((sum, t) => sum + (t.unread || 0), 0);
              if (threads.length > 0 || unread > 0) {
                totalContacts += threads.length;
                totalUnread += unread;
                accountsSummary.push({
                  username: acc.username,
                  totalThreads: threads.length,
                  unreadCount: unread,
                  topThread: threads[0]?.username || null
                });
              }
            }
          } catch {}
        }
      }
      await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

      return res.json({
        success: true,
        mode: "fleet_all",
        totalAccountsScanned: activeFleet.length,
        accountsWithDMs: accountsSummary.length,
        totalContacts,
        totalUnread,
        accounts: accountsSummary
      });
    }

    // Single account scan (e.g. milespete)
    const targetUname = account.replace(/^@/, "").trim().toLowerCase();
    const acc = fleet.find(a => (a.username || "").toLowerCase() === targetUname && a.cookie);
    if (!acc) {
      return res.status(404).json({ error: `Account @${account} not found or has no active session.` });
    }

    const mRes = await fetch("https://lagoslife.app/api/messages", {
      headers: { cookie: acc.cookie, "user-agent": "Mozilla/5.0", accept: "application/json" }
    });

    if (!mRes.ok) {
      return res.status(mRes.status).json({ error: `LagosLife returned HTTP ${mRes.status}` });
    }

    const data = await mRes.json().catch(() => ({}));
    const rawThreads = data.threads || [];
    let unreadCount = 0;

    const threads = rawThreads.map(t => {
      const uCount = t.unread || 0;
      unreadCount += uCount;
      return {
        id: t.id,
        username: t.username || t.name || t.id,
        name: t.name || t.username || "Player",
        unread: uCount,
        online: !!t.online,
        from: t.from || "lagos",
        at: t.at || Date.now(),
        last: t.last ? { body: t.last.body || "", mine: !!t.last.mine } : null
      };
    });

    threads.sort((a, b) => (b.unread - a.unread) || (b.at - a.at));

    res.json({
      success: true,
      mode: "single",
      account: acc.username,
      totalThreads: threads.length,
      unreadCount,
      threads
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/gist-bot/send-dm", requireAdminAuth, async (req, res) => {
  try {
    const { senderAccount = "milespete", toUserId, body } = req.body;
    if (!toUserId || !body) {
      return res.status(400).json({ error: "Recipient User ID and message body required." });
    }

    const fleet = await loadCombinedGistFleet();
    const targetUname = senderAccount.replace(/^@/, "").trim().toLowerCase();
    const sender = fleet.find(a => (a.username || "").toLowerCase() === targetUname && a.cookie);
    if (!sender) {
      return res.status(404).json({ error: `Sender @${senderAccount} session not found.` });
    }

    const resp = await fetch("https://lagoslife.app/api/messages", {
      method: "POST",
      headers: {
        cookie: sender.cookie,
        "content-type": "application/json",
        "accept": "application/json",
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
      },
      body: JSON.stringify({ to: toUserId, body: String(body).trim() })
    });

    const data = await resp.json().catch(() => ({}));
    res.json({ success: resp.ok, status: resp.status, data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/gist-bot/broadcast-dms", requireAdminAuth, async (req, res) => {
  try {
    const {
      senderMode = "single",
      senderAccount = "milespete",
      targetFilter = "all",
      messageText,
      delayMs = 250
    } = req.body;

    if (!messageText || !String(messageText).trim()) {
      return res.status(400).json({ error: "Broadcast message text cannot be empty." });
    }

    const fleet = await loadCombinedGistFleet();
    const cleanMsg = String(messageText).trim();

    const jobId = `dm_bcast_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const job = {
      id: jobId,
      title: `💬 DM Broadcast (${senderMode === "single" ? `@${senderAccount} CL` : "All Fleet CLs"})`,
      status: "RUNNING",
      totalSteps: 0,
      completedSteps: 0,
      stats: { sent: 0, failed: 0, total: 0 },
      logs: [
        `[${new Date().toLocaleTimeString()}] 🚀 Launching Contact List (CL) Multi-Message Broadcast...`,
        `[${new Date().toLocaleTimeString()}] 📝 Message: "${cleanMsg.slice(0, 60)}${cleanMsg.length > 60 ? "..." : ""}"`
      ]
    };

    gistJobs.unshift(job);
    const workerState = { cancelled: false };
    activeGistWorkers.set(jobId, workerState);

    (async () => {
      try {
        if (senderMode === "single") {
          const targetUname = senderAccount.replace(/^@/, "").trim().toLowerCase();
          const sender = fleet.find(a => (a.username || "").toLowerCase() === targetUname && a.cookie);
          if (!sender) {
            job.status = "CANCELLED";
            job.logs.push(`[${new Date().toLocaleTimeString()}] ❌ Sender @${senderAccount} cookie not found.`);
            return;
          }

          const mRes = await fetch("https://lagoslife.app/api/messages", {
            headers: { cookie: sender.cookie, "user-agent": "Mozilla/5.0", accept: "application/json" }
          });
          const mData = await mRes.json().catch(() => ({}));
          let targets = mData.threads || [];
          if (targetFilter === "unread_only") {
            targets = targets.filter(t => (t.unread || 0) > 0);
          }

          job.totalSteps = targets.length;
          job.stats.total = targets.length;
          job.logs.push(`[${new Date().toLocaleTimeString()}] 📋 Armed ${targets.length} contacts from @${sender.username}'s Contact List.`);

          for (const target of targets) {
            if (workerState.cancelled) break;
            const personalizedMsg = cleanMsg
              .replace(/\{username\}/gi, target.username || "friend")
              .replace(/\{name\}/gi, target.name || target.username || "friend");

            try {
              const sRes = await fetch("https://lagoslife.app/api/messages", {
                method: "POST",
                headers: {
                  cookie: sender.cookie,
                  "content-type": "application/json",
                  "accept": "application/json",
                  "user-agent": "Mozilla/5.0"
                },
                body: JSON.stringify({ to: target.id, body: personalizedMsg })
              });
              if (sRes.ok) {
                job.stats.sent++;
                job.logs.push(`[${new Date().toLocaleTimeString()}] ✉️ Sent to @${target.username || target.id}`);
              } else {
                job.stats.failed++;
              }
            } catch {
              job.stats.failed++;
            }
            job.completedSteps++;
            await sleep(Math.max(100, Number(delayMs) || 250));
          }
        } else {
          const activeAccounts = fleet.filter(a => a.cookie).slice(0, 500);
          job.logs.push(`[${new Date().toLocaleTimeString()}] 🌐 Scanning contact lists across ${activeAccounts.length} fleet accounts...`);

          let totalDispatched = 0;
          for (const sender of activeAccounts) {
            if (workerState.cancelled) break;
            try {
              const mRes = await fetch("https://lagoslife.app/api/messages", {
                headers: { cookie: sender.cookie, "user-agent": "Mozilla/5.0", accept: "application/json" }
              });
              if (!mRes.ok) continue;
              const mData = await mRes.json().catch(() => ({}));
              let contacts = mData.threads || [];
              if (targetFilter === "unread_only") {
                contacts = contacts.filter(t => (t.unread || 0) > 0);
              }
              for (const c of contacts) {
                if (workerState.cancelled) break;
                const personalizedMsg = cleanMsg
                  .replace(/\{username\}/gi, c.username || "friend")
                  .replace(/\{name\}/gi, c.name || c.username || "friend");

                const sRes = await fetch("https://lagoslife.app/api/messages", {
                  method: "POST",
                  headers: {
                    cookie: sender.cookie,
                    "content-type": "application/json",
                    "accept": "application/json",
                    "user-agent": "Mozilla/5.0"
                  },
                  body: JSON.stringify({ to: c.id, body: personalizedMsg })
                });
                if (sRes.ok) {
                  job.stats.sent++;
                  totalDispatched++;
                  if (totalDispatched % 10 === 0) {
                    job.logs.push(`[${new Date().toLocaleTimeString()}] ✉️ @${sender.username} -> @${c.username || c.id} (Total: ${job.stats.sent})`);
                  }
                } else {
                  job.stats.failed++;
                }
                job.completedSteps++;
                await sleep(Math.max(100, Number(delayMs) || 200));
              }
            } catch {}
          }
        }

        job.status = workerState.cancelled ? "CANCELLED" : "COMPLETED";
        job.logs.push(`[${new Date().toLocaleTimeString()}] 🏁 Broadcast Finished! Sent: ${job.stats.sent}, Failed: ${job.stats.failed}.`);
      } catch (err) {
        job.status = "CANCELLED";
        job.logs.push(`[${new Date().toLocaleTimeString()}] ❌ Broadcast Error: ${err.message}`);
      } finally {
        activeGistWorkers.delete(jobId);
      }
    })();

    res.json({ success: true, job });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Health check for Render & uptime monitors
app.get("/health", (req, res) => {
  res.json({ status: "ok", uptime: process.uptime() });
});

// Start Server
app.listen(PORT, "0.0.0.0", () => {
  console.log("==================================================");
  console.log(`🛡️ Master Treasury Cloud Vault online at http://localhost:${PORT}`);
  console.log(`🔒 Vault Authentication Mode: STRICT SESSION ISOLATION`);
  console.log("==================================================");
});
