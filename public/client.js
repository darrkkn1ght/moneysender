/* =========================================================
   LagosLife Treasury VIP — Client Controller
   ========================================================= */

const API = window.location.origin;
let clientToken = localStorage.getItem("lls_vip_token") || null;
let currentAccount = null;

const $ = id => document.getElementById(id);

function getHeaders() {
  const h = { "content-type": "application/json" };
  if (clientToken) h["x-client-token"] = clientToken;
  return h;
}

function fmtMoney(n) {
  if (n === null || n === undefined || isNaN(n)) return "₦0";
  const num = Number(n);
  if (num >= 1e15) return `₦${(num / 1e15).toFixed(2)}Q`;
  if (num >= 1e12) return `₦${(num / 1e12).toFixed(2)}T`;
  if (num >= 1e9) return `₦${(num / 1e9).toFixed(2)}B`;
  if (num >= 1e6) return `₦${(num / 1e6).toFixed(2)}M`;
  return `₦${num.toLocaleString()}`;
}

function parseAmount(raw) {
  const s = String(raw).trim().toLowerCase();
  if (s.endsWith("q")) return parseFloat(s) * 1e15;
  if (s.endsWith("t")) return parseFloat(s) * 1e12;
  if (s.endsWith("b")) return parseFloat(s) * 1e9;
  if (s.endsWith("m")) return parseFloat(s) * 1e6;
  return parseFloat(s) || 0;
}

function showToast(msg, type = "info") {
  const container = $("toast-container");
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

// ---------------------------------------------------------
// Init
// ---------------------------------------------------------
document.addEventListener("DOMContentLoaded", async () => {
  setupTabs();
  setupAuthEvents();
  setupActions();

  // Check URL query for 1-tap mobile import (?import=cookie...)
  const params = new URLSearchParams(window.location.search);
  const importCookie = params.get("import");
  if (importCookie) {
    showToast("Importing session from mobile link...", "info");
    await handleCookieImport(importCookie);
    window.history.replaceState({}, document.title, window.location.pathname);
    return;
  }

  if (clientToken) {
    await refreshClientSession();
  } else {
    showAuthView();
  }

  // Poll active transfers every 2.5s if logged in
  setInterval(() => {
    if (clientToken) refreshClientSession();
  }, 2500);
});

function showAuthView() {
  $("auth-section").classList.remove("hidden");
  $("dashboard-section").classList.add("hidden");
  $("header-account-pill").classList.add("hidden");
}

function showDashboardView(account) {
  currentAccount = account;
  $("auth-section").classList.add("hidden");
  $("dashboard-section").classList.remove("hidden");
  $("header-account-pill").classList.remove("hidden");
  $("user-display-name").textContent = `@${account.user}`;
  $("meta-user").textContent = `${account.name} (@${account.user})`;
  $("client-balance").textContent = fmtMoney(account.money);
}

// ---------------------------------------------------------
// Session API Calls
// ---------------------------------------------------------
async function refreshClientSession() {
  if (!clientToken) return;
  try {
    const res = await fetch(`${API}/api/client/status`, { headers: getHeaders() });
    if (res.ok) {
      const data = await res.json();
      showDashboardView(data.account);
      renderJobs(data.jobs || []);
    } else if (res.status === 401) {
      clientToken = null;
      localStorage.removeItem("lls_vip_token");
      showAuthView();
    }
  } catch (err) {
    console.error("Session refresh error:", err);
  }
}

async function handleCookieImport(cookie) {
  try {
    const res = await fetch(`${API}/api/client/import-cookie`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cookie: cookie.trim() })
    });
    const data = await res.json();
    if (res.ok) {
      clientToken = data.token;
      localStorage.setItem("lls_vip_token", data.token);
      showToast(`Welcome ${data.account.name}!`, "success");
      showDashboardView(data.account);
    } else {
      showToast(data.error || "Failed to import session", "error");
    }
  } catch (err) {
    showToast(err.message, "error");
  }
}

