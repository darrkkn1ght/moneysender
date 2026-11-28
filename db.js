import pg from "pg";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "data");
const RECEIPTS_JSON = path.join(DATA_DIR, "receipts_store.json");
const SETTINGS_JSON = path.join(DATA_DIR, "settings_store.json");
const AUTO2FA_JSON = path.join(DATA_DIR, "auto2fa_store.json");
const CLIENT_SESSIONS_JSON = path.join(DATA_DIR, "client_sessions_store.json");
const CLIENT_JOBS_JSON = path.join(DATA_DIR, "client_jobs_store.json");

const DEFAULT_COMMUNITY_URL = "https://chat.whatsapp.com/J4DhK5oAGKq8TwVElJTJ3E?s=cl&p=a&iam=2";
const DEFAULT_ANNOUNCEMENT = "💬 Join our WhatsApp Community for updates, status alerts & support!";

const { Pool } = pg;
let pool = null;
let dbMode = "local-json";

export function getDbMode() {
  return dbMode;
}

export async function initDb() {
  const url = process.env.DATABASE_URL;
  if (url) {
    try {
      pool = new Pool({
        connectionString: url,
        ssl: url.includes("localhost") || url.includes("127.0.0.1") ? false : { rejectUnauthorized: false },
        max: 5
      });
      await pool.query(`
        CREATE TABLE IF NOT EXISTS ms_receipts (
          receipt_id TEXT PRIMARY KEY,
          job_id TEXT NOT NULL,
          sender_uid TEXT,
          sender_user TEXT NOT NULL,
          sender_name TEXT,
          target_id TEXT,
          target_user TEXT,
          target_label TEXT,
          job_type TEXT,
          total_amount BIGINT NOT NULL DEFAULT 0,
          delivered_amount BIGINT NOT NULL DEFAULT 0,
          tx_count INT NOT NULL DEFAULT 0,
          total_txs INT NOT NULL DEFAULT 1,
          status TEXT NOT NULL,
          verified_debit BOOLEAN NOT NULL DEFAULT FALSE,
          started_at BIGINT,
          finished_at BIGINT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_ms_receipts_sender_user ON ms_receipts (LOWER(sender_user));
        CREATE INDEX IF NOT EXISTS idx_ms_receipts_created_at ON ms_receipts (created_at DESC);

        CREATE TABLE IF NOT EXISTS ms_settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS ms_auto2fa (
          username TEXT PRIMARY KEY,
          alias_tag TEXT UNIQUE NOT NULL,
          confirm_code TEXT,
          confirm_link TEXT,
          last_code TEXT,
          last_code_at BIGINT NOT NULL DEFAULT 0,
          code_consumed BOOLEAN NOT NULL DEFAULT FALSE,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_ms_auto2fa_alias ON ms_auto2fa (LOWER(alias_tag));

        CREATE TABLE IF NOT EXISTS ms_client_sessions (
          token TEXT PRIMARY KEY,
          username TEXT NOT NULL,
          session_json TEXT NOT NULL,
          updated_at BIGINT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS ms_jobs (
          job_id TEXT PRIMARY KEY,
          username TEXT NOT NULL,
          status TEXT NOT NULL,
          job_json TEXT NOT NULL,
          updated_at BIGINT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_ms_jobs_user ON ms_jobs (LOWER(username), updated_at DESC);
      `);
      dbMode = "postgres";
      console.log("🗄️ Connected to Neon/Postgres database for receipts & daily analytics.");
      return;
    } catch (err) {
      console.error("⚠️ Postgres init failed, falling back to local JSON:", err.message);
      pool = null;
      dbMode = "local-json";
    }
  }

  await fs.mkdir(DATA_DIR, { recursive: true }).catch(() => {});
  console.log("📁 Using local JSON fallback for receipts & settings (set DATABASE_URL for Neon Postgres).");
}

