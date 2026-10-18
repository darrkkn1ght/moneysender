/* ==========================================
   LagosLife Sender — App Logic
   Offline queue, bulk send, live monitoring
   ========================================== */

const API = window.location.origin;
const POLL_INTERVAL = 5000;

// ===== State =====
let accounts = [];
let sendQueue = [];
let isProcessingQueue = false;
let pollTimer = null;

// ===== DOM refs =====
const $ = id => document.getElementById(id);

// ===== Init =====
document.addEventListener('DOMContentLoaded', async () => {
  setupNetworkDetection();
  setupToastContainer();
  setupEventListeners();
  await loadAccounts();
  await refreshJobs();
  startPolling();
  loadQueueFromStorage();
});

// ===== Network Detection =====
function setupNetworkDetection() {
  const banner = $('offline-banner');
  const dot = $('connection-dot');

  const update = () => {
    if (navigator.onLine) {
      banner.classList.add('hidden');
      dot.classList.remove('offline');
      // Try to flush queue when coming back online
      if (sendQueue.length > 0 && !isProcessingQueue) {
        processQueue();
      }
    } else {
      banner.classList.remove('hidden');
      dot.classList.add('offline');
    }
  };

  window.addEventListener('online', update);
  window.addEventListener('offline', update);
  update();
}

// ===== Toast Notifications =====
function setupToastContainer() {
  const c = document.createElement('div');
  c.className = 'toast-container';
  c.id = 'toast-container';
  document.body.appendChild(c);
}

function toast(msg, type = 'info') {
  const c = $('toast-container');
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.textContent = msg;
  c.appendChild(t);
  setTimeout(() => t.remove(), 3200);
}

// ===== Accounts =====
async function loadAccounts() {
  try {
    const res = await fetch(`${API}/api/accounts`);
    accounts = await res.json();
  } catch {
    // Use cached accounts if offline
    const cached = localStorage.getItem('lls_accounts');
    if (cached) accounts = JSON.parse(cached);
  }

  // Cache accounts for offline use
  if (accounts.length) {
    localStorage.setItem('lls_accounts', JSON.stringify(accounts));
  }

  // Populate selects
  const sel = $('qs-account');
  sel.innerHTML = '';
  accounts.forEach(a => {
    const opt = document.createElement('option');
    opt.value = a.id;
    opt.textContent = a.name || a.id;
    sel.appendChild(opt);
  });

  // Populate accounts list
  renderAccountsList();
  $('accounts-count-label').textContent = `${accounts.length} saved`;
}

function renderAccountsList() {
  const container = $('accounts-list');
  if (!accounts.length) {
    container.innerHTML = '<div class="empty-state"><p>No accounts saved</p></div>';
    return;
  }

  container.innerHTML = accounts.map(a => `
    <div class="account-item">
      <div>
        <div class="account-name">${escHtml(a.name || a.id)}</div>
        <div class="account-cookie-preview">${a.cookie ? a.cookie.substring(0, 40) + '...' : 'No cookie'}</div>
      </div>
      <button class="btn-danger-sm" onclick="deleteAccount('${a.id}')">Remove</button>
    </div>
  `).join('');
}

async function deleteAccount(id) {
  try {
    await fetch(`${API}/api/accounts/${id}`, { method: 'DELETE' });
    toast('Account removed', 'success');
    await loadAccounts();
  } catch {
    toast('Failed to remove', 'error');
  }
}

