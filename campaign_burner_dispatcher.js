import fs from 'node:fs';

const BURNERS_FILE = './data/campaign_burners.json';
const ALL_IDS_FILE = './all_player_ids.json';
const MEGA_FILE = './mega_contacts_list.json';
const ONLINE_FILE = './active_online_players.json';
const STATE_FILE = './campaign_burner_dispatch_state.json';
const LOG_FILE = './campaign_burner_dispatch.log';

function log(msg) {
  const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
  console.log(line);
  try {
    fs.appendFileSync(LOG_FILE, line + '\n');
  } catch {}
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Official LLDC Ballot Copy (Babson Oladosu Approved - Strictly 284 chars)
const MESSAGE_BALLOT = 
`Welcome to LLDC (Lagos Life Democratic Party)!! 💙💚
We promise transparent governance, fair tax, business growth & mass opportunities 4all! 🔥✊

Vote 🗳️ & win 💵10Billion💵
👑 @Bigola2823: President
🏛️ @ghost001: Lagos Gov
⚖️ @Big_stephani: Senator
💼 @_iamking_: CBN Gov
🏛️ @ricchrex: Abuja Minister
🇳🇬 @Yoursuperdaad: PH Gov`;

// Configuration for Upfront Attention Hook
const SEND_CASH_HOOK = true;
const CASH_HOOK_AMOUNT = 1_000_000_000; // ₦1 Billion cash pop-up alert

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return {
      sentIds: {},
      totalSent: 0,
      totalCashHookSent: 0,
      statsByBurner: {}
    };
  }
}

function saveState(state) {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch {}
}

