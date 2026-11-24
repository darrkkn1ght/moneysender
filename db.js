import pg from "pg";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "data");
const RECEIPTS_JSON = path.join(DATA_DIR, "receipts_store.json");
const SETTINGS_JSON = path.join(DATA_DIR, "settings_store.json");

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