// ---------------------------------------------------------
// Auth Tabs & Handlers
// ---------------------------------------------------------
function setupTabs() {
  // Auth tabs (Login vs Cookie)
  document.querySelectorAll(".auth-tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".auth-tab-btn").forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".auth-tab-content").forEach(c => c.classList.remove("active"));
      btn.classList.add("active");
      const target = $(`auth-tab-${btn.dataset.auth}`);
      if (target) target.classList.add("active");
    });
  });

  // Mode tabs (Single vs Bulk)
  document.querySelectorAll(".mode-tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".mode-tab-btn").forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".mode-content").forEach(c => c.classList.remove("active"));
      btn.classList.add("active");
      const target = $(`mode-${btn.dataset.mode}`);
      if (target) target.classList.add("active");
    });
  });

  // Amount Chips for Single
  document.querySelectorAll("[data-amt]").forEach(chip => {
    chip.addEventListener("click", () => {
      document.querySelectorAll("[data-amt]").forEach(c => c.classList.remove("active"));
      chip.classList.add("active");
      const val = chip.dataset.amt;
      $("amount-input").value = fmtMoney(val).replace("₦", "");
    });
  });

  // Amount Chips for Bulk
  document.querySelectorAll("[data-bulk-amt]").forEach(chip => {
    chip.addEventListener("click", () => {
      document.querySelectorAll("[data-bulk-amt]").forEach(c => c.classList.remove("active"));
      chip.classList.add("active");
      $("bulk-amount-per").value = chip.dataset.bulkAmt;
    });
  });
}