async function saveAccount() {
  const name = $('acc-new-name').value.trim();
  const cookie = $('acc-new-cookie').value.trim();
  if (!cookie) return toast('Cookie required', 'error');

  try {
    await fetch(`${API}/api/accounts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, cookie })
    });
    toast('Account saved!', 'success');
    $('acc-new-name').value = '';
    $('acc-new-cookie').value = '';
    await loadAccounts();
  } catch {
    toast('Failed to save', 'error');
  }
}

// ===== Amount Parsing =====
function parseAmount(input) {
  if (!input) return 0n;
  const s = input.toString().trim().toLowerCase().replace(/,/g, '').replace(/₦/g, '').replace(/\s/g, '');

  // Handle shorthand: 100b, 1t, 500m
  const match = s.match(/^([\d.]+)\s*([btmk]?)$/);
  if (match) {
    const num = parseFloat(match[1]);
    const suffix = match[2];
    const multipliers = {
      'k': 1_000,
      'm': 1_000_000,
      'b': 1_000_000_000,
      't': 1_000_000_000_000,
      '': 1
    };
    return BigInt(Math.floor(num * (multipliers[suffix] || 1)));
  }

  // Raw number
  try { return BigInt(s); } catch { return 0n; }
}

function formatAmount(raw) {
  const n = BigInt(raw);
  if (n >= 1_000_000_000_000n) {
    const t = Number(n) / 1e12;
    return t % 1 === 0 ? `${t}T` : `${t.toFixed(1)}T`;
  }
  if (n >= 1_000_000_000n) {
    const b = Number(n) / 1e9;
    return b % 1 === 0 ? `${b}B` : `${b.toFixed(1)}B`;
  }
  if (n >= 1_000_000n) {
    const m = Number(n) / 1e6;
    return m % 1 === 0 ? `${m}M` : `${m.toFixed(1)}M`;
  }
  return n.toLocaleString();
}

// ===== Recipient Resolution =====
function extractRecipientFromUrl(input) {
  // Extract ID from URLs like: https://lagoslife.app/api/messages?with=XXXXX
  const match = input.match(/[?&]with=([a-f0-9]+)/i);
  if (match) return match[1];

  // Also try direct player URLs
  const playerMatch = input.match(/lagoslife\.app\/.*?([a-f0-9]{16,})/i);
  if (playerMatch) return playerMatch[1];

  return null;
}

function resolveRecipient(input) {
  if (!input) return '';
  const trimmed = input.trim();

  // Check if it's a URL
  const fromUrl = extractRecipientFromUrl(trimmed);
  if (fromUrl) return fromUrl;

  // Return as-is (server will resolve usernames)
  return trimmed;
}

// ===== Send Queue =====
function loadQueueFromStorage() {
  try {
    const saved = localStorage.getItem('lls_sendQueue');
    if (saved) {
      sendQueue = JSON.parse(saved);
      renderQueue();
    }
  } catch {}
}

function saveQueueToStorage() {
  localStorage.setItem('lls_sendQueue', JSON.stringify(sendQueue));
}

function addToQueue(entry) {
  sendQueue.push({
    id: `q_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
    ...entry,
    status: 'pending',
    addedAt: new Date().toISOString()
  });
  saveQueueToStorage();
  renderQueue();
  toast(`Queued: ${formatAmount(entry.amount)} → ${entry.toDisplay}`, 'info');
}

function removeFromQueue(id) {
  sendQueue = sendQueue.filter(q => q.id !== id);
  saveQueueToStorage();
  renderQueue();
}

function renderQueue() {
  const container = $('queue-list');
  const badge = $('queue-badge');
  const count = $('queue-count');
  const execBtn = $('btn-execute-queue');

  const pending = sendQueue.filter(q => q.status === 'pending');
  count.textContent = pending.length;

  if (pending.length > 0) {
    badge.textContent = pending.length;
    badge.classList.remove('hidden');
    execBtn.disabled = false;
  } else {
    badge.classList.add('hidden');
    execBtn.disabled = true;
  }

  if (sendQueue.length === 0) {
    container.innerHTML = '<div class="empty-state"><p>No sends queued yet. Add sends above.</p></div>';
    return;
  }

  container.innerHTML = sendQueue.map(q => `
    <div class="queue-item">
      <div class="queue-item-info">
        <div class="queue-item-to">${escHtml(q.toDisplay)}</div>
        <div class="queue-item-meta">from ${escHtml(q.accountName)} · ${q.status}</div>
      </div>
      <div class="queue-item-amount">${formatAmount(q.amount)}</div>
      ${q.status === 'pending' ? `
        <button class="queue-remove" onclick="removeFromQueue('${q.id}')" title="Remove">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      ` : ''}
    </div>
  `).join('');
}

