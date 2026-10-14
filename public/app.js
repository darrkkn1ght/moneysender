document.addEventListener("DOMContentLoaded", () => {
  // Navigation Tabs
  const navBtns = document.querySelectorAll(".nav-btn");
  const tabContents = document.querySelectorAll(".tab-content");

  navBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      navBtns.forEach(b => b.classList.remove("active"));
      tabContents.forEach(c => c.classList.remove("active"));

      btn.classList.add("active");
      const targetTab = btn.getAttribute("data-tab");
      document.getElementById(targetTab).classList.add("active");
    });
  });

  // Presets logic
  document.querySelectorAll(".btn-preset").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      document.getElementById("transfer-amount").value = btn.getAttribute("data-val");
    });
  });

  document.querySelectorAll(".btn-preset-qty").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      document.getElementById("shop-qty").value = btn.getAttribute("data-val");
    });
  });

  // Fetch Accounts & Populate Selects
  async function loadAccounts() {
    try {
      const res = await fetch("/api/accounts");
      const accounts = await res.json();

      const transferSelect = document.getElementById("transfer-account-select");
      const shopSelect = document.getElementById("shop-account-select");
      const accListContainer = document.getElementById("accounts-list-container");

      transferSelect.innerHTML = "";
      shopSelect.innerHTML = "";
      accListContainer.innerHTML = "";

      accounts.forEach(acc => {
        const opt1 = document.createElement("option");
        opt1.value = acc.id;
        opt1.textContent = acc.name;
        transferSelect.appendChild(opt1);

        const opt2 = document.createElement("option");
        opt2.value = acc.id;
        opt2.textContent = acc.name;
        shopSelect.appendChild(opt2);

        // Account list item
        const item = document.createElement("div");
        item.className = "account-card";
        item.innerHTML = `
          <div>
            <strong>${acc.name}</strong>
            <div style="font-size:11px; color:var(--text-muted); font-family:var(--font-mono); margin-top:2px;">
              ${acc.cookie.substring(0, 45)}...
            </div>
          </div>
          <button class="btn-danger" onclick="deleteAccount('${acc.id}')">Delete</button>
        `;
        accListContainer.appendChild(item);
      });
    } catch (err) {
      console.error("Error loading accounts:", err);
    }
  }

  // Fetch Favorites Recipients
  async function loadRecipients() {
    try {
      const res = await fetch("/api/recipients");
      const recipients = await res.json();
      const presetSelect = document.getElementById("recipient-preset-select");
      presetSelect.innerHTML = '<option value="">-- Saved Favorites --</option>';

      recipients.forEach(r => {
        const opt = document.createElement("option");
        opt.value = r.id;
        opt.textContent = `${r.name} (${r.id.substring(0, 8)}...)`;
        presetSelect.appendChild(opt);
      });

      presetSelect.addEventListener("change", () => {
        if (presetSelect.value) {
          document.getElementById("transfer-to").value = presetSelect.value;
        }
      });
    } catch (err) {
      console.error("Error loading recipients:", err);
    }
  }

  // Global Delete Account
  window.deleteAccount = async function(id) {
    if (!confirm("Are you sure you want to delete this account?")) return;
    await fetch(`/api/accounts/${id}`, { method: "DELETE" });
    loadAccounts();
  };

  // Add Account
  document.getElementById("btn-add-account").addEventListener("click", async () => {
    const name = document.getElementById("acc-name").value;
    const cookie = document.getElementById("acc-cookie").value;
    const rawHeaders = document.getElementById("acc-raw-headers").value;

    const res = await fetch("/api/accounts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, cookie, rawHeaders })
    });

    if (res.ok) {
      document.getElementById("acc-name").value = "";
      document.getElementById("acc-cookie").value = "";
      document.getElementById("acc-raw-headers").value = "";
      loadAccounts();
      alert("Account saved successfully!");
    } else {
      const data = await res.json();
      alert(`Error: ${data.error}`);
    }
  });

  // Launch Transfer
  document.getElementById("btn-start-transfer").addEventListener("click", async () => {
    const accountId = document.getElementById("transfer-account-select").value;
    const to = document.getElementById("transfer-to").value.trim();
    const targetAmount = document.getElementById("transfer-amount").value.trim();
    const batchSize = document.getElementById("transfer-batch").value.trim();
    const delaySec = document.getElementById("transfer-delay").value;

    if (!to || !targetAmount) {
      alert("Please enter Recipient ID and Target Amount!");
      return;
    }

    const res = await fetch("/api/jobs/transfer", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        accountId,
        to,
        targetAmount,
        batchSize,
        delayMs: Number(delaySec) * 1000
      })
    });

    if (res.ok) {
      loadJobs();
      alert("Transfer job launched successfully!");
    } else {
      const data = await res.json();
      alert(`Error: ${data.error}`);
    }
  });

  // Launch Bulk Shop Buy
  document.getElementById("btn-start-shop").addEventListener("click", async () => {
    const accountId = document.getElementById("shop-account-select").value;
    const productSelect = document.getElementById("shop-product-select");
    const product = productSelect.value;
    const price = productSelect.options[productSelect.selectedIndex].getAttribute("data-price");
    const qty = document.getElementById("shop-qty").value;
    const delaySec = document.getElementById("shop-delay").value;

    const res = await fetch("/api/jobs/buy", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        accountId,
        product,
        price,
        qty,
        delayMs: Number(delaySec) * 1000
      })
    });

    if (res.ok) {
      loadJobs();
      alert("Bulk shop buying job launched!");
    } else {
      const data = await res.json();
      alert(`Error: ${data.error}`);
    }
  });

  // Stop Job
  window.stopJob = async function(id) {
    await fetch(`/api/jobs/stop/${id}`, { method: "POST" });
    loadJobs();
  };

  // Load Jobs
  async function loadJobs() {
    try {
      const res = await fetch("/api/jobs");
      const jobs = await res.json();

      const transferMonitor = document.getElementById("transfer-monitor-container");
      const shopMonitor = document.getElementById("shop-monitor-container");
      const allJobsContainer = document.getElementById("all-jobs-container");

      transferMonitor.innerHTML = "";
      shopMonitor.innerHTML = "";
      allJobsContainer.innerHTML = "";

      let activeTransfer = null;
      let activeShop = null;

      jobs.forEach(job => {
        if (!activeTransfer && job.type === "TRANSFER" && job.status === "RUNNING") {
          activeTransfer = job;
        }
        if (!activeShop && job.type === "SHOP_BUY" && job.status === "RUNNING") {
          activeShop = job;
        }

        // Render job card for all jobs
        const jobCard = renderJobCard(job);
        allJobsContainer.appendChild(jobCard);
      });

      if (activeTransfer) {
        transferMonitor.appendChild(renderJobCard(activeTransfer));
      } else {
        transferMonitor.innerHTML = '<div class="empty-state">No active transfer running right now.</div>';
      }

      if (activeShop) {
        shopMonitor.appendChild(renderJobCard(activeShop));
      } else {
        shopMonitor.innerHTML = '<div class="empty-state">No bulk shop job running right now.</div>';
      }

    } catch (err) {
      console.error("Error loading jobs:", err);
    }
  }

  function renderJobCard(job) {
    const card = document.createElement("div");
    card.className = "job-item";

    let pct = 0;
    let detailsStr = "";

    if (job.type === "TRANSFER") {
      const targetB = BigInt(job.target);
      const remainingB = BigInt(job.remaining);
      const completedB = targetB - remainingB;
      pct = targetB > 0n ? Number((completedB * 100n) / targetB) : 0;
      detailsStr = `Account: ${job.accountName} | Recipient: ${job.to} | Progress: ${completedB.toString()} / ${targetB.toString()}`;
    } else {
      pct = job.targetQty > 0 ? Math.round((job.completedCount / job.targetQty) * 100) : 0;
      detailsStr = `Account: ${job.accountName} | Item: ${job.product} | Progress: ${job.completedCount} / ${job.targetQty}`;
    }

    const logLines = (job.logs || []).slice(-4).join("<br>");

    card.innerHTML = `
      <div class="job-header">
        <span class="job-title">${job.type === "TRANSFER" ? "💸 Money Transfer" : "🛒 Bulk Shop Buy"} (${job.id})</span>
        <span class="job-badge ${job.status}">${job.status}</span>
      </div>
      <div style="font-size:12px; color:var(--text-muted); margin-bottom:6px;">${detailsStr}</div>
      <div class="progress-bar-bg">
        <div class="progress-bar-fill" style="width: ${pct}%"></div>
      </div>
      <div style="display:flex; justify-content:space-between; align-items:center; margin-top:6px;">
        <span style="font-size:12px; font-weight:600; color:var(--primary);">${pct}% Complete</span>
        ${job.status === "RUNNING" ? `<button class="btn-danger" onclick="stopJob('${job.id}')">Stop Job</button>` : ""}
      </div>
      <div class="logs-box">${logLines}</div>
    `;

    return card;
  }

  function formatNaira(amountStr) {
    const val = BigInt(amountStr);
    if (val >= 1_000_000_000_000n) {
      return `₦${(Number(val) / 1e12).toFixed(2)} Trillion`;
    }
    if (val >= 1_000_000_000n) {
      return `₦${(Number(val) / 1e9).toFixed(1)} Billion`;
    }
    return `₦${val.toLocaleString()}`;
  }

  async function loadLivePipelines() {
    try {
      const res = await fetch("/api/transfers/live");
      const data = await res.json();
      const container = document.getElementById("live-pipelines-container");
      if (!container) return;

      if (!data.pipelines || data.pipelines.length === 0) {
        container.innerHTML = '<div class="card"><div class="empty-state">No live transfer pipelines active.</div></div>';
        return;
      }

      container.innerHTML = "";

      data.pipelines.forEach(p => {
        const card = document.createElement("div");
        card.className = "card";
        card.innerHTML = `
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
            <h3 style="font-size:16px; margin:0;">${p.name}</h3>
            <span class="job-badge RUNNING" style="background:${p.status === 'COMPLETED' ? '#16a34a' : '#2563eb'}; color:#fff; padding:3px 10px; border-radius:12px; font-size:11px; font-weight:700;">
              ${p.status}
            </span>
          </div>

          <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:14px; font-size:13px;">
            <div>
              <div style="color:var(--text-muted); font-size:11px; text-transform:uppercase; letter-spacing:0.5px;">Sender</div>
              <div style="font-weight:600; color:var(--text-dark);">${p.sender}</div>
            </div>
            <div>
              <div style="color:var(--text-muted); font-size:11px; text-transform:uppercase; letter-spacing:0.5px;">Recipient</div>
              <div style="font-weight:600; color:var(--text-dark);">${p.recipient}</div>
            </div>
            <div>
              <div style="color:var(--text-muted); font-size:11px; text-transform:uppercase; letter-spacing:0.5px;">Total Sent</div>
              <div style="font-size:16px; font-weight:700; color:#16a34a;">${formatNaira(p.sent)}</div>
            </div>
            <div>
              <div style="color:var(--text-muted); font-size:11px; text-transform:uppercase; letter-spacing:0.5px;">Remaining</div>
              <div style="font-size:16px; font-weight:700; color:#2563eb;">${formatNaira(p.remaining)}</div>
            </div>
          </div>

          <div style="margin-bottom:6px; display:flex; justify-content:space-between; font-size:12px; font-weight:600;">
            <span>Transactions: ${p.transactions} / ${p.totalTransactions}</span>
            <span style="color:#2563eb;">${p.percent}%</span>
          </div>

          <div class="progress-bar-bg" style="height:10px; background:#e2e8f0; border-radius:6px; overflow:hidden;">
            <div class="progress-bar-fill" style="width: ${p.percent}%; height:100%; background:linear-gradient(90deg, #2563eb, #3b82f6); border-radius:6px; transition:width 0.4s ease;"></div>
          </div>
        `;
        container.appendChild(card);
      });

    } catch (e) {
      console.error("Live pipelines fetch error:", e);
    }
  }

  // Initial Load & Auto Refresh
  loadAccounts();
  loadRecipients();
  loadJobs();
  loadLivePipelines();

  setInterval(loadJobs, 3000);
  setInterval(loadLivePipelines, 2000);
});