function setupAuthEvents() {
  // Direct Login Submit
  $("btn-submit-login").addEventListener("click", async () => {
    const user = $("login-username").value.trim().replace(/^@/, "");
    const pass = $("login-password").value;
    if (!user || !pass) return showToast("Enter your username and password", "error");

    showToast("Connecting to LagosLife...", "info");
    try {
      const res = await fetch(`${API}/api/client/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: user, password: pass })
      });
      const data = await res.json();
      if (res.ok) {
        clientToken = data.token;
        localStorage.setItem("lls_vip_token", data.token);
        showToast(`Connected as ${data.account.name}!`, "success");
        showDashboardView(data.account);
      } else {
        showToast(data.error || "Login failed. Check credentials.", "error");
      }
    } catch (err) {
      showToast(err.message, "error");
    }
  });

  // Cookie Import Submit
  $("btn-submit-cookie").addEventListener("click", async () => {
    const raw = $("cookie-input").value.trim();
    if (!raw) return showToast("Paste your cookie string", "error");
    await handleCookieImport(raw);
  });

  // Copy Bookmarklet Code
  $("btn-copy-code").addEventListener("click", () => {
    const code = $("bookmarklet-code").textContent;
    navigator.clipboard.writeText(code);
    showToast("Bookmarklet code copied! Paste in lagoslife.app address bar", "success");
  });

  // Logout / Disconnect
  $("btn-logout").addEventListener("click", async () => {
    if (confirm("Disconnect and wipe your session from this server?")) {
      try {
        await fetch(`${API}/api/client/logout`, { method: "POST", headers: getHeaders() });
      } catch {}
      clientToken = null;
      localStorage.removeItem("lls_vip_token");
      currentAccount = null;
      showToast("Session wiped successfully", "info");
      showAuthView();
    }
  });

  // Refresh Balance Button
  $("btn-refresh-balance").addEventListener("click", async () => {
    await refreshClientSession();
    showToast("Balance updated", "info");
  });
}

// ---------------------------------------------------------
// Actions (Send & Bulk)
// ---------------------------------------------------------
function setupActions() {
  // Recipient Lookup
  $("btn-resolve").addEventListener("click", () => resolveRecipient($("target-input").value));
  $("target-input").addEventListener("blur", () => resolveRecipient($("target-input").value));

  // Single Transfer Launch
  $("btn-send-single").addEventListener("click", async () => {
    const to = $("target-input").value.trim();
    const rawAmt = $("amount-input").value.trim();
    if (!to || !rawAmt) return showToast("Recipient and amount required", "error");

    const amount = parseAmount(rawAmt);
    if (amount <= 0) return showToast("Invalid amount", "error");

    showToast("Starting transfer in background...", "info");
    try {
      const res = await fetch(`${API}/api/client/send`, {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify({ to, amount })
      });
      const data = await res.json();
      if (res.ok) {
        showToast("Transfer actively streaming!", "success");
        $("amount-input").value = "";
        refreshClientSession();
      } else {
        showToast(data.error || "Failed to start transfer", "error");
      }
    } catch (err) {
      showToast(err.message, "error");
    }
  });

  // Bulk Transfer Launch
  $("btn-send-bulk").addEventListener("click", async () => {
    const rawLines = $("bulk-recipients").value.split(/[\n,]/).map(s => s.trim()).filter(Boolean);
    const amountPer = Number($("bulk-amount-per").value) || 10_000_000_000;
    if (rawLines.length === 0) return showToast("Paste at least one username", "error");

    showToast(`Launching bulk send to ${rawLines.length} players...`, "info");
    try {
      const res = await fetch(`${API}/api/client/batch`, {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify({ recipients: rawLines, amountPerUser: amountPer })
      });
      const data = await res.json();
      if (res.ok) {
        showToast(`Bulk distribution running for ${rawLines.length} players!`, "success");
        $("bulk-recipients").value = "";
        refreshClientSession();
      } else {
        showToast(data.error || "Bulk send failed", "error");
      }
    } catch (err) {
      showToast(err.message, "error");
    }
  });
}

async function resolveRecipient(query) {
  if (!query) return;
  const prevBox = $("target-preview");
  const prevName = $("target-name");
  const prevId = $("target-id");

  try {
    const res = await fetch(`${API}/api/resolve-recipient?q=${encodeURIComponent(query)}`);
    if (res.ok) {
      const data = await res.json();
      prevBox.classList.remove("hidden");
      prevName.textContent = data.name ? `${data.name} (@${data.username})` : `@${data.username}`;
      prevId.textContent = data.id;
      return data.id;
    }
  } catch {}
}

// ---------------------------------------------------------
// Render Active Jobs
// ---------------------------------------------------------
function renderJobs(jobs) {
  const container = $("client-jobs-list");
  const badge = $("client-active-badge");
  const running = jobs.filter(j => j.status === "RUNNING");
  const paused = jobs.filter(j => j.status === "PAUSED");
  if (badge) {
    if (paused.length > 0 && running.length > 0) {
      badge.textContent = `${running.length} Running, ${paused.length} Paused`;
    } else if (paused.length > 0) {
      badge.textContent = `${paused.length} Paused`;
    } else {
      badge.textContent = `${running.length} Running`;
    }
  }

  if (!jobs || jobs.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">☕</div>
        <p>No active transfers running right now. Choose a recipient and amount above!</p>
      </div>
    `;
    return;
  }

  container.innerHTML = "";
  jobs.slice(0, 8).forEach(j => {
    const isPaused = j.status === "PAUSED";
    const isRunning = j.status === "RUNNING";
    const pct = j.total > 0 ? Math.min(100, Math.round(((j.total - j.remaining) / j.total) * 100)) : 0;
    const card = document.createElement("div");
    card.className = "job-card";

    const lastLog = j.logs && j.logs.length > 0 ? j.logs[j.logs.length - 1] : (isPaused ? "Paused" : "Sending...");

    let actionButtons = "";
    if (isRunning) {
      actionButtons = `
        <div class="job-actions">
          <button class="btn-pause" onclick="pauseClientJob('${j.id}')">⏸️ Pause</button>
          <button class="btn-stop" onclick="stopClientJob('${j.id}')">Stop</button>
        </div>
      `;
    } else if (isPaused) {
      actionButtons = `
        <div class="job-actions">
          <button class="btn-resume" onclick="resumeClientJob('${j.id}')">▶️ Resume</button>
          <button class="btn-stop" onclick="stopClientJob('${j.id}')">Stop</button>
        </div>
      `;
    } else {
      actionButtons = `<span style="font-size:11px; color:#10b981;">${j.status}</span>`;
    }

    card.innerHTML = `
      <div class="job-header">
        <span class="job-title">💸 To ${j.originalInput || j.targetLabel || j.target}</span>
        ${actionButtons}
      </div>
      <div class="progress-bar-bg">
        <div class="progress-bar-fill" style="width: ${pct}%; ${isPaused ? 'background: linear-gradient(90deg, #f59e0b, #d97706);' : ''}"></div>
      </div>
      <div class="job-meta">
        <span>Progress: ${pct}% (${j.txCount || 0} / ${j.totalTxs || 1} TXs)</span>
        <span>Left: ${fmtMoney(j.remaining)}</span>
      </div>
      <div class="job-log">${lastLog}</div>
    `;
    container.appendChild(card);
  });
}

window.pauseClientJob = async jobId => {
  try {
    const res = await fetch(`${API}/api/client/pause`, {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({ jobId })
    });
    if (res.ok) {
      showToast("Transfer paused", "info");
      refreshClientSession();
    }
  } catch (err) {
    showToast(err.message, "error");
  }
};

window.resumeClientJob = async jobId => {
  try {
    const res = await fetch(`${API}/api/client/resume`, {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({ jobId })
    });
    if (res.ok) {
      showToast("Transfer resumed!", "success");
      refreshClientSession();
    }
  } catch (err) {
    showToast(err.message, "error");
  }
};

window.stopClientJob = async jobId => {
  try {
    const res = await fetch(`${API}/api/client/stop`, {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({ jobId })
    });
    if (res.ok) {
      showToast("Transfer stopped", "info");
      refreshClientSession();
    }
  } catch (err) {
    showToast(err.message, "error");
  }
};
