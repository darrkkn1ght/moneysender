/* =========================================================
   LagosLife Master Treasury — Executive Controller & Ledger
   ========================================================= */

const API = window.location.origin;
let accounts = [];
let activeCookieModalAccountId = null;
let allLedgerRecords = [];

// Helpers
const $ = id => document.getElementById(id);

function getHeaders() {
  const token = localStorage.getItem("lls_admin_token") || "";
  return {
    "content-type": "application/json",
    "x-admin-token": token
  };
}

function fmtMoney(n) {
  if (n === null || n === undefined || isNaN(n)) return "₦0";
  const num = Number(n);
  if (num >= 1e12) return `₦${(num / 1e12).toFixed(2)}T`;
  if (num >= 1e9) return `₦${(num / 1e9).toFixed(2)}B`;
  if (num >= 1e6) return `₦${(num / 1e6).toFixed(2)}M`;
  return `₦${num.toLocaleString()}`;
}

function parseAmount(str) {
  if (!str) return 0;
  const clean = str.trim().toLowerCase().replace(/,/g, "").replace(/₦/g, "");
  if (clean.endsWith("t")) return parseFloat(clean) * 1e12;
  if (clean.endsWith("b")) return parseFloat(clean) * 1e9;
  if (clean.endsWith("m")) return parseFloat(clean) * 1e6;
  if (clean.endsWith("k")) return parseFloat(clean) * 1e3;
  return parseFloat(clean) || 0;
}

function showToast(msg, type = "info") {
  const container = $("toast-container");
  if (!container) return;
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

// ---------------------------------------------------------
// Init
// ---------------------------------------------------------
document.addEventListener("DOMContentLoaded", async () => {
  setupTabs();
  setupChips();
  setupActions();
  setupLedger();
  
  await refreshDashboard();
  await refreshLedger();

  // Poll live progress & active transfers every 3s
  setInterval(refreshDashboard, 3000);
  // Poll ledger every 10s
  setInterval(refreshLedger, 10000);
});

// ---------------------------------------------------------
// Tabs & Modes
// ---------------------------------------------------------
function setupTabs() {
  const tabBtns = document.querySelectorAll(".tab-btn");
  tabBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      tabBtns.forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".tab-content").forEach(tc => tc.classList.remove("active"));
      btn.classList.add("active");
      const tabId = `tab-${btn.dataset.tab}`;
      const target = $(tabId);
      if (target) target.classList.add("active");

      if (btn.dataset.tab === "ledger") {
        refreshLedger();
      }
    });
  });
}

// ---------------------------------------------------------
// Amount Quick Chips
// ---------------------------------------------------------
function setupChips() {
  document.querySelectorAll(".quick-chips").forEach(chipContainer => {
    const parent = chipContainer.closest(".form-group");
    const input = parent ? parent.querySelector("input") : null;
    if (!input) return;

    chipContainer.querySelectorAll(".chip").forEach(chip => {
      chip.addEventListener("click", e => {
        e.preventDefault();
        const val = chip.dataset.val;
        input.value = fmtMoney(val).replace("₦", "");
      });
    });
  });
}

