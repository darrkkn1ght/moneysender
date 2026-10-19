/* =========================================================
   LagosLife Cloud Hub — Mobile Controller
   ========================================================= */

const API = window.location.origin;
let currentPin = localStorage.getItem("lls_admin_pin") || "2026";
let accounts = [];
let activeCookieModalAccountId = null;

// Helpers
const $ = id => document.getElementById(id);

function getHeaders() {
  return {
    "content-type": "application/json",
    "x-admin-pin": currentPin
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

function showToast(msg, type = "info") {
  const container = $("toast-container");
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
  setupPinAuth();
  setupTabs();
  setupChips();
  setupActions();
  await refreshDashboard();
  setInterval(refreshDashboard, 4000); // Poll live progress & active transfers
});

// ---------------------------------------------------------
// PIN Security
// ---------------------------------------------------------
function setupPinAuth() {
  const modal = $("pin-modal");
  const pinInput = $("pin-input");
  const btnUnlock = $("btn-unlock-pin");
  const pinErr = $("pin-error");

  const verify = async pin => {
    try {
      const res = await fetch(`${API}/api/auth/verify-pin`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pin })
      });
      if (res.ok) {
        currentPin = pin;
        localStorage.setItem("lls_admin_pin", pin);
        modal.classList.add("hidden");
        pinErr.classList.add("hidden");
        showToast("Hub Unlocked", "success");
        refreshDashboard();
      } else {
        pinErr.classList.remove("hidden");
      }
    } catch {
      modal.classList.add("hidden"); // local network bypass
    }
  };

  btnUnlock.addEventListener("click", () => verify(pinInput.value));
  pinInput.addEventListener("keyup", e => { if (e.key === "Enter") verify(pinInput.value); });

  $("btn-lock").addEventListener("click", () => {
    localStorage.removeItem("lls_admin_pin");
    currentPin = "";
    pinInput.value = "";
    modal.classList.remove("hidden");
  });

  if (!currentPin) {
    modal.classList.remove("hidden");
  } else {
    verify(currentPin);
  }
}

// ---------------------------------------------------------
// Tabs & Chips
// ---------------------------------------------------------
function setupTabs() {
  const tabs = document.querySelectorAll(".tab-btn");
  tabs.forEach(btn => {
    btn.addEventListener("click", () => {
      tabs.forEach(t => t.classList.remove("active"));
      document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));
      btn.classList.add("active");
      const target = $(`tab-${btn.dataset.tab}`);
      if (target) target.classList.add("active");
    });
  });
}

function setupChips() {
  document.querySelectorAll(".chip[data-val]").forEach(c => {
    c.addEventListener("click", e => {
      e.preventDefault();
      $("single-amount").value = c.dataset.val;
    });
  });

  document.querySelectorAll(".chip[data-batch-val]").forEach(c => {
    c.addEventListener("click", e => {
      e.preventDefault();
      $("batch-amount-per").value = c.dataset.batchVal;
    });
  });

  // Split calculation updater
  const updateSplitSum = () => {
    const miles = (Number($("split-miles-amt").value) || 0) * 1e9;
    const prince = (Number($("split-prince-amt").value) || 0) * 1e9;
    const blaq = (Number($("split-blaq-amt").value) || 0) * 1e9;
    const total = miles + prince + blaq;
    $("split-total-label").textContent = fmtMoney(total);
  };
  ["split-miles-amt", "split-prince-amt", "split-blaq-amt"].forEach(id => {
    $(id).addEventListener("input", updateSplitSum);
  });
}

// ---------------------------------------------------------
// Dashboard & Accounts Loader
// ---------------------------------------------------------
async function refreshDashboard() {
  try {
    // 1. Fetch Accounts
    const accRes = await fetch(`${API}/api/accounts`, { headers: getHeaders() });
    if (accRes.ok) {
      accounts = await accRes.json();
      renderAccounts(accounts);
    }

    // 2. Fetch Active Transfers
    const activeRes = await fetch(`${API}/api/transfers/active`, { headers: getHeaders() });
    if (activeRes.ok) {
      const activeJobs = await activeRes.json();
      renderActiveTransfers(activeJobs);
    }

    // 3. Fetch History
    const histRes = await fetch(`${API}/api/transfers/history`, { headers: getHeaders() });
    if (histRes.ok) {
      const hist = await histRes.json();
      renderHistory(hist);
    }
  } catch (err) {
    console.error("Dashboard refresh err:", err);
  }
}

