import fs from 'node:fs';

const ACCOUNTS_FILE = './data/accounts.json';
const AUTO_REPLY_STATE = './voter_auto_reply_state.json';
const DISPATCH_STATE = './campaign_burner_dispatch_state.json';
const TELEMETRY_FILE = './election_live_telemetry.json';
const LOG_FILE = './election_telemetry.log';

function log(msg) {
  const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
  console.log(line);
  try {
    fs.appendFileSync(LOG_FILE, line + '\n');
  } catch {}
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fetchGovStats(cookie) {
  try {
    const res = await fetch('https://lagoslife.app/api/gov?full=1', {
      headers: { cookie, accept: 'application/json', 'user-agent': 'Mozilla/5.0' }
    });
    if (res.ok) {
      return await res.json().catch(() => ({}));
    }
  } catch {}
  return null;
}

async function runMonitor() {
  log('========================================================================');
  log('📊 LLDC REAL-TIME ELECTION TELEMETRY & VOTER TRACKER');
  log('========================================================================');

  const accounts = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf8'));
  const miles = accounts.find(a => a.user === 'milespete');

  while (true) {
    const govData = await fetchGovStats(miles.cookie);

    let dispatchData = { totalSent: 0 };
    try {
      dispatchData = JSON.parse(fs.readFileSync(DISPATCH_STATE, 'utf8'));
    } catch {}

    let autoReplyData = { totalAutoReplied: 0, repliedThreadIds: {} };
    try {
      autoReplyData = JSON.parse(fs.readFileSync(AUTO_REPLY_STATE, 'utf8'));
    } catch {}

    const replies = Object.values(autoReplyData.repliedThreadIds || {});
    const confirmedPledges = replies.filter(r => r.type === 'PROOF_CLAIM').length;
    const questions = replies.filter(r => r.type === 'VOTING_HELP' || r.type === 'LEGITIMACY_CHECK').length;
    const supporters = replies.filter(r => r.type === 'GENERAL_SUPPORT').length;

    const telemetry = {
      timestamp: new Date().toISOString(),
      campaignMetrics: {
        totalCitizensCataloged: JSON.parse(fs.readFileSync('./all_player_ids.json', 'utf8')).length,
        messagesDelivered: dispatchData.totalSent || 0,
        incomingEngagements: autoReplyData.totalAutoReplied || 0,
        confirmedVoterPledges: confirmedPledges,
        votingQuestionsAnswered: questions,
        generalSupporters: supporters
      },
      governmentPolls: {
        activeGovernor: govData?.current?.governor || 'Incumbent',
        candidates: govData?.candidates || [],
        electionOpen: Boolean(govData?.electionOpen),
        policy: govData?.current?.policy || null
      }
    };

    fs.writeFileSync(TELEMETRY_FILE, JSON.stringify(telemetry, null, 2));
    log(`📈 Telemetry Updated: ${telemetry.campaignMetrics.totalCitizensCataloged} citizens in DB | ${telemetry.campaignMetrics.messagesDelivered} messaged | ${telemetry.campaignMetrics.incomingEngagements} engaged | ${confirmedPledges} verified vote claims`);

    await sleep(30000); // Poll every 30s
  }
}

runMonitor().catch(err => {
  log(`❌ Telemetry monitor error: ${err.stack || err}`);
});