async function readLocalJson(file, fallback) {
  try {
    const raw = await fs.readFile(file, "utf8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function writeLocalJson(file, obj) {
  await fs.mkdir(DATA_DIR, { recursive: true }).catch(() => {});
  await fs.writeFile(file, JSON.stringify(obj, null, 2));
}

export async function upsertReceipt(r) {
  const row = {
    receipt_id: String(r.receiptId),
    job_id: String(r.jobId || r.id),
    sender_uid: r.senderUid ? String(r.senderUid) : null,
    sender_user: String(r.senderUser || "unknown").replace(/^@/, "").toLowerCase(),
    sender_name: r.senderName ? String(r.senderName) : null,
    target_id: r.targetId ? String(r.targetId) : null,
    target_user: r.targetUser ? String(r.targetUser) : null,
    target_label: r.targetLabel ? String(r.targetLabel) : null,
    job_type: r.jobType ? String(r.jobType) : "single",
    total_amount: Math.max(0, Math.floor(Number(r.totalAmount || 0))),
    delivered_amount: Math.max(0, Math.floor(Number(r.deliveredAmount || 0))),
    tx_count: Math.max(0, Math.floor(Number(r.txCount || 0))),
    total_txs: Math.max(1, Math.floor(Number(r.totalTxs || 1))),
    status: String(r.status || "RUNNING"),
    verified_debit: Boolean(r.verifiedDebit),
    started_at: r.startedAt ? Math.floor(Number(r.startedAt)) : Date.now(),
    finished_at: r.finishedAt ? Math.floor(Number(r.finishedAt)) : null
  };

  if (pool) {
    await pool.query(
      `INSERT INTO ms_receipts (
        receipt_id, job_id, sender_uid, sender_user, sender_name,
        target_id, target_user, target_label, job_type,
        total_amount, delivered_amount, tx_count, total_txs,
        status, verified_debit, started_at, finished_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
      ON CONFLICT (receipt_id) DO UPDATE SET
        delivered_amount = EXCLUDED.delivered_amount,
        tx_count = EXCLUDED.tx_count,
        total_txs = EXCLUDED.total_txs,
        status = EXCLUDED.status,
        verified_debit = EXCLUDED.verified_debit OR ms_receipts.verified_debit,
        finished_at = COALESCE(EXCLUDED.finished_at, ms_receipts.finished_at)`,
      [
        row.receipt_id, row.job_id, row.sender_uid, row.sender_user, row.sender_name,
        row.target_id, row.target_user, row.target_label, row.job_type,
        row.total_amount, row.delivered_amount, row.tx_count, row.total_txs,
        row.status, row.verified_debit, row.started_at, row.finished_at
      ]
    );
    return row;
  }

  const all = await readLocalJson(RECEIPTS_JSON, {});
  all[row.receipt_id] = { ...all[row.receipt_id], ...row, created_at: all[row.receipt_id]?.created_at || new Date().toISOString() };
  await writeLocalJson(RECEIPTS_JSON, all);
  return row;
}

export async function getReceiptById(receiptId) {
  if (!receiptId) return null;
  const cleanId = String(receiptId).trim();
  if (pool) {
    const res = await pool.query(`SELECT * FROM ms_receipts WHERE receipt_id = $1 LIMIT 1`, [cleanId]);
    return res.rows[0] || null;
  }
  const all = await readLocalJson(RECEIPTS_JSON, {});
  return all[cleanId] || null;
}

export async function getReceiptsBySender(senderUid, senderUser, limit = 25) {
  const cleanUser = String(senderUser || "").replace(/^@/, "").toLowerCase();
  if (pool) {
    const res = await pool.query(
      `SELECT * FROM ms_receipts
       WHERE ($1::text IS NOT NULL AND sender_uid = $1) OR LOWER(sender_user) = $2
       ORDER BY started_at DESC NULLS LAST, created_at DESC
       LIMIT $3`,
      [senderUid || null, cleanUser, limit]
    );
    return res.rows;
  }
  const all = Object.values(await readLocalJson(RECEIPTS_JSON, {}));
  return all
    .filter((r) => (senderUid && r.sender_uid === senderUid) || (cleanUser && r.sender_user === cleanUser))
    .sort((a, b) => Number(b.started_at || 0) - Number(a.started_at || 0))
    .slice(0, limit);
}

export async function getAdminDailyStats() {
  if (pool) {
    const [todayRes, dailyRes, allTimeRes, recentRes] = await Promise.all([
      pool.query(`
        SELECT
          COUNT(*)::int AS transfers,
          COALESCE(SUM(tx_count), 0)::bigint AS chunks,
          COALESCE(SUM(delivered_amount), 0)::bigint AS volume,
          COUNT(DISTINCT LOWER(sender_user))::int AS unique_senders
        FROM ms_receipts
        WHERE created_at >= DATE_TRUNC('day', NOW())
      `),
      pool.query(`
        SELECT
          TO_CHAR(DATE_TRUNC('day', created_at), 'YYYY-MM-DD') AS day,
          COUNT(*)::int AS transfers,
          COALESCE(SUM(tx_count), 0)::bigint AS chunks,
          COALESCE(SUM(delivered_amount), 0)::bigint AS volume,
          COUNT(DISTINCT LOWER(sender_user))::int AS unique_senders
        FROM ms_receipts
        WHERE created_at >= NOW() - INTERVAL '7 days'
        GROUP BY 1
        ORDER BY 1 DESC
      `),
      pool.query(`
        SELECT
          COUNT(*)::int AS transfers,
          COALESCE(SUM(tx_count), 0)::bigint AS chunks,
          COALESCE(SUM(delivered_amount), 0)::bigint AS volume,
          COUNT(DISTINCT LOWER(sender_user))::int AS unique_senders
        FROM ms_receipts
      `),
      pool.query(`
        SELECT receipt_id, sender_user, target_label, total_amount, delivered_amount, tx_count, total_txs, status, created_at
        FROM ms_receipts
        ORDER BY created_at DESC
        LIMIT 15
      `)
    ]);
    return {
      dbMode,
      today: todayRes.rows[0],
      daily: dailyRes.rows,
      allTime: allTimeRes.rows[0],
      recent: recentRes.rows
    };
  }

  const all = Object.values(await readLocalJson(RECEIPTS_JSON, {}));
  const todayStr = new Date().toISOString().slice(0, 10);
  const todayRows = all.filter((r) => String(r.created_at || "").slice(0, 10) === todayStr);
  const sum = (rows) => ({
    transfers: rows.length,
    chunks: rows.reduce((s, r) => s + Number(r.tx_count || 0), 0),
    volume: rows.reduce((s, r) => s + Number(r.delivered_amount || 0), 0),
    unique_senders: new Set(rows.map((r) => String(r.sender_user || "").toLowerCase())).size
  });

  const byDay = new Map();
  for (const r of all) {
    const day = String(r.created_at || new Date(r.started_at || Date.now()).toISOString()).slice(0, 10);
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(r);
  }
  const daily = [...byDay.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .slice(0, 7)
    .map(([day, rows]) => ({ day, ...sum(rows) }));

  return {
    dbMode,
    today: sum(todayRows),
    daily,
    allTime: sum(all),
    recent: all.sort((a, b) => Number(b.started_at || 0) - Number(a.started_at || 0)).slice(0, 15)
  };
}

export async function getSiteSettings() {
  if (pool) {
    const res = await pool.query(`SELECT key, value FROM ms_settings`);
    const map = Object.fromEntries(res.rows.map((r) => [r.key, r.value]));
    return {
      announcement: map.announcement ?? DEFAULT_ANNOUNCEMENT,
      communityUrl: map.community_url ?? DEFAULT_COMMUNITY_URL
    };
  }
  const s = await readLocalJson(SETTINGS_JSON, {});
  return {
    announcement: s.announcement ?? DEFAULT_ANNOUNCEMENT,
    communityUrl: s.communityUrl ?? DEFAULT_COMMUNITY_URL
  };
}

export async function setSiteSettings({ announcement, communityUrl }) {
  if (pool) {
    if (announcement !== undefined) {
      await pool.query(
        `INSERT INTO ms_settings (key, value) VALUES ('announcement', $1)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
        [String(announcement)]
      );
    }
    if (communityUrl !== undefined) {
      await pool.query(
        `INSERT INTO ms_settings (key, value) VALUES ('community_url', $1)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
        [String(communityUrl)]
      );
    }
    return getSiteSettings();
  }
  const cur = await readLocalJson(SETTINGS_JSON, {});
  const next = {
    announcement: announcement !== undefined ? String(announcement) : (cur.announcement ?? DEFAULT_ANNOUNCEMENT),
    communityUrl: communityUrl !== undefined ? String(communityUrl) : (cur.communityUrl ?? DEFAULT_COMMUNITY_URL)
  };
  await writeLocalJson(SETTINGS_JSON, next);
  return next;
}

// =========================================================================
// PUBLIC AUTO-2FA ALIASES & INBOUND WEBHOOK CODES
// =========================================================================
function makeAliasTag(username) {
  const clean = String(username || "user").toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 16) || "user";
  const suffix = crypto.randomBytes(3).toString("hex");
  return `${clean}_${suffix}`;
}

export async function getOrCreateAuto2faAlias(username) {
  const uname = String(username || "").trim().toLowerCase().replace(/^@/, "");
  if (!uname) return null;

  if (pool) {
    const existing = await pool.query(`SELECT * FROM ms_auto2fa WHERE username = $1`, [uname]);
    if (existing.rows[0]) return existing.rows[0];
    const tag = makeAliasTag(uname);
    const ins = await pool.query(
      `INSERT INTO ms_auto2fa (username, alias_tag) VALUES ($1, $2)
       ON CONFLICT (username) DO UPDATE SET username = EXCLUDED.username
       RETURNING *`,
      [uname, tag]
    );
    return ins.rows[0];
  }

  const all = await readLocalJson(AUTO2FA_JSON, {});
  if (all[uname]) return all[uname];
  all[uname] = {
    username: uname,
    alias_tag: makeAliasTag(uname),
    confirm_code: null,
    confirm_link: null,
    last_code: null,
    last_code_at: 0,
    code_consumed: false
  };
  await writeLocalJson(AUTO2FA_JSON, all);
  return all[uname];
}

export async function saveInbound2faEmail({ aliasTag, code, confirmCode, confirmLink }) {
  const tag = String(aliasTag || "").trim().toLowerCase();
  if (!tag) return { matched: false };
  const now = Date.now();

  if (pool) {
    const res = await pool.query(
      `UPDATE ms_auto2fa
       SET confirm_code = COALESCE($2, confirm_code),
           confirm_link = COALESCE($3, confirm_link),
           last_code = COALESCE($4, last_code),
           last_code_at = CASE WHEN $4 IS NOT NULL THEN $5 ELSE last_code_at END,
           code_consumed = CASE WHEN $4 IS NOT NULL THEN FALSE ELSE code_consumed END,
           updated_at = NOW()
       WHERE LOWER(alias_tag) = $1
       RETURNING username`,
      [tag, confirmCode || null, confirmLink || null, code || null, now]
    );
    return { matched: res.rowCount > 0, username: res.rows[0]?.username || null };
  }

  const all = await readLocalJson(AUTO2FA_JSON, {});
  const key = Object.keys(all).find((k) => String(all[k]?.alias_tag || "").toLowerCase() === tag);
  if (!key) return { matched: false };
  if (confirmCode) all[key].confirm_code = confirmCode;
  if (confirmLink) all[key].confirm_link = confirmLink;
  if (code) {
    all[key].last_code = code;
    all[key].last_code_at = now;
    all[key].code_consumed = false;
  }
  await writeLocalJson(AUTO2FA_JSON, all);
  return { matched: true, username: key };
}

export async function getFresh2faCode(username, minTimestampMs = 0) {
  const uname = String(username || "").trim().toLowerCase().replace(/^@/, "");
  if (!uname) return null;
  const maxAgeMs = 5 * 60 * 1000;
  const cutoff = Math.max(minTimestampMs, Date.now() - maxAgeMs);

  if (pool) {
    const res = await pool.query(
      `SELECT last_code, last_code_at, code_consumed FROM ms_auto2fa WHERE username = $1`,
      [uname]
    );
    const row = res.rows[0];
    if (!row || !row.last_code || row.code_consumed) return null;
    if (Number(row.last_code_at || 0) < cutoff) return null;
    return { code: row.last_code, receivedAt: Number(row.last_code_at) };
  }

  const all = await readLocalJson(AUTO2FA_JSON, {});
  const row = all[uname];
  if (!row || !row.last_code || row.code_consumed) return null;
  if (Number(row.last_code_at || 0) < cutoff) return null;
  return { code: row.last_code, receivedAt: Number(row.last_code_at) };
}

export async function mark2faCodeUsed(username) {
  const uname = String(username || "").trim().toLowerCase().replace(/^@/, "");
  if (!uname) return;
  if (pool) {
    await pool.query(`UPDATE ms_auto2fa SET code_consumed = TRUE, updated_at = NOW() WHERE username = $1`, [uname]);
    return;
  }
  const all = await readLocalJson(AUTO2FA_JSON, {});
  if (all[uname]) {
    all[uname].code_consumed = true;
    await writeLocalJson(AUTO2FA_JSON, all);
  }
}

// =========================================================================
// PERSISTENT CLIENT SESSIONS & RESUMABLE JOBS / HISTORY
// =========================================================================
export async function saveClientSession(token, sessionObj) {
  if (!token || !sessionObj?.account?.user) return;
  const uname = String(sessionObj.account.user).toLowerCase().replace(/^@/, "");
  const payload = JSON.stringify({ account: sessionObj.account });
  const now = Date.now();
  if (pool) {
    await pool.query(
      `INSERT INTO ms_client_sessions (token, username, session_json, updated_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (token) DO UPDATE SET session_json = EXCLUDED.session_json, updated_at = EXCLUDED.updated_at`,
      [token, uname, payload, now]
    );
    return;
  }
  const all = await readLocalJson(CLIENT_SESSIONS_JSON, {});
  all[token] = { username: uname, account: sessionObj.account, updated_at: now };
  await writeLocalJson(CLIENT_SESSIONS_JSON, all);
}

export async function loadClientSession(token) {
  if (!token) return null;
  if (pool) {
    const res = await pool.query(`SELECT session_json FROM ms_client_sessions WHERE token = $1`, [token]);
    if (!res.rows[0]) return null;
    try { return JSON.parse(res.rows[0].session_json); } catch { return null; }
  }
  const all = await readLocalJson(CLIENT_SESSIONS_JSON, {});
  return all[token] ? { account: all[token].account } : null;
}

export async function deleteClientSession(token) {
  if (!token) return;
  if (pool) {
    await pool.query(`DELETE FROM ms_client_sessions WHERE token = $1`, [token]);
    return;
  }
  const all = await readLocalJson(CLIENT_SESSIONS_JSON, {});
  delete all[token];
  await writeLocalJson(CLIENT_SESSIONS_JSON, all);
}

export async function upsertClientJob(username, job) {
  const uname = String(username || "").trim().toLowerCase().replace(/^@/, "");
  if (!uname || !job?.id) return;
  const now = Date.now();
  const compact = { ...job, logs: (job.logs || []).slice(-40) };
  const payload = JSON.stringify(compact);
  if (pool) {
    await pool.query(
      `INSERT INTO ms_jobs (job_id, username, status, job_json, updated_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (job_id) DO UPDATE SET status = EXCLUDED.status, job_json = EXCLUDED.job_json, updated_at = EXCLUDED.updated_at`,
      [job.id, uname, String(job.status || "RUNNING"), payload, now]
    );
    return;
  }
  const all = await readLocalJson(CLIENT_JOBS_JSON, {});
  all[job.id] = { username: uname, status: job.status, job: compact, updated_at: now };
  await writeLocalJson(CLIENT_JOBS_JSON, all);
}

export async function listUserHistory(username, limit = 40) {
  const uname = String(username || "").trim().toLowerCase().replace(/^@/, "");
  if (!uname) return { receipts: [], jobs: [] };

  if (pool) {
    const [recRes, jobRes] = await Promise.all([
      pool.query(
        `SELECT * FROM ms_receipts WHERE LOWER(sender_user) = $1 ORDER BY COALESCE(finished_at, started_at, 0) DESC LIMIT $2`,
        [uname, limit]
      ),
      pool.query(
        `SELECT job_json FROM ms_jobs WHERE LOWER(username) = $1 ORDER BY updated_at DESC LIMIT 15`,
        [uname]
      )
    ]);
    return {
      receipts: recRes.rows,
      jobs: jobRes.rows.map((r) => {
        try { return JSON.parse(r.job_json); } catch { return null; }
      }).filter(Boolean)
    };
  }

  const [recs, jobsObj] = await Promise.all([
    readLocalJson(RECEIPTS_JSON, []),
    readLocalJson(CLIENT_JOBS_JSON, {})
  ]);
  return {
    receipts: recs.filter((r) => String(r.sender_user || "").toLowerCase() === uname).slice(-limit).reverse(),
    jobs: Object.values(jobsObj)
      .filter((x) => x.username === uname)
      .sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0))
      .slice(0, 15)
      .map((x) => x.job)
  };
}