// ---------------------------------------------------------
// Actions & Handlers
// ---------------------------------------------------------
function setupActions() {
  // Lock / Logout Session
  $("btn-lock")?.addEventListener("click", async () => {
    try {
      await fetch(`${API}/api/admin/logout`, { method: "POST", headers: getHeaders() });
    } catch {}
    localStorage.removeItem("lls_admin_token");
    window.location.href = "/login";
  });

  // Manual Refresh
  $("btn-refresh-data")?.addEventListener("click", () => {
    refreshDashboard();
    refreshLedger();
    showToast("Refreshing balances & ledger...", "info");
  });

  // Recipient Lookup
  $("btn-lookup-user")?.addEventListener("click", async () => {
    const raw = $("single-recipient").value.trim();
    if (!raw) return showToast("Enter recipient username or chat link", "error");

    const prevBox = $("recipient-preview");
    prevBox.classList.remove("hidden");
    $("prev-name").textContent = "Searching LagosLife...";
    $("prev-id").textContent = "...";

    try {
      const res = await fetch(`${API}/api/resolve-recipient?q=${encodeURIComponent(raw)}`, {
        headers: getHeaders()
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        $("prev-name").textContent = "Player Not Found";
        $("prev-id").textContent = err.error || "Check spelling";
        return;
      }
      const data = await res.json();
      $("prev-name").textContent = data.name ? `${data.name} (@${data.username})` : `@${data.username}`;
      $("prev-id").textContent = data.id;
      $("single-recipient").value = data.id;
    } catch (e) {
      $("prev-name").textContent = "Lookup failed";
      $("prev-id").textContent = e.message;
    }
  });

  // Single Transfer Launch
  $("btn-execute-single")?.addEventListener("click", async () => {
    const accountId = $("single-sender-select").value;
    const to = $("single-recipient").value.trim();
    const rawAmt = $("single-amount").value.trim();
    const amount = parseAmount(rawAmt);

    if (!to) return showToast("Recipient required", "error");
    if (!amount || amount <= 0) return showToast("Enter a valid amount", "error");

    const btn = $("btn-execute-single");
    btn.disabled = true;
    btn.textContent = "Dispatching...";

    try {
      const res = await fetch(`${API}/api/transfers/send`, {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify({ accountId, to, amount })
      });

      if (res.status === 401) {
        showToast("Session expired. Please log in.", "error");
        window.location.href = "/login";
        return;
      }

      const data = await res.json();
      if (res.ok) {
        showToast(`Transfer started: ${fmtMoney(amount)} to ${to}`, "success");
        $("single-recipient").value = "";
        $("single-amount").value = "";
        $("recipient-preview").classList.add("hidden");
        refreshDashboard();
        refreshLedger();
      } else {
        showToast(data.error || "Transfer failed", "error");
      }
    } catch (e) {
      showToast(e.message, "error");
    } finally {
      btn.disabled = false;
      btn.innerHTML = "<span>🚀 Initiate Transfer</span>";
    }
  });

  // Smart Split Sender Launch
  $("btn-execute-split")?.addEventListener("click", async () => {
    const to = $("split-recipient").value.trim();
    if (!to) return showToast("Target recipient required", "error");

    const milesB = Number($("split-miles-amt")?.value || 0);
    const princeB = Number($("split-prince-amt")?.value || 0);
    const mrwhoB = Number($("split-mrwho-amt")?.value || 0);

    const plans = [];
    const accMiles = accounts.find(a => a.user === "milespete");
    const accPrince = accounts.find(a => a.user === "princedavid");
    const accMrWho = accounts.find(a => a.user === "mr_who");

    if (accMiles && milesB > 0) plans.push({ accountId: accMiles.id, amount: milesB * 1e9 });
    if (accPrince && princeB > 0) plans.push({ accountId: accPrince.id, amount: princeB * 1e9 });
    if (accMrWho && mrwhoB > 0) plans.push({ accountId: accMrWho.id, amount: mrwhoB * 1e9 });

    if (plans.length === 0) return showToast("Enter amounts for at least one sender", "error");

    const btn = $("btn-execute-split");
    btn.disabled = true;
    btn.textContent = "Launching Parallel Legs...";

    try {
      const res = await fetch(`${API}/api/transfers/split`, {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify({ to, plans })
      });

      const data = await res.json();
      if (res.ok) {
        showToast(`Split transfer initiated across ${plans.length} senders!`, "success");
        $("split-recipient").value = "";
        refreshDashboard();
        refreshLedger();
      } else {
        showToast(data.error || "Split failed", "error");
      }
    } catch (e) {
      showToast(e.message, "error");
    } finally {
      btn.disabled = false;
      btn.innerHTML = "<span>⚡ Launch Concurrent Split</span>";
    }
  });

  // Batch Distribution
  $("btn-execute-batch")?.addEventListener("click", async () => {
    const accountId = $("batch-sender-select").value;
    const rawRecipients = $("batch-recipients").value.trim();
    const rawAmt = $("batch-amount-per").value.trim();
    const amountPerUser = parseAmount(rawAmt);

    const recipients = rawRecipients.split(/[\n,]+/).map(s => s.trim()).filter(Boolean);
    if (recipients.length === 0) return showToast("Add at least one recipient", "error");
    if (!amountPerUser || amountPerUser <= 0) return showToast("Enter a valid amount per recipient", "error");

    const btn = $("btn-execute-batch");
    btn.disabled = true;
    btn.textContent = "Starting Batch...";

    try {
      const res = await fetch(`${API}/api/transfers/batch`, {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify({ accountId, recipients, amountPerUser })
      });

      const data = await res.json();
      if (res.ok) {
        showToast(`Batch queued for ${recipients.length} recipients!`, "success");
        $("batch-recipients").value = "";
        refreshDashboard();
        refreshLedger();
      } else {
        showToast(data.error || "Batch failed", "error");
      }
    } catch (e) {
      showToast(e.message, "error");
    } finally {
      btn.disabled = false;
      btn.innerHTML = "<span>📤 Distribute to All</span>";
    }
  });

  // Preset Button
  $("btn-apply-500b-split")?.addEventListener("click", e => {
    e.preventDefault();
    $("split-miles-amt").value = "200";
    $("split-prince-amt").value = "200";
    $("split-mrwho-amt").value = "100";
    calcSplitTotal();
  });

  // Calculate split total dynamically
  ["split-miles-amt", "split-prince-amt", "split-mrwho-amt"].forEach(id => {
    $(id)?.addEventListener("input", calcSplitTotal);
  });

  // Cookie Modal Close
  $("btn-close-cookie-modal")?.addEventListener("click", () => {
    $("cookie-modal").classList.add("hidden");
  });

  // Save Cookie
  $("btn-save-cookie")?.addEventListener("click", async () => {
    const cookie = $("cookie-input-area").value.trim();
    if (!cookie || !activeCookieModalAccountId) return showToast("Paste cookie string", "error");

    const btn = $("btn-save-cookie");
    btn.disabled = true;
    btn.textContent = "Updating...";

    try {
      const res = await fetch(`${API}/api/accounts/update-cookie`, {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify({ accountId: activeCookieModalAccountId, cookie })
      });
      const data = await res.json();
      if (res.ok) {
        showToast("Session updated & validated successfully!", "success");
        $("cookie-modal").classList.add("hidden");
        refreshDashboard();
      } else {
        showToast(data.error || "Failed to update cookie", "error");
      }
    } catch (e) {
      showToast(e.message, "error");
    } finally {
      btn.disabled = false;
      btn.textContent = "Save & Validate Session";
    }
  });
}

function calcSplitTotal() {
  const m = Number($("split-miles-amt")?.value || 0);
  const p = Number($("split-prince-amt")?.value || 0);
  const w = Number($("split-mrwho-amt")?.value || 0);
  const total = (m + p + w) * 1e9;
  $("split-total-label").textContent = fmtMoney(total);
}

// ---------------------------------------------------------
// Dashboard State Refresh
// ---------------------------------------------------------
async function refreshDashboard() {
  try {
    const res = await fetch(`${API}/api/accounts`, { headers: getHeaders() });
    if (res.status === 401) {
      window.location.href = "/login";
      return;
    }
    if (!res.ok) return;

    accounts = await res.json();
    renderAccounts(accounts);

    // Refresh Active & History Jobs
    await refreshJobs();
  } catch (err) {
    console.error("Dashboard poll failed:", err);
  }
}

function renderAccounts(accList) {
  const grid = $("accounts-grid");
  const countPill = $("accounts-count-pill");
  const singleSelect = $("single-sender-select");
  const batchSelect = $("batch-sender-select");
  const ledgerSenderFilter = $("ledger-sender-filter");

  if (!grid) return;
  grid.innerHTML = "";

  let totalWealth = 0;
  const currentSingleVal = singleSelect?.value;
  const currentBatchVal = batchSelect?.value;

  if (singleSelect) singleSelect.innerHTML = "";
  if (batchSelect) batchSelect.innerHTML = "";

  accList.forEach(acc => {
    const isMiles = acc.user === "milespete";
    const isExcluded = acc.user === "kvngdre";
    const moneyNum = Number(acc.money) || 0;
    if (!isExcluded) totalWealth += moneyNum;

    // Card element
    const card = document.createElement("div");
    card.className = "account-card";
    const isOnline = acc.status === "ACTIVE";

    card.innerHTML = `
      <div class="account-top">
        <span class="account-name">${acc.name}</span>
        <span class="status-indicator ${isOnline ? 'online' : 'offline'}">${isOnline ? 'ONLINE' : 'EXPIRED'}</span>
      </div>
      <div class="account-balance">${fmtMoney(acc.money)}</div>
      <div class="account-actions">
        <button class="btn-renew-cookie" data-id="${acc.id}">Update Cookie</button>
      </div>
    `;

    card.querySelector(".btn-renew-cookie")?.addEventListener("click", () => {
      activeCookieModalAccountId = acc.id;
      $("cookie-modal-title").textContent = `Update Session: ${acc.name}`;
      $("cookie-input-area").value = "";
      $("cookie-modal").classList.remove("hidden");
    });

    grid.appendChild(card);

    // Dropdown options
    if (!isExcluded) {
      const opt1 = document.createElement("option");
      opt1.value = acc.id;
      opt1.textContent = `${acc.name} (${fmtMoney(acc.money)})`;
      if (singleSelect) singleSelect.appendChild(opt1);

      const opt2 = document.createElement("option");
      opt2.value = acc.id;
      opt2.textContent = `${acc.name} (${fmtMoney(acc.money)})`;
      if (batchSelect) batchSelect.appendChild(opt2);
    }
  });

  if (singleSelect && currentSingleVal) singleSelect.value = currentSingleVal;
  if (batchSelect && currentBatchVal) batchSelect.value = currentBatchVal;

  $("total-treasury").textContent = fmtMoney(totalWealth);
  if (countPill) countPill.textContent = `${accList.filter(a => a.status === 'ACTIVE').length} / ${accList.length} Connected`;
}

async function refreshJobs() {
  try {
    const [actRes, histRes] = await Promise.all([
      fetch(`${API}/api/transfers/active`, { headers: getHeaders() }),
      fetch(`${API}/api/transfers/history`, { headers: getHeaders() })
    ]);

    if (actRes.ok) {
      const activeJobs = await actRes.json();
      renderActiveJobs(activeJobs);
      const pill = $("active-jobs-count");
      if (pill) {
        const runningCount = activeJobs.filter(j => j.status === "RUNNING").length;
        const pausedCount = activeJobs.filter(j => j.status === "PAUSED").length;
        if (pausedCount > 0 && runningCount > 0) {
          pill.textContent = `${runningCount} Running, ${pausedCount} Paused`;
        } else if (pausedCount > 0) {
          pill.textContent = `${pausedCount} Paused`;
        } else {
          pill.textContent = `${runningCount} Running`;
        }
      }
    }

    if (histRes.ok) {
      const histJobs = await histRes.json();
      renderHistoryJobs(histJobs);
    }
  } catch (err) {}
}

function renderActiveJobs(jobs) {
  const container = $("active-jobs-list");
  if (!container) return;
  if (!jobs || jobs.length === 0) {
    container.innerHTML = `<div class="empty-state">No transfers currently executing.</div>`;
    return;
  }

  container.innerHTML = "";
  jobs.forEach(job => {
    const isPaused = job.status === "PAUSED";
    const el = document.createElement("div");
    el.className = `job-card ${isPaused ? 'paused' : 'running'}`;
    const pct = job.totalTxs > 0 ? Math.round((job.txCount / job.totalTxs) * 100) : 0;
    const latestLog = job.logs && job.logs.length ? job.logs[job.logs.length - 1] : (isPaused ? "Paused" : "Executing...");

    el.innerHTML = `
      <div class="job-header">
        <span class="job-type-pill">${job.type || 'TRANSFER'}</span>
        <span class="job-status-pill ${isPaused ? 'paused' : 'running'}">${isPaused ? '⏸️ PAUSED' : '⚡ RUNNING'}</span>
      </div>
      <div class="job-body">
        <div class="job-route"><strong>${job.sender}</strong> → <strong>${job.targetLabel}</strong></div>
        <div class="job-amounts">
          <span>Sent: ${fmtMoney(job.total - job.remaining)} / ${fmtMoney(job.total)}</span>
          <span class="mono">${job.txCount} / ${job.totalTxs} txs (${pct}%)</span>
        </div>
        <div class="progress-bar-wrap">
          <div class="progress-fill ${isPaused ? 'paused-fill' : ''}" style="width: ${pct}%"></div>
        </div>
        <div class="job-log-snip mono">${latestLog}</div>
      </div>
      <div class="job-actions-row">
        ${isPaused 
          ? `<button class="btn-job-action btn-resume-job" data-id="${job.id}">▶️ Resume</button>`
          : `<button class="btn-job-action btn-pause-job" data-id="${job.id}">⏸️ Pause</button>`
        }
        <button class="btn-job-action btn-stop-job" data-id="${job.id}">⏹️ Cancel</button>
      </div>
    `;

    el.querySelector(".btn-pause-job")?.addEventListener("click", async () => {
      try {
        const res = await fetch(`${API}/api/transfers/pause`, {
          method: "POST",
          headers: getHeaders(),
          body: JSON.stringify({ jobId: job.id })
        });
        const data = await res.json();
        if (res.ok) {
          showToast(`Transfer pipeline paused`, "info");
          refreshJobs();
        } else {
          showToast(data.error || "Failed to pause", "error");
        }
      } catch (e) {
        showToast(e.message, "error");
      }
    });

    el.querySelector(".btn-resume-job")?.addEventListener("click", async () => {
      try {
        const res = await fetch(`${API}/api/transfers/resume`, {
          method: "POST",
          headers: getHeaders(),
          body: JSON.stringify({ jobId: job.id })
        });
        const data = await res.json();
        if (res.ok) {
          showToast(`Transfer pipeline resumed! Continuing...`, "success");
          refreshJobs();
        } else {
          showToast(data.error || "Failed to resume", "error");
        }
      } catch (e) {
        showToast(e.message, "error");
      }
    });

    el.querySelector(".btn-stop-job")?.addEventListener("click", async () => {
      try {
        const res = await fetch(`${API}/api/transfers/stop`, {
          method: "POST",
          headers: getHeaders(),
          body: JSON.stringify({ jobId: job.id })
        });
        if (res.ok) {
          showToast("Cancelled transfer job", "info");
          refreshDashboard();
        } else {
          showToast("Failed to cancel", "error");
        }
      } catch (e) {
        showToast(e.message, "error");
      }
    });

    container.appendChild(el);
  });
}

function renderHistoryJobs(jobs) {
  const container = $("history-jobs-list");
  if (!container) return;
  if (!jobs || jobs.length === 0) {
    container.innerHTML = `<div class="empty-state">No completed transfers.</div>`;
    return;
  }

  container.innerHTML = "";
  jobs.slice(0, 10).forEach(job => {
    const el = document.createElement("div");
    el.className = `job-card ${job.status.toLowerCase()}`;
    const latestLog = job.logs && job.logs.length ? job.logs[job.logs.length - 1] : "";

    el.innerHTML = `
      <div class="job-header">
        <span class="job-type-pill">${job.type || 'TRANSFER'}</span>
        <span class="job-status-pill ${job.status.toLowerCase()}">${job.status}</span>
      </div>
      <div class="job-body">
        <div class="job-route"><strong>${job.sender}</strong> → <strong>${job.targetLabel}</strong></div>
        <div class="job-amounts">
          <span>Delivered: ${fmtMoney(job.total - (job.remaining || 0))}</span>
          <span class="mono">${job.txCount || 0} / ${job.totalTxs || 0} txs</span>
        </div>
        <div class="job-log-snip mono">${latestLog}</div>
      </div>
    `;
    container.appendChild(el);
  });
}

// ---------------------------------------------------------
// Sending Records & Ledger (Audit Log)
// ---------------------------------------------------------
function setupLedger() {
  $("btn-refresh-ledger")?.addEventListener("click", () => {
    refreshLedger();
    showToast("Transaction records refreshed", "info");
  });

  $("ledger-search-input")?.addEventListener("input", filterAndRenderLedger);
  $("ledger-sender-filter")?.addEventListener("change", filterAndRenderLedger);
  $("ledger-status-filter")?.addEventListener("change", filterAndRenderLedger);

  $("btn-export-csv")?.addEventListener("click", exportLedgerCsv);
  $("btn-export-json")?.addEventListener("click", exportLedgerJson);
}

async function refreshLedger() {
  try {
    const res = await fetch(`${API}/api/admin/ledger`, { headers: getHeaders() });
    if (res.status === 401) {
      window.location.href = "/login";
      return;
    }
    if (!res.ok) return;

    const data = await res.json();
    allLedgerRecords = data.records || [];
    renderLedgerMetrics(data.metrics || {});
    populateLedgerSenderFilter(allLedgerRecords);
    filterAndRenderLedger();
  } catch (err) {
    console.error("Failed to load ledger:", err);
  }
}

function renderLedgerMetrics(metrics) {
  $("ledger-total-volume").textContent = fmtMoney(metrics.totalVolume || 0);
  $("ledger-today-volume").textContent = fmtMoney(metrics.todayVolume || 0);
  $("ledger-total-txs").textContent = (metrics.totalTxs || 0).toLocaleString();
  $("ledger-unique-recipients").textContent = (metrics.uniqueRecipients || 0).toLocaleString();
}

function populateLedgerSenderFilter(records) {
  const select = $("ledger-sender-filter");
  if (!select) return;
  const current = select.value;
  const senders = new Set();
  records.forEach(r => {
    if (r.sender) senders.add(r.sender);
  });

  select.innerHTML = '<option value="ALL">All Senders</option>';
  senders.forEach(s => {
    const opt = document.createElement("option");
    opt.value = s;
    opt.textContent = s;
    select.appendChild(opt);
  });

  if (current) select.value = current;
}

function filterAndRenderLedger() {
  const query = ($("ledger-search-input")?.value || "").toLowerCase().trim();
  const senderFilter = $("ledger-sender-filter")?.value || "ALL";
  const statusFilter = $("ledger-status-filter")?.value || "ALL";
  const container = $("ledger-records-list");

  if (!container) return;

  const filtered = allLedgerRecords.filter(r => {
    const matchSender = senderFilter === "ALL" || (r.sender || "").includes(senderFilter);
    const matchStatus = statusFilter === "ALL" || (r.status || "").toUpperCase() === statusFilter;
    const matchQuery = !query ||
      (r.recipient || "").toLowerCase().includes(query) ||
      (r.targetId || "").toLowerCase().includes(query) ||
      (r.sender || "").toLowerCase().includes(query);
    return matchSender && matchStatus && matchQuery;
  });

  if (filtered.length === 0) {
    container.innerHTML = `<div class="ledger-empty">No transaction records match your filters.</div>`;
    return;
  }

  container.innerHTML = "";
  filtered.forEach(rec => {
    const item = document.createElement("div");
    item.className = "ledger-item";
    const statusClass = (rec.status || "COMPLETED").toLowerCase();

    item.innerHTML = `
      <div class="li-top">
        <span class="li-time">${rec.timeStr || new Date(rec.timestamp).toLocaleString()}</span>
        <span class="li-badge ${statusClass}">${rec.status}</span>
      </div>
      <div class="li-parties">
        <span class="li-sender">${rec.sender}</span>
        <span class="li-arrow">➔</span>
        <span class="li-target">${rec.recipient}</span>
      </div>
      <div class="li-bottom">
        <span class="li-amt">${fmtMoney(rec.amount)}</span>
        <span class="li-progress">${rec.chunksCompleted || 0}/${rec.totalChunks || 0} chunks</span>
      </div>
    `;
    container.appendChild(item);
  });
}

function exportLedgerCsv() {
  if (!allLedgerRecords.length) return showToast("No records to export", "error");
  const headers = ["Timestamp", "Sender", "Recipient", "RecipientID", "Amount_NGN", "ChunksCompleted", "TotalChunks", "Status", "ID"];
  const rows = allLedgerRecords.map(r => [
    `"${r.timeStr || new Date(r.timestamp).toISOString()}"`,
    `"${r.sender || ''}"`,
    `"${r.recipient || ''}"`,
    `"${r.targetId || ''}"`,
    r.amount || 0,
    r.chunksCompleted || 0,
    r.totalChunks || 0,
    `"${r.status || ''}"`,
    `"${r.id || ''}"`
  ]);

  const csvContent = [headers.join(","), ...rows.map(e => e.join(","))].join("\n");
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `lagoslife_ledger_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  showToast("Spreadsheet exported!", "success");
}

function exportLedgerJson() {
  if (!allLedgerRecords.length) return showToast("No records to export", "error");
  const blob = new Blob([JSON.stringify(allLedgerRecords, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `lagoslife_ledger_backup_${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast("JSON backup exported!", "success");
}
