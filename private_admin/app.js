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
  if (clean.endsWith("q")) return parseFloat(clean) * 1e15;
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
  setupScheduleHandlers();
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

    let scheduledAt = null;
    if ($("single-schedule-toggle")?.checked) {
      const rawTime = $("single-schedule-time")?.value;
      if (!rawTime) return showToast("Select a scheduled date and time", "error");
      const ts = new Date(rawTime).getTime();
      if (ts <= Date.now()) return showToast("Scheduled time must be in the future", "error");
      scheduledAt = new Date(ts).toISOString();
    }

    const btn = $("btn-execute-single");
    btn.disabled = true;
    btn.textContent = scheduledAt ? "Scheduling..." : "Dispatching...";

    try {
      const res = await fetch(`${API}/api/transfers/send`, {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify({ accountId, to, amount, scheduledAt })
      });

      if (res.status === 401) {
        showToast("Session expired. Please log in.", "error");
        window.location.href = "/login";
        return;
      }

      const data = await res.json();
      if (res.ok) {
        if (data.scheduled) {
          showToast(`Transfer scheduled for ${new Date(scheduledAt).toLocaleString()}!`, "success");
        } else {
          showToast(`Transfer started: ${fmtMoney(amount)} to ${to}`, "success");
        }
        $("single-recipient").value = "";
        $("single-amount").value = "";
        $("recipient-preview").classList.add("hidden");
        if ($("single-schedule-toggle")) {
          $("single-schedule-toggle").checked = false;
          $("single-schedule-panel").classList.add("hidden");
          $("single-btn-label").textContent = "🚀 Initiate Transfer";
        }
        refreshDashboard();
        refreshLedger();
      } else {
        showToast(data.error || "Transfer failed", "error");
      }
    } catch (e) {
      showToast(e.message, "error");
    } finally {
      btn.disabled = false;
      btn.innerHTML = `<span id="single-btn-label">${$("single-schedule-toggle")?.checked ? "⏰ Schedule Transfer" : "🚀 Initiate Transfer"}</span>`;
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

    let scheduledAt = null;
    if ($("split-schedule-toggle")?.checked) {
      const rawTime = $("split-schedule-time")?.value;
      if (!rawTime) return showToast("Select a scheduled date and time", "error");
      const ts = new Date(rawTime).getTime();
      if (ts <= Date.now()) return showToast("Scheduled time must be in the future", "error");
      scheduledAt = new Date(ts).toISOString();
    }

    const btn = $("btn-execute-split");
    btn.disabled = true;
    btn.textContent = scheduledAt ? "Scheduling Parallel Split..." : "Launching Parallel Legs...";

    try {
      const res = await fetch(`${API}/api/transfers/split`, {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify({ to, plans, scheduledAt })
      });

      const data = await res.json();
      if (res.ok) {
        if (data.scheduled) {
          showToast(`Split transfer scheduled across ${plans.length} senders for ${new Date(scheduledAt).toLocaleString()}!`, "success");
        } else {
          showToast(`Split transfer initiated across ${plans.length} senders!`, "success");
        }
        $("split-recipient").value = "";
        if ($("split-schedule-toggle")) {
          $("split-schedule-toggle").checked = false;
          $("split-schedule-panel").classList.add("hidden");
          $("split-btn-label").textContent = "⚡ Launch Concurrent Split";
        }
        refreshDashboard();
        refreshLedger();
      } else {
        showToast(data.error || "Split failed", "error");
      }
    } catch (e) {
      showToast(e.message, "error");
    } finally {
      btn.disabled = false;
      btn.innerHTML = `<span id="split-btn-label">${$("split-schedule-toggle")?.checked ? "⏰ Schedule Split" : "⚡ Launch Concurrent Split"}</span>`;
    }
  });

  // Batch Distribution
  $("btn-execute-batch")?.addEventListener("click", async () => {
    const accountId = $("batch-sender-select").value;
    const rawRecipients = $("batch-recipients").value.trim();
    const rawAmt = $("batch-amount-per").value.trim();
    const amountPerUser = parseAmount(rawAmt);

    const recipients = rawRecipients.split(/[\n,]+/).map(s => s.trim().replace(/^[\d\.\-\*\•\)\(\]\"\'\s]+/, "").replace(/[\"\'\,]/g, "").trim().replace(/^@/, "")).filter(Boolean);
    if (recipients.length === 0) return showToast("Add at least one recipient", "error");
    if (!amountPerUser || amountPerUser <= 0) return showToast("Enter a valid amount per recipient", "error");

    let scheduledAt = null;
    if ($("batch-schedule-toggle")?.checked) {
      const rawTime = $("batch-schedule-time")?.value;
      if (!rawTime) return showToast("Select a scheduled date and time", "error");
      const ts = new Date(rawTime).getTime();
      if (ts <= Date.now()) return showToast("Scheduled time must be in the future", "error");
      scheduledAt = new Date(ts).toISOString();
    }

    const btn = $("btn-execute-batch");
    btn.disabled = true;
    btn.textContent = scheduledAt ? "Scheduling Batch..." : "Starting Batch...";

    try {
      const res = await fetch(`${API}/api/transfers/batch`, {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify({ accountId, recipients, amountPerUser, scheduledAt })
      });

      const data = await res.json();
      if (res.ok) {
        if (data.scheduled) {
          showToast(`Batch scheduled for ${recipients.length} recipients at ${new Date(scheduledAt).toLocaleString()}!`, "success");
        } else {
          showToast(`Batch queued for ${recipients.length} recipients!`, "success");
        }
        $("batch-recipients").value = "";
        if ($("batch-schedule-toggle")) {
          $("batch-schedule-toggle").checked = false;
          $("batch-schedule-panel").classList.add("hidden");
          $("batch-btn-label").textContent = "📤 Distribute to All";
        }
        refreshDashboard();
        refreshLedger();
      } else {
        showToast(data.error || "Batch failed", "error");
      }
    } catch (e) {
      showToast(e.message, "error");
    } finally {
      btn.disabled = false;
      btn.innerHTML = `<span id="batch-btn-label">${$("batch-schedule-toggle")?.checked ? "⏰ Schedule Batch" : "📤 Distribute to All"}</span>`;
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
// Schedule Handlers & Presets
// ---------------------------------------------------------
function setupScheduleHandlers() {
  const modes = [
    { toggle: "single-schedule-toggle", panel: "single-schedule-panel", input: "single-schedule-time", preview: "single-schedule-preview", btn: "single-btn-label", defaultLabel: "🚀 Initiate Transfer", schedLabel: "⏰ Schedule Transfer" },
    { toggle: "split-schedule-toggle", panel: "split-schedule-panel", input: "split-schedule-time", preview: "split-schedule-preview", btn: "split-btn-label", defaultLabel: "⚡ Launch Concurrent Split", schedLabel: "⏰ Schedule Split" },
    { toggle: "batch-schedule-toggle", panel: "batch-schedule-panel", input: "batch-schedule-time", preview: "batch-schedule-preview", btn: "batch-btn-label", defaultLabel: "📤 Distribute to All", schedLabel: "⏰ Schedule Batch" }
  ];

  modes.forEach(m => {
    const toggleEl = $(m.toggle);
    const panelEl = $(m.panel);
    const inputEl = $(m.input);
    const prevEl = $(m.preview);
    const btnEl = $(m.btn);

    toggleEl?.addEventListener("change", () => {
      if (toggleEl.checked) {
        panelEl?.classList.remove("hidden");
        if (btnEl) btnEl.textContent = m.schedLabel;
        if (!inputEl?.value) {
          const def = new Date(Date.now() + 60 * 60 * 1000);
          inputEl.value = toLocalISOString(def);
          updateSchedulePreview(inputEl, prevEl);
        }
      } else {
        panelEl?.classList.add("hidden");
        if (btnEl) btnEl.textContent = m.defaultLabel;
      }
    });

    inputEl?.addEventListener("input", () => {
      updateSchedulePreview(inputEl, prevEl);
    });
  });

  document.querySelectorAll(".btn-preset-chip").forEach(chip => {
    chip.addEventListener("click", e => {
      e.preventDefault();
      const target = chip.dataset.target;
      const inputEl = $(`${target}-schedule-time`);
      const prevEl = $(`${target}-schedule-preview`);
      if (!inputEl) return;

      const offset = Number(chip.dataset.offset);
      const preset = chip.dataset.preset;
      let targetDate;

      if (offset) {
        targetDate = new Date(Date.now() + offset * 60 * 1000);
      } else if (preset === "tonight12") {
        targetDate = new Date();
        targetDate.setHours(23, 59, 0, 0);
        if (targetDate.getTime() <= Date.now()) {
          targetDate.setDate(targetDate.getDate() + 1);
        }
      } else if (preset === "tomorrow6") {
        targetDate = new Date();
        targetDate.setDate(targetDate.getDate() + 1);
        targetDate.setHours(6, 0, 0, 0);
      }

      if (targetDate) {
        inputEl.value = toLocalISOString(targetDate);
        updateSchedulePreview(inputEl, prevEl);
      }
    });
  });
}

function toLocalISOString(date) {
  const pad = n => String(n).padStart(2, '0');
  const yyyy = date.getFullYear();
  const MM = pad(date.getMonth() + 1);
  const dd = pad(date.getDate());
  const hh = pad(date.getHours());
  const mm = pad(date.getMinutes());
  return `${yyyy}-${MM}-${dd}T${hh}:${mm}`;
}

function updateSchedulePreview(inputEl, prevEl) {
  if (!inputEl || !prevEl) return;
  if (!inputEl.value) {
    prevEl.textContent = "";
    return;
  }
  const dt = new Date(inputEl.value);
  const diff = dt.getTime() - Date.now();
  if (diff <= 0) {
    prevEl.textContent = "⚠️ Selected time is in the past! Choose a future time.";
    prevEl.style.color = "#f87171";
  } else {
    prevEl.textContent = `Commences in ~${formatCountdown(diff)} (${dt.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })})`;
    prevEl.style.color = "#d8b4fe";
  }
}

function formatCountdown(ms) {
  if (ms <= 0) return "Moments away...";
  const totalSec = Math.floor(ms / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;

  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
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
        const scheduledCount = activeJobs.filter(j => j.status === "SCHEDULED").length;
        const parts = [];
        if (runningCount > 0) parts.push(`${runningCount} Running`);
        if (pausedCount > 0) parts.push(`${pausedCount} Paused`);
        if (scheduledCount > 0) parts.push(`${scheduledCount} Scheduled`);
        pill.textContent = parts.length > 0 ? parts.join(", ") : "0 Running";
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
    container.innerHTML = `<div class="empty-state">No transfers currently executing or scheduled.</div>`;
    return;
  }

  container.innerHTML = "";
  jobs.forEach(job => {
    const isPaused = job.status === "PAUSED";
    const isScheduled = job.status === "SCHEDULED";
    const el = document.createElement("div");
    el.className = `job-card ${isScheduled ? 'scheduled' : (isPaused ? 'paused' : 'running')}`;
    const pct = job.totalTxs > 0 ? Math.round((job.txCount / job.totalTxs) * 100) : 0;
    const latestLog = job.logs && job.logs.length ? job.logs[job.logs.length - 1] : (isScheduled ? "Scheduled" : (isPaused ? "Paused" : "Executing..."));

    let statusPillHtml = '';
    if (isScheduled) {
      statusPillHtml = `<span class="job-status-pill scheduled">⏰ SCHEDULED</span>`;
    } else if (isPaused) {
      statusPillHtml = `<span class="job-status-pill paused">⏸️ PAUSED</span>`;
    } else {
      statusPillHtml = `<span class="job-status-pill running">⚡ RUNNING</span>`;
    }

    let progressHtml = '';
    if (isScheduled) {
      const msLeft = (job.scheduledTimestamp || 0) - Date.now();
      const schedTimeStr = job.scheduledTimestamp ? new Date(job.scheduledTimestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
      const schedDateStr = job.scheduledTimestamp ? new Date(job.scheduledTimestamp).toLocaleDateString([], { month: 'short', day: 'numeric' }) : '';
      progressHtml = `
        <div class="job-amounts">
          <span>Amount: ${fmtMoney(job.total)}</span>
          <span class="mono" style="color: #c084fc;">Target: ${schedTimeStr} (${schedDateStr})</span>
        </div>
        <div class="schedule-preview-text" style="margin: 4px 0;">
          ⏳ Starts in: <strong>${formatCountdown(msLeft)}</strong>
        </div>
      `;
    } else {
      progressHtml = `
        <div class="job-amounts">
          <span>Sent: ${fmtMoney(job.total - job.remaining)} / ${fmtMoney(job.total)}</span>
          <span class="mono">${job.txCount} / ${job.totalTxs} txs (${pct}%)</span>
        </div>
        <div class="progress-bar-wrap">
          <div class="progress-fill ${isPaused ? 'paused-fill' : ''}" style="width: ${pct}%"></div>
        </div>
      `;
    }

    let actionsHtml = '';
    if (isScheduled) {
      actionsHtml = `
        <div class="job-actions-row">
          <button class="btn-job-action btn-start-now-job" data-id="${job.id}">⚡ Start Now</button>
          <button class="btn-job-action btn-stop-job" data-id="${job.id}">❌ Cancel Schedule</button>
        </div>
      `;
    } else if (isPaused) {
      actionsHtml = `
        <div class="job-actions-row">
          <button class="btn-job-action btn-resume-job" data-id="${job.id}">▶️ Resume</button>
          <button class="btn-job-action btn-stop-job" data-id="${job.id}">⏹️ Cancel</button>
        </div>
      `;
    } else {
      actionsHtml = `
        <div class="job-actions-row">
          <button class="btn-job-action btn-pause-job" data-id="${job.id}">⏸️ Pause</button>
          <button class="btn-job-action btn-stop-job" data-id="${job.id}">⏹️ Cancel</button>
        </div>
      `;
    }

    el.innerHTML = `
      <div class="job-header">
        <span class="job-type-pill">${job.type || 'TRANSFER'}</span>
        ${statusPillHtml}
      </div>
      <div class="job-body">
        <div class="job-route"><strong>${job.sender}</strong> → <strong>${job.targetLabel}</strong></div>
        ${progressHtml}
        <div class="job-log-snip mono">${latestLog}</div>
      </div>
      ${actionsHtml}
    `;

    // Start Now (for scheduled jobs)
    el.querySelector(".btn-start-now-job")?.addEventListener("click", async () => {
      try {
        const res = await fetch(`${API}/api/transfers/start-now`, {
          method: "POST",
          headers: getHeaders(),
          body: JSON.stringify({ jobId: job.id })
        });
        const data = await res.json();
        if (res.ok) {
          showToast(`Started transfer pipeline immediately!`, "success");
          refreshJobs();
        } else {
          showToast(data.error || "Failed to start", "error");
        }
      } catch (e) {
        showToast(e.message, "error");
      }
    });

    // Pause handler
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

    // Resume handler
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

    // Stop/Cancel handler
    el.querySelector(".btn-stop-job")?.addEventListener("click", async () => {
      try {
        const res = await fetch(`${API}/api/transfers/stop`, {
          method: "POST",
          headers: getHeaders(),
          body: JSON.stringify({ jobId: job.id })
        });
        if (res.ok) {
          showToast("Transfer job cancelled", "info");
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
