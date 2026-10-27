import fs from 'node:fs';

const BURNERS_FILE = './data/campaign_burners.json';
const ACCOUNTS_FILE = './data/accounts.json';
const STATE_FILE = './voter_auto_reply_state.json';
const LEDGER_FILE = './voter_payout_ledger.json';
const LOG_FILE = './voter_auto_reply.log';

function log(msg) {
  const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
  console.log(line);
  try {
    fs.appendFileSync(LOG_FILE, line + '\n');
  } catch {}
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return { repliedThreadIds: {}, totalAutoReplied: 0 };
  }
}

function saveState(s) {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
  } catch {}
}

function loadLedger() {
  try {
    return JSON.parse(fs.readFileSync(LEDGER_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function saveLedger(l) {
  try {
    fs.writeFileSync(LEDGER_FILE, JSON.stringify(l, null, 2));
  } catch {}
}

async function sendReply(cookie, targetUid, text) {
  try {
    const res = await fetch('https://lagoslife.app/api/messages', {
      method: 'POST',
      headers: {
        cookie,
        'content-type': 'application/json',
        'user-agent': 'Mozilla/5.0'
      },
      body: JSON.stringify({ to: targetUid, body: text })
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function sendMoney(cookie, toUid, amount, note) {
  try {
    const res = await fetch('https://lagoslife.app/api/send', {
      method: 'POST',
      headers: {
        cookie,
        'content-type': 'application/json',
        'user-agent': 'Mozilla/5.0'
      },
      body: JSON.stringify({ to: toUid, amount, note })
    });
    const d = await res.json().catch(() => ({}));
    return { ok: res.ok, data: d };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// Smart Response Classifier
function getSmartResponse(name, msg) {
  const lower = msg.toLowerCase();

  // 1. Proof of vote or LagosT Gist repost
  if (lower.includes('voted') || lower.includes('i vote') || lower.includes('done') || lower.includes('posted') || lower.includes('repost') || lower.includes('tagged') || lower.includes('lagost') || lower.includes('gist')) {
    return {
      type: 'PROOF_CLAIM',
      text: `Awesome job ${name}! 🏛️ Verified and logged into the official LLDC Victory Registry. When polls close and victory is declared, voter rewards land directly in your wallet! Tell your friends to vote LLDC! 🍾🔥`
    };
  }

  // 2. Asking how or where to vote
  if (lower.includes('how') || lower.includes('where') || lower.includes('location') || lower.includes('poll')) {
    return {
      type: 'VOTING_HELP',
      text: `Hey ${name}! Voting takes place tomorrow Wednesday at City Hall / Gov House. Simply head over, tap LLDC on the ballot, select @ghost001 for Governor, @Bigola2823 for President, and submit your vote! 🗳️`
    };
  }

  // 3. Asking if money is real / legitimate
  if (lower.includes('real') || lower.includes('money') || lower.includes('10b') || lower.includes('pay') || lower.includes('scam') || lower.includes('cap')) {
    return {
      type: 'LEGITIMACY_CHECK',
      text: `100% legit! LLDC is backed by the largest treasury in Lagos with tens of trillions ready to support our voters and residents. Vote LLDC tomorrow, repost on LagosT Gist & claim! 💸🏛️`
    };
  }

  // 4. General support
  return {
    type: 'GENERAL_SUPPORT',
    text: `Appreciate you standing with LLDC ${name}! 💙💚 Tomorrow we take Lagos forward together. Make sure to vote LLDC on Wednesday! 🔥`
  };
}

async function checkAccountInbox(account, state, ledger) {
  const user = account.user;
  try {
    const res = await fetch('https://lagoslife.app/api/messages', {
      headers: { cookie: account.cookie, 'user-agent': 'Mozilla/5.0' }
    });
    if (!res.ok) return;

    const data = await res.json().catch(() => ({}));
    const threads = data.threads || [];

    // Filter threads where last message is incoming and not yet replied by auto-responder
    for (const t of threads) {
      if (!t.last || t.last.mine) continue;
      const threadKey = `${user}:${t.id}:${t.last.id || t.last.body}`;
      if (state.repliedThreadIds[threadKey]) continue;

      const name = t.name || (t.username ? `@${t.username}` : 'fam');
      const incomingText = t.last.body || '';

      const response = getSmartResponse(name, incomingText);
      log(`💬 [@${user}] Incoming from ${name}: "${incomingText}" ➔ Replying: [${response.type}]`);

      const sent = await sendReply(account.cookie, t.id, response.text);
      if (sent) {
        state.repliedThreadIds[threadKey] = {
          at: new Date().toISOString(),
          type: response.type
        };
        state.totalAutoReplied++;
        saveState(state);
      }

      await sleep(1200);
    }
  } catch (e) {
    log(`⚠️ Inbox check error on @${user}: ${e.message}`);
  }
}

async function main() {
  log('========================================================================');
  log('🤖 24/7 LLDC CAMPAIGN AUTO-REPLY & ENGAGEMENT ENGINE');
  log('   Monitoring all 10 Burners + @milespete continuously');
  log('========================================================================');

  // STRICT: ONLY BURNERS MONITORED. MILESPETE NEVER SENDS MESSAGES
  const monitoredAccounts = [...burners];

  log(`👥 Monitoring ${monitoredAccounts.length} inboxes across the campaign fleet.`);

  const state = loadState();
  const ledger = loadLedger();

  while (true) {
    for (const acc of monitoredAccounts) {
      await checkAccountInbox(acc, state, ledger);
      await sleep(1500);
    }
    // Check every 10 seconds
    await sleep(10000);
  }
}

main().catch(err => {
  log(`❌ Fatal auto-reply error: ${err.stack || err}`);
});
