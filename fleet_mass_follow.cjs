const fs = require('fs');
const path = require('path');

const FLEET_FILE = fs.existsSync(path.join(__dirname, 'data', 'followers_fleet_all.json'))
  ? path.join(__dirname, 'data', 'followers_fleet_all.json')
  : path.join(__dirname, 'data', 'followers_fleet_500.json');

const targetUsernameOrId = process.argv[2];

if (!targetUsernameOrId) {
  console.log(`
Usage: node fleet_mass_follow.cjs <username_or_uid> [unfollow]

Examples:
  node fleet_mass_follow.cjs milespete
  node fleet_mass_follow.cjs bc745837935d45efbf47
  node fleet_mass_follow.cjs milespete unfollow
`);
  process.exit(0);
}

let limitCount = null;
let isUnfollow = false;

for (let i = 3; i < process.argv.length; i++) {
  const arg = process.argv[i].toLowerCase();
  if (arg === 'unfollow') {
    isUnfollow = true;
  } else if (!isNaN(parseInt(arg, 10))) {
    limitCount = parseInt(arg, 10);
  }
}

const actionOn = !isUnfollow;

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function resolveTargetUid(target, sampleCookie) {
  // If already looks like a 20-hex UID
  if (/^[a-f0-9]{20}$/i.test(target)) {
    return target;
  }

  // Look up via /api/players?q= or /api/players
  console.log(`Resolving UID for @${target}...`);
  try {
    const res = await fetch(`https://lagoslife.app/api/players?q=${encodeURIComponent(target)}`, {
      headers: {
        'accept': 'application/json',
        'cookie': sampleCookie,
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.players)) {
        const found = data.players.find(p => p.username.toLowerCase() === target.toLowerCase() || p.name.toLowerCase() === target.toLowerCase());
        if (found) return found.id;
      }
    }
  } catch (e) {}

  // Check /api/gist?feed=user
  try {
    // If we have an existing accounts file
    const accs = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'accounts.json'), 'utf8'));
    const matched = accs.find(a => (a.user || '').toLowerCase() === target.toLowerCase());
    if (matched && matched.uid) return matched.uid;
  } catch (e) {}

  throw new Error(`Could not resolve UID for @${target}. Please pass the 20-character UID directly.`);
}

async function followAccount(follower, targetUid) {
  try {
    const res = await fetch('https://lagoslife.app/api/gist', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'cookie': follower.cookie,
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'origin': 'https://lagoslife.app',
        'referer': 'https://lagoslife.app/'
      },
      body: JSON.stringify({
        action: 'follow',
        id: targetUid,
        on: actionOn
      })
    });

    const data = await res.json().catch(() => ({}));
    return { username: follower.username, ok: res.ok && !!data.ok, status: res.status, data };
  } catch (err) {
    return { username: follower.username, ok: false, error: err.message };
  }
}

async function main() {
  let fleet = JSON.parse(fs.readFileSync(FLEET_FILE, 'utf8'));
  if (limitCount && limitCount > 0) {
    fleet = fleet.slice(0, limitCount);
  }
  console.log(`Loaded fleet of ${fleet.length} active follower accounts.`);

  const sampleCookie = fleet[0]?.cookie;
  const targetUid = await resolveTargetUid(targetUsernameOrId, sampleCookie);
  console.log(`Target target UID: ${targetUid}`);
  console.log(`Action: ${actionOn ? 'FOLLOW' : 'UNFOLLOW'}`);
  console.log(`Launching parallel execution (concurrency: 12)...\n`);

  const startTime = Date.now();
  let completed = 0;
  let successCount = 0;
  let ptr = 0;
  const CONCURRENCY = 12;

  async function worker() {
    while (ptr < fleet.length) {
      const acc = fleet[ptr++];
      const result = await followAccount(acc, targetUid);
      completed++;
      if (result.ok) successCount++;
      if (completed % 50 === 0 || completed === fleet.length) {
        console.log(`⚡ Progress: ${completed}/${fleet.length} (Success: ${successCount})`);
      }
      await sleep(100);
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  const elapsed = Math.round((Date.now() - startTime) / 1000);
  console.log(`\n🎉 Done in ${elapsed}s! Successfully ${actionOn ? 'followed' : 'unfollowed'} with ${successCount}/${fleet.length} accounts.`);
}

main().catch(err => console.error(err.message));

