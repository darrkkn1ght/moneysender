import http from 'node:http';
import fs from 'node:fs';
import { startCampaignDispatch } from './campaign_burner_dispatcher.js';

const PORT = process.env.PORT || 10000;

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
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', uptime: process.uptime() }));
    return;
  }

  const { idsCount, dispatchState, autoReplyState, burners } = getDashboardData();

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>🏛️ LLDC Campaign Command Center (Render Cloud)</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="refresh" content="10">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0f172a; color: #f8fafc; margin: 0; padding: 24px; }
    .container { max-width: 900px; margin: 0 auto; }
    .header { text-align: center; margin-bottom: 28px; }
    .badge { background: #16a34a; color: white; padding: 4px 12px; border-radius: 9999px; font-weight: bold; font-size: 14px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-bottom: 28px; }
    .card { background: #1e293b; border-radius: 16px; padding: 20px; border: 1px solid #334155; }
    .card-title { color: #94a3b8; font-size: 13px; text-transform: uppercase; font-weight: bold; margin-bottom: 8px; }
    .card-val { font-size: 32px; font-weight: 800; color: #38bdf8; }
    .fleet { background: #1e293b; border-radius: 16px; padding: 20px; border: 1px solid #334155; }
    table { width: 100%; border-collapse: collapse; margin-top: 12px; }
    th, td { text-align: left; padding: 10px; border-bottom: 1px solid #334155; font-size: 14px; }
    th { color: #94a3b8; text-transform: uppercase; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <span class="badge">● LIVE ON RENDER CLOUD 24/7</span>
      <h1 style="margin: 12px 0 4px 0;">🏛️ LLDC 2026 Campaign Command</h1>
      <p style="color: #94a3b8; margin: 0;">Automated 10-Burner Voter Outreach & Engagement Fleet</p>
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
          <tr><th>Burner Handle</th><th>Status</th><th>Delivered DMs</th><th>Cash Hooks</th></tr>
        </thead>
        <tbody>
          ${burners.map(b => {
            const stats = dispatchState.statsByBurner[b.user] || { sent: 0, cashHooks: 0 };
            return `<tr>
              <td><strong>@${b.user}</strong></td>
              <td><span style="color: #4ade80;">ACTIVE</span></td>
              <td>${stats.sent}</td>
              <td>${stats.cashHooks || 0}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>
  </div>
</body>
</html>`;

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
});

server.listen(PORT, () => {
  console.log(`[Render] Campaign Server listening on port ${PORT}`);
  console.log('[Render] Launching automated background campaign dispatcher...');
  startCampaignDispatch().catch(err => console.error('[Render Dispatcher Error]', err));
});