function renderAccounts(accs) {
  const grid = $("accounts-grid");
  grid.innerHTML = "";
  let totalWealth = 0;

  accs.forEach(a => {
    totalWealth += (a.money || 0);

    const card = document.createElement("div");
    card.className = "account-card";
    const isPrince = (a.user || "").includes("princedavid");

    card.innerHTML = `
      <div class="account-top">
        <span class="account-name">${a.name || a.user}</span>
        <span class="status-badge ${a.status === "ACTIVE" ? "active" : "expired"}">
          ${a.status === "ACTIVE" ? "● Ready" : "● Stale"}
        </span>
      </div>
      <div class="account-money">${fmtMoney(a.money)}</div>
      <div class="account-actions-row">
        <button class="btn-card-action" onclick="openCookieModal('${a.id}', '${a.name}')">✏️ Cookie</button>
        ${isPrince ? `<button class="btn-card-action" onclick="triggerPrinceLogin()">⚡ Auto-Login</button>` : ""}
      </div>
    `;
    grid.appendChild(card);
  });

  $("total-treasury").textContent = fmtMoney(totalWealth);
  $("accounts-count-pill").textContent = `${accs.length} Active`;

  // Update selects
  const singleSel = $("single-sender-select");
  const batchSel = $("batch-sender-select");
  if (singleSel.options.length !== accs.length) {
    singleSel.innerHTML = "";
    batchSel.innerHTML = "";
    accs.forEach(a => {
      singleSel.innerHTML += `<option value="${a.id}">${a.name} (${fmtMoney(a.money)})</option>`;
      batchSel.innerHTML += `<option value="${a.id}">${a.name} (${fmtMoney(a.money)})</option>`;
    });
  }
}

// ---------------------------------------------------------
// Recipient Live Lookup
// ---------------------------------------------------------
async function lookupUser(query) {
  if (!query) return;
  const prevBox = $("recipient-preview");
  const prevName = $("prev-name");
  const prevId = $("prev-id");

  try {
    const res = await fetch(`${API}/api/resolve-recipient?q=${encodeURIComponent(query)}`);
    if (res.ok) {
      const data = await res.json();
      prevBox.classList.remove("hidden");
      prevName.textContent = data.name ? `${data.name} (@${data.username})` : `@${data.username}`;
      prevId.textContent = data.id;
      showToast(`Found: ${data.name || data.username}`, "success");
      return data.id;
    }
  } catch (err) {
    console.error("Lookup error:", err);
  }
}