async function processQueue() {
  const pending = sendQueue.filter(q => q.status === 'pending');
  if (!pending.length || isProcessingQueue) return;

  isProcessingQueue = true;
  toast(`Processing ${pending.length} queued sends...`, 'info');

  for (const item of pending) {
    if (!navigator.onLine) {
      toast('Offline — remaining sends stay queued', 'error');
      break;
    }

    item.status = 'sending';
    renderQueue();

    try {
      const resp = await fetch(`${API}/api/jobs/transfer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountId: item.accountId,
          to: item.to,
          targetAmount: item.amount.toString(),
          batchSize: item.batchSize || '10000000000',
          delayMs: item.delayMs || 25000
        })
      });

      if (resp.ok) {
        item.status = 'started';
        toast(`✓ Started: ${formatAmount(item.amount)} → ${item.toDisplay}`, 'success');
      } else {
        const err = await resp.text();
        item.status = 'failed';
        toast(`✗ Failed: ${item.toDisplay} — ${err}`, 'error');
      }
    } catch (e) {
      item.status = 'failed';
      toast(`✗ Network error for ${item.toDisplay}`, 'error');
    }

    saveQueueToStorage();
    renderQueue();

    // Small delay between queue items to avoid flooding
    await new Promise(r => setTimeout(r, 1500));
  }

  // Clean up completed items from queue
  sendQueue = sendQueue.filter(q => q.status !== 'started');
  saveQueueToStorage();
  renderQueue();
  isProcessingQueue = false;

  // Refresh jobs list
  await refreshJobs();
}

// ===== Quick Send =====
function getFormValues() {
  const accountId = $('qs-account').value;
  const account = accounts.find(a => a.id === accountId);
  const recipientRaw = $('qs-recipient').value.trim();
  const recipient = resolveRecipient(recipientRaw);
  const amount = parseAmount($('qs-amount').value);
  const delay = parseInt($('qs-delay').value) * 1000 || 25000;
  const batchSize = $('qs-batch').value || '10000000000';

  return {
    accountId,
    accountName: account?.name || accountId,
    to: recipient,
    toDisplay: recipientRaw.length > 30 ? recipient : recipientRaw,
    amount: amount.toString(),
    batchSize,
    delayMs: delay
  };
}

async function sendNow() {
  const vals = getFormValues();
  if (!vals.to) return toast('Enter a recipient', 'error');
  if (vals.amount === '0') return toast('Enter an amount', 'error');

  const btn = $('btn-send-now');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Sending...';

  try {
    const resp = await fetch(`${API}/api/jobs/transfer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        accountId: vals.accountId,
        to: vals.to,
        targetAmount: vals.amount,
        batchSize: vals.batchSize,
        delayMs: vals.delayMs
      })
    });

    if (resp.ok) {
      toast(`✓ Transfer started: ${formatAmount(vals.amount)} → ${vals.toDisplay}`, 'success');
      $('qs-recipient').value = '';
      $('qs-amount').value = '';
      $('qs-resolved-hint').textContent = '';
      await refreshJobs();
    } else {
      const err = await resp.text();
      toast(`Failed: ${err}`, 'error');
    }
  } catch (e) {
    // Offline — add to queue instead
    if (!navigator.onLine) {
      addToQueue(vals);
      toast('Offline — added to queue', 'info');
    } else {
      toast(`Network error: ${e.message}`, 'error');
    }
  }

  btn.disabled = false;
  btn.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg> Send Now`;
}

// ===== Jobs Monitoring =====
async function refreshJobs() {
  try {
    const res = await fetch(`${API}/api/jobs`);
    const jobs = await res.json();
    renderJobs(jobs);
  } catch {}
}

function renderJobs(jobs) {
  const activeContainer = $('active-jobs-list');
  const historyContainer = $('history-jobs-list');

  const active = jobs.filter(j => j.status === 'RUNNING');
  const history = jobs.filter(j => j.status !== 'RUNNING');

  // Active count
  $('active-count-label').textContent = active.length ? `${active.length} running` : 'None running';

  // Render active
  if (!active.length) {
    activeContainer.innerHTML = '<div class="empty-state"><p>No active transfers</p></div>';
  } else {
    activeContainer.innerHTML = active.map(j => renderJobCard(j)).join('');
  }

  // History count
  $('history-count-label').textContent = `${history.length} completed`;

  // Render history (most recent first, limit 20)
  if (!history.length) {
    historyContainer.innerHTML = '<div class="empty-state"><p>No history yet</p></div>';
  } else {
    historyContainer.innerHTML = history.slice(0, 20).map(j => renderJobCard(j)).join('');
  }
}

function renderJobCard(job) {
  const target = BigInt(job.target || '0');
  const remaining = BigInt(job.remaining || '0');
  const sent = target - remaining;
  const pct = target > 0n ? Number((sent * 10000n) / target) / 100 : 0;
  const statusClass = job.status.toLowerCase();

  const lastLogs = (job.logs || []).slice(-5).join('\n');

  return `
    <div class="job-card">
      <div class="job-header">
        <span class="job-title">${escHtml(job.originalInput || job.to || 'Transfer')}</span>
        <span class="job-status ${statusClass}">${job.status}</span>
      </div>
      <div class="progress-bar-container">
        <div class="progress-bar-fill ${job.status === 'RUNNING' ? 'active' : ''}" style="width: ${pct}%"></div>
      </div>
      <div class="job-stats">
        <span>Sent: <span class="job-stat-value">${formatAmount(sent)}</span></span>
        <span>Target: <span class="job-stat-value">${formatAmount(target)}</span></span>
        <span><span class="job-stat-value">${pct.toFixed(1)}%</span></span>
        <span>Tx: <span class="job-stat-value">${job.completedCount || 0}</span></span>
      </div>
      ${job.status === 'RUNNING' ? `
        <div class="job-actions">
          <button class="btn-danger-sm" onclick="stopJob('${job.id}')">⏹ Stop</button>
        </div>
      ` : ''}
      ${lastLogs ? `<div class="job-logs">${escHtml(lastLogs)}</div>` : ''}
    </div>
  `;
}

async function stopJob(jobId) {
  try {
    await fetch(`${API}/api/jobs/stop/${jobId}`, { method: 'POST' });
    toast('Job stopped', 'success');
    await refreshJobs();
  } catch {
    toast('Failed to stop job', 'error');
  }
}

// ===== Polling =====
function startPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    if (navigator.onLine) {
      await refreshJobs();
    }
  }, POLL_INTERVAL);
}

// ===== Event Listeners =====
function setupEventListeners() {
  // Amount chips
  document.querySelectorAll('.chip[data-val]').forEach(chip => {
    chip.addEventListener('click', () => {
      $('qs-amount').value = formatAmount(chip.dataset.val);
      // Also store raw value
      $('qs-amount').dataset.rawVal = chip.dataset.val;
    });
  });

  // Send now
  $('btn-send-now').addEventListener('click', sendNow);

  // Add to queue
  $('btn-add-queue').addEventListener('click', () => {
    const vals = getFormValues();
    if (!vals.to) return toast('Enter a recipient', 'error');
    if (vals.amount === '0') return toast('Enter an amount', 'error');
    addToQueue(vals);
    $('qs-recipient').value = '';
    $('qs-amount').value = '';
    $('qs-resolved-hint').textContent = '';
  });

  // Execute queue
  $('btn-execute-queue').addEventListener('click', processQueue);

  // Recipient input — resolve URL
  $('qs-recipient').addEventListener('input', (e) => {
    const val = e.target.value.trim();
    const hint = $('qs-resolved-hint');
    const fromUrl = extractRecipientFromUrl(val);
    if (fromUrl) {
      hint.textContent = `→ ID: ${fromUrl}`;
    } else {
      hint.textContent = '';
    }
  });

  // Amount input — handle raw value storage for chips
  $('qs-amount').addEventListener('input', (e) => {
    delete e.target.dataset.rawVal;
  });

  // Toggle history
  $('toggle-history').addEventListener('click', () => {
    const list = $('history-jobs-list');
    const header = $('toggle-history');
    list.classList.toggle('collapsed');
    header.classList.toggle('open');
  });

  // Toggle accounts
  $('toggle-accounts').addEventListener('click', () => {
    const panel = $('accounts-panel');
    const header = $('toggle-accounts');
    panel.classList.toggle('collapsed');
    header.classList.toggle('open');
  });

  // Save account
  $('btn-save-account').addEventListener('click', saveAccount);

  // Queue header toggle
  $('btn-toggle-queue').addEventListener('click', () => {
    const section = $('section-queue');
    section.scrollIntoView({ behavior: 'smooth' });
  });

  // Enter key on recipient/amount
  $('qs-recipient').addEventListener('keydown', e => {
    if (e.key === 'Enter') $('qs-amount').focus();
  });
  $('qs-amount').addEventListener('keydown', e => {
    if (e.key === 'Enter') sendNow();
  });
}

// ===== Helpers =====
function escHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// Override parseAmount to use raw chip value if available
const origGetFormValues = getFormValues;
// Patch to use raw val from chips
const origParseAmount = parseAmount;