async function sendCashHook(cookie, toUid) {
  try {
    const res = await fetch('https://lagoslife.app/api/send', {
      method: 'POST',
      headers: {
        cookie,
        'content-type': 'application/json',
        accept: 'application/json',
        'user-agent': 'Mozilla/5.0'
      },
      body: JSON.stringify({
        to: toUid,
        amount: CASH_HOOK_AMOUNT,
        note: 'LLDC Voter Token! Vote @ghost001 & @Bigola2823 🏛️'
      })
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function sendMessage(cookie, toUid, text) {
  try {
    const res = await fetch('https://lagoslife.app/api/messages', {
      method: 'POST',
      headers: {
        cookie,
        'content-type': 'application/json',
        accept: 'application/json',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
      },
      body: JSON.stringify({
        to: toUid,
        body: text
      })
    });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, ok: res.ok, data };
  } catch (e) {
    return { status: 0, ok: false, error: e.message };
  }
}

async function runWorker(burner, targetProfiles, state) {
  const burnerUser = burner.user;
  log(`👷 [Worker @${burnerUser}] Starting outreach batch (${targetProfiles.length} targets assigned)...`);

  if (!state.statsByBurner[burnerUser]) {
    state.statsByBurner[burnerUser] = { sent: 0, failed: 0, cashHooks: 0 };
  }

  for (const p of targetProfiles) {
    const uid = p.id || p.uid;
    if (!uid || state.sentIds[uid]) continue;

    let success = false;
    let attempts = 0;

    while (attempts < 2) {
      attempts++;

      // Step 1: Upfront ₦1 Billion Attention Hook (if enabled)
      let hooked = false;
      if (SEND_CASH_HOOK) {
        hooked = await sendCashHook(burner.cookie, uid);
        if (hooked) {
          state.totalCashHookSent = (state.totalCashHookSent || 0) + 1;
          state.statsByBurner[burnerUser].cashHooks = (state.statsByBurner[burnerUser].cashHooks || 0) + 1;
        }
      }

      // Step 2: Single Clean Official Ballot Message
      const res = await sendMessage(burner.cookie, uid, MESSAGE_BALLOT);

      if (res.ok) {
        state.sentIds[uid] = {
          burner: burnerUser,
          targetUser: p.username || null,
          targetName: p.name || null,
          cashHook: hooked,
          at: new Date().toISOString()
        };
        state.totalSent++;
        state.statsByBurner[burnerUser].sent++;
        const targetLabel = p.username ? `@${p.username}` : (p.name || uid.slice(0, 8));
        log(`📨 [@${burnerUser}] LLDC Ballot delivered to ${targetLabel} ${hooked ? '(+₦1B Cash Alert 💸)' : ''} | Total Sent: ${state.totalSent}`);
        success = true;
        break;
      } else if (res.status === 429) {
        log(`⏳ [@${burnerUser}] Rate limit (429). Pausing 15s...`);
        await sleep(15000);
      } else {
        const err = res.data?.error || `HTTP ${res.status}`;
        log(`⚠️ [@${burnerUser}] Send to [${uid}] failed: ${err}`);
        state.sentIds[uid] = { burner: burnerUser, status: 'failed', error: err, at: new Date().toISOString() };
        state.statsByBurner[burnerUser].failed++;
        break;
      }
    }

    saveState(state);
    // Safe human timing jitter between 4.2s and 6.0s
    const jitter = 4200 + Math.floor(Math.random() * 1800);
    await sleep(jitter);
  }

  log(`🏁 [Worker @${burnerUser}] Finished assigned target batch.`);
}

export async function startCampaignDispatch() {
  log('========================================================================');
  log('🏛️ OFFICIAL LLDC CAMPAIGN 10-BURNER VIRAL DISPATCHER');
  log('   WITH ₦1 BILLION POP-UP CASH HOOK + 10B BALLOT WIN PRIZE');
  log('========================================================================');

  const burners = JSON.parse(fs.readFileSync(BURNERS_FILE, 'utf8'));
  log(`👥 Loaded ${burners.length} verified campaign burner workers (₦1T funded each).`);

  const onlinePlayers = fs.existsSync(ONLINE_FILE) ? JSON.parse(fs.readFileSync(ONLINE_FILE, 'utf8')) : [];
  const megaContacts = fs.existsSync(MEGA_FILE) ? JSON.parse(fs.readFileSync(MEGA_FILE, 'utf8')) : [];
  const allIds = fs.existsSync(ALL_IDS_FILE) ? JSON.parse(fs.readFileSync(ALL_IDS_FILE, 'utf8')) : [];

  const combinedTargets = [];
  const seen = new Set();

  // Tier 1: Confirmed online players today
  for (const p of onlinePlayers) {
    const id = (p.id || p.uid || '').toLowerCase();
    if (id && /^[0-9a-f]{20}$/.test(id) && !seen.has(id)) {
      seen.add(id);
      combinedTargets.push({ ...p, id });
    }
  }

  // Tier 2: Master city contacts with details
  for (const p of megaContacts) {
    const id = (p.id || p.uid || '').toLowerCase();
    if (id && /^[0-9a-f]{20}$/.test(id) && !seen.has(id)) {
      seen.add(id);
      combinedTargets.push({ ...p, id });
    }
  }

  // Tier 3: All newly harvested player IDs
  for (const rawId of allIds) {
    const id = (rawId || '').toLowerCase();
    if (id && /^[0-9a-f]{20}$/.test(id) && !seen.has(id)) {
      seen.add(id);
      combinedTargets.push({ id });
    }
  }

  log(`🎯 Total Citizen Outreach Registry: ${combinedTargets.length} citizens!`);

  const state = loadState();
  const unreached = combinedTargets.filter(p => !state.sentIds[p.id]);
  log(`📊 Remaining unreached citizens: ${unreached.length} (Already messaged: ${state.totalSent})`);

  if (unreached.length === 0) {
    log('🎉 All registered citizens have already received the campaign notice!');
    return;
  }

  // Partition unreached targets across the 10 burners
  const partitions = burners.map(() => []);
  unreached.forEach((p, idx) => {
    partitions[idx % burners.length].push(p);
  });

  log('\n📋 Target distribution across 10 burners:');
  burners.forEach((b, idx) => {
    log(`   - @${b.user.padEnd(16)}: ${partitions[idx].length} assigned citizens`);
  });

  log('\n🚀 LAUNCHING 10 PARALLEL CAMPAIGN DISPATCHERS...');

  const promises = burners.map((b, idx) => runWorker(b, partitions[idx], state));
  await Promise.all(promises);

  log('\n🏆 ALL 10 CAMPAIGN WORKERS COMPLETED OUTREACH RUN!');
  log(`   Total Official LLDC Notices Delivered: ${state.totalSent}`);
}

// Auto-run if executed directly via node
if (process.argv[1]?.endsWith('campaign_burner_dispatcher.js')) {
  startCampaignDispatch().catch(err => {
    log(`❌ Fatal dispatcher error: ${err.stack || err}`);
  });
}