// ---------------------------------------------------------
// Active Transfer Render
// ---------------------------------------------------------
function renderActiveTransfers(jobs) {
  const container = $("active-transfers-list");
  const badge = $("active-jobs-badge");
  badge.textContent = `${jobs.length} Active`;

  if (!jobs || jobs.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">☕</div>
        <p>No active transfers running right now. Pick an account and send above!</p>
      </div>
    `;
    return;
  }

  container.innerHTML = "";
  jobs.forEach(j => {
    const pct = j.total > 0 ? Math.min(100, Math.round(((j.total - j.remaining) / j.total) * 100)) : 0;
    const card = document.createElement("div");
    card.className = "transfer-job-card";

    const lastLog = j.logs && j.logs.length > 0 ? j.logs[j.logs.length - 1] : "Active...";

    card.innerHTML = `
      <div class="job-header">
        <span class="job-title">💸 ${j.sender} ➔ ${j.originalInput || j.target}</span>
        <button class="btn-stop-job" onclick="stopJob('${j.id}')">Stop</button>
      </div>
      <div class="job-progress-bar-bg">
        <div class="job-progress-bar-fill" style="width: ${pct}%"></div>
      </div>
      <div class="job-meta-row">
        <span>Progress: ${pct}% (${j.txCount || 0} / ${j.totalTxs || 1} TXs)</span>
        <span>Left: ${fmtMoney(j.remaining)}</span>
      </div>
      <div class="job-logs-drawer">${lastLog}</div>
    `;
    container.appendChild(card);
  });
}

function renderHistory(jobs) {
  const container = $("history-transfers-list");
  if (!jobs || jobs.length === 0) {
    container.innerHTML = `<p style="font-size:12px; color:var(--text-dim); text-align:center;">No completed transfers yet.</p>`;
    return;
  }
  container.innerHTML = jobs.filter(j => j.status !== "RUNNING").slice(0, 10).map(j => `
    <div style="display:flex; justify-content:space-between; padding:8px 0; border-bottom:1px solid rgba(255,255,255,0.05); font-size:12px;">
      <span>${j.sender} ➔ ${j.originalInput || j.target}</span>
      <span style="font-family:var(--font-mono); color:${j.status === 'COMPLETED' ? 'var(--accent-primary)' : 'var(--accent-danger)'}">${fmtMoney(j.total)} (${j.status})</span>
    </div>
  `).join("");
}

// ---------------------------------------------------------
// User Actions
// ---------------------------------------------------------
function setupActions() {
  $("btn-refresh-data").addEventListener("click", () => {
    refreshDashboard();
    showToast("Balances Refreshed", "info");
  });

  $("btn-lookup-user").addEventListener("click", e => {
    e.preventDefault();
    lookupUser($("single-recipient").value);
  });

  $("single-recipient").addEventListener("blur", () => {
    lookupUser($("single-recipient").value);
  });

  // Preset 500B Split Button
  $("btn-apply-500b-split").addEventListener("click", () => {
    $("split-miles-amt").value = "200";
    $("split-prince-amt").value = "200";
    $("split-blaq-amt").value = "100";
    $("split-total-label").textContent = "₦500.00B";
    showToast("Loaded 500B Triple Preset", "info");
  });

  // Execute Single
  $("btn-execute-single").addEventListener("click", async () => {
    const accountId = $("single-sender-select").value;
    const to = $("single-recipient").value.trim();
    let rawAmt = $("single-amount").value.trim().toLowerCase();

    if (!to || !rawAmt) return showToast("Recipient and amount required", "error");

    let amount = 0;
    if (rawAmt.endsWith("t")) amount = parseFloat(rawAmt) * 1e12;
    else if (rawAmt.endsWith("b")) amount = parseFloat(rawAmt) * 1e9;
    else if (rawAmt.endsWith("m")) amount = parseFloat(rawAmt) * 1e6;
    else amount = parseFloat(rawAmt);

    try {
      const res = await fetch(`${API}/api/transfers/send`, {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify({ accountId, to, amount })
      });
      const data = await res.json();
      if (res.ok) {
        showToast("Transfer started in background!", "success");
        refreshDashboard();
      } else {
        showToast(data.error || "Failed to start transfer", "error");
      }
    } catch (err) {
      showToast(err.message, "error");
    }
  });

  // Execute Split
  $("btn-execute-split").addEventListener("click", async () => {
    const to = $("split-recipient").value.trim();
    if (!to) return showToast("Target recipient required", "error");

    const milesAcc = accounts.find(a => (a.user || "").includes("milespete"));
    const princeAcc = accounts.find(a => (a.user || "").includes("princedavid"));
    const blaqAcc = accounts.find(a => (a.user || "").includes("blaqsebastian"));

    const plans = [];
    const mVal = (Number($("split-miles-amt").value) || 0) * 1e9;
    const pVal = (Number($("split-prince-amt").value) || 0) * 1e9;
    const bVal = (Number($("split-blaq-amt").value) || 0) * 1e9;

    if (milesAcc && mVal > 0) plans.push({ accountId: milesAcc.id, amount: mVal });
    if (princeAcc && pVal > 0) plans.push({ accountId: princeAcc.id, amount: pVal });
    if (blaqAcc && bVal > 0) plans.push({ accountId: blaqAcc.id, amount: bVal });

    try {
      const res = await fetch(`${API}/api/transfers/split`, {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify({ to, plans })
      });
      const data = await res.json();
      if (res.ok) {
        showToast("Concurrent Split Transfer Launched!", "success");
        refreshDashboard();
      } else {
        showToast(data.error || "Split failed", "error");
      }
    } catch (err) {
      showToast(err.message, "error");
    }
  });

  // Execute Batch List
  $("btn-execute-batch").addEventListener("click", async () => {
    const accountId = $("batch-sender-select").value;
    const rawLines = $("batch-recipients").value.split(/[\n,]/).map(s => s.trim()).filter(Boolean);
    const amountPerUser = Number($("batch-amount-per").value) || 10_000_000_000;

    if (rawLines.length === 0) return showToast("Paste at least one username", "error");

    try {
      const res = await fetch(`${API}/api/transfers/batch`, {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify({ accountId, recipients: rawLines, amountPerUser })
      });
      const data = await res.json();
      if (res.ok) {
        showToast(`Batch distribution started for ${rawLines.length} users!`, "success");
        refreshDashboard();
      } else {
        showToast(data.error || "Batch failed", "error");
      }
    } catch (err) {
      showToast(err.message, "error");
    }
  });

  // Cookie modal events
  $("btn-close-cookie-modal").addEventListener("click", () => $("cookie-modal").classList.add("hidden"));
  $("btn-save-cookie").addEventListener("click", async () => {
    const cookie = $("modal-cookie-input").value.trim();
    if (!cookie || !activeCookieModalAccountId) return;
    try {
      const res = await fetch(`${API}/api/accounts/update-cookie`, {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify({ accountId: activeCookieModalAccountId, cookie })
      });
      if (res.ok) {
        showToast("Session cookie updated!", "success");
        $("cookie-modal").classList.add("hidden");
        refreshDashboard();
      } else {
        showToast("Failed to update cookie", "error");
      }
    } catch (err) {
      showToast(err.message, "error");
    }
  });
}

// Global functions attached to window
window.openCookieModal = (id, name) => {
  activeCookieModalAccountId = id;
  $("modal-acc-title").textContent = `Update ${name}`;
  $("modal-cookie-input").value = "";
  $("cookie-modal").classList.remove("hidden");
};

window.triggerPrinceLogin = async () => {
  showToast("Auto-Logging into PrinceDavid...", "info");
  try {
    const res = await fetch(`${API}/api/accounts/login-prince`, {
      method: "POST",
      headers: getHeaders()
    });
    const data = await res.json();
    if (res.ok) {
      showToast("PrinceDavid session renewed successfully!", "success");
      refreshDashboard();
    } else {
      showToast(data.error || "Login failed", "error");
    }
  } catch (err) {
    showToast(err.message, "error");
  }
};

window.stopJob = async jobId => {
  try {
    const res = await fetch(`${API}/api/transfers/stop`, {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({ jobId })
    });
    if (res.ok) {
      showToast("Transfer stopped", "info");
      refreshDashboard();
    }
  } catch (err) {
    showToast(err.message, "error");
  }
};
