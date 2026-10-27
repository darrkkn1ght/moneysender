import http from 'node:http';
import fs from 'node:fs';
import { startCampaignDispatch } from './campaign_burner_dispatcher.js';

const PORT = process.env.PORT || 10000;

let isCampaignRunning = false;
let dispatchPromise = null;

function getDashboardData() {
  let idsCount = 0;
  try {
    idsCount = JSON.parse(fs.readFileSync('./all_player_ids.json', 'utf8')).length;
  } catch {}

  let dispatchState = { totalSent: 0, totalCashHookSent: 0, statsByBurner: {} };
  try {
    dispatchState = JSON.parse(fs.readFileSync('./campaign_burner_dispatch_state.json', 'utf8'));
  } catch {}

  let autoReplyState = { totalAutoReplied: 0 };
  try {
    autoReplyState = JSON.parse(fs.readFileSync('./voter_auto_reply_state.json', 'utf8'));
  } catch {}

  let burners = [];
  try {
    burners = JSON.parse(fs.readFileSync('./data/campaign_burners.json', 'utf8'));
  } catch {}

  return { idsCount, dispatchState, autoReplyState, burners };
}

const server = http.createServer((req, res) => {
  // Health check for Render
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', uptime: process.uptime() }));
    return;
  }

  // API to trigger campaign launch
  if (req.url === '/api/campaign/start' && req.method === 'POST') {
    if (!isCampaignRunning) {
      isCampaignRunning = true;
      console.log('🚀 [Render Control] Campaign launch triggered via dashboard button!');
      dispatchPromise = startCampaignDispatch().catch(err => {
        console.error('[Dispatcher Error]', err);
        isCampaignRunning = false;
      });
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, running: true }));
    return;
  }

  // API to pause campaign
  if (req.url === '/api/campaign/pause' && req.method === 'POST') {
    isCampaignRunning = false;
    console.log('🛑 [Render Control] Campaign paused via dashboard button!');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, running: false }));
    return;
  }

  const { idsCount, dispatchState, autoReplyState, burners } = getDashboardData();

  const statusBadge = isCampaignRunning 
    ? `<span style="background: #16a34a; color: white; padding: 6px 16px; border-radius: 9999px; font-weight: bold; font-size: 14px;">● CAMPAIGN ACTIVE & DELIVERING 🚀</span>`
    : `<span style="background: #eab308; color: black; padding: 6px 16px; border-radius: 9999px; font-weight: bold; font-size: 14px;">⏸️ STANDING BY (READY TO LAUNCH)</span>`;

  const actionButton = isCampaignRunning
    ? `<button onclick="toggleCampaign('/api/campaign/pause')" style="background: #ef4444; color: white; border: none; padding: 16px 32px; border-radius: 14px; font-size: 18px; font-weight: 800; cursor: pointer; box-shadow: 0 4px 14px rgba(239, 68, 68, 0.4);">🛑 PAUSE CAMPAIGN</button>`
    : `<button onclick="toggleCampaign('/api/campaign/start')" style="background: #22c55e; color: white; border: none; padding: 16px 36px; border-radius: 14px; font-size: 20px; font-weight: 800; cursor: pointer; box-shadow: 0 6px 20px rgba(34, 197, 94, 0.45); transition: transform 0.1s;">🚀 LAUNCH 10-BURNER CAMPAIGN NOW</button>`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>🏛️ LLDC Campaign Command Center (Render Cloud)</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="refresh" content="8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0f172a; color: #f8fafc; margin: 0; padding: 24px; }
    .container { max-width: 900px; margin: 0 auto; }
    .header { text-align: center; margin-bottom: 24px; }
    .action-panel { background: #1e293b; border: 2px solid #334155; border-radius: 20px; padding: 28px; text-align: center; margin-bottom: 28px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-bottom: 28px; }
    .card { background: #1e293b; border-radius: 16px; padding: 20px; border: 1px solid #334155; }
    .card-title { color: #94a3b8; font-size: 13px; text-transform: uppercase; font-weight: bold; margin-bottom: 8px; }
    .card-val { font-size: 32px; font-weight: 800; color: #38bdf8; }
    .fleet { background: #1e293b; border-radius: 16px; padding: 20px; border: 1px solid #334155; }
    table { width: 100%; border-collapse: collapse; margin-top: 12px; }
    th, td { text-align: left; padding: 12px; border-bottom: 1px solid #334155; font-size: 14px; }
    th { color: #94a3b8; text-transform: uppercase; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div style="margin-bottom: 12px;">${statusBadge}</div>
      <h1 style="margin: 0 0 6px 0; font-size: 32px;">🏛️ LLDC 2026 Campaign Command</h1>
      <p style="color: #94a3b8; margin: 0;">Multi-Threaded Voter Outreach (100% Free on Render Cloud)</p>
    </div>

    <div class="action-panel">
      <h2 style="margin: 0 0 8px 0;">Campaign Launch Control</h2>
      <p style="color: #94a3b8; margin: 0 0 20px 0;">Includes ₦1,000,000,000 cash hook alert + official ballot notice.</p>
      ${actionButton}
    </div>

    <div class="grid">
      <div class="card">
        <div class="card-title">Citizens Cataloged</div>
        <div class="card-val">${idsCount.toLocaleString()}</div>
      </div>
      <div class="card">
        <div class="card-title">DMs Delivered</div>
        <div class="card-val">${(dispatchState.totalSent || 0).toLocaleString()}</div>
      </div>
      <div class="card">
        <div class="card-title">₦1B Cash Hooks</div>
        <div class="card-val">${(dispatchState.totalCashHookSent || 0).toLocaleString()}</div>
      </div>
      <div class="card">
        <div class="card-title">Auto-Replies</div>
        <div class="card-val">${(autoReplyState.totalAutoReplied || 0).toLocaleString()}</div>
      </div>
    </div>

    <div class="fleet">
      <h3 style="margin: 0 0 8px 0;">👥 10-Burner Field Army (₦1T War Chest per Burner)</h3>
      <table>
        <thead>
          <tr><th>Burner Account</th><th>Status</th><th>Delivered DMs</th><th>₦1B Hooks</th></tr>
        </thead>
        <tbody>
          ${burners.map(b => {
            const stats = dispatchState.statsByBurner[b.user] || { sent: 0, cashHooks: 0 };
            return `<tr>
              <td><strong>@${b.user}</strong></td>
              <td><span style="color: #4ade80; font-weight: bold;">LIVE (₦1T)</span></td>
              <td>${stats.sent}</td>
              <td>${stats.cashHooks || 0}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>
  </div>

  <script>
    async function toggleCampaign(endpoint) {
      try {
        const res = await fetch(endpoint, { method: 'POST' });
        if (res.ok) {
          location.reload();
        }
      } catch (err) {
        alert('Action failed: ' + err.message);
      }
    }
  </script>
</body>
</html>`;

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
});

server.listen(PORT, () => {
  console.log(`[Render] Campaign Command Center ready on port ${PORT}`);
  console.log('[Render] Standing by in controlled mode. Awaiting user button click on dashboard to start dispatching.');
});