export async function loadResumableJobs() {
  if (pool) {
    const res = await pool.query(
      `SELECT username, job_json FROM ms_jobs WHERE status IN ('RUNNING', 'WAITING_2FA', 'PAUSED') ORDER BY updated_at DESC LIMIT 100`
    );
    return res.rows.map((r) => {
      try { return { username: r.username, job: JSON.parse(r.job_json) }; } catch { return null; }
    }).filter(Boolean);
  }
  const all = await readLocalJson(CLIENT_JOBS_JSON, {});
  return Object.values(all)
    .filter((x) => x && (x.status === "RUNNING" || x.status === "WAITING_2FA" || x.status === "PAUSED") && x.job)
    .map((x) => ({ username: x.username, job: x.job }));
}

export async function loadLatestSessionByUser(username) {
  const uname = String(username || "").trim().toLowerCase().replace(/^@/, "");
  if (!uname) return null;
  if (pool) {
    const res = await pool.query(
      `SELECT token, session_json FROM ms_client_sessions WHERE LOWER(username) = $1 ORDER BY updated_at DESC LIMIT 1`,
      [uname]
    );
    if (!res.rows[0]) return null;
    try { return { token: res.rows[0].token, ...JSON.parse(res.rows[0].session_json) }; } catch { return null; }
  }
  const all = await readLocalJson(CLIENT_SESSIONS_JSON, {});
  const entries = Object.entries(all)
    .filter(([, v]) => String(v?.username || "").toLowerCase() === uname)
    .sort((a, b) => (b[1]?.updated_at || 0) - (a[1]?.updated_at || 0));
  if (!entries[0]) return null;
  return { token: entries[0][0], account: entries[0][1].account };
}
