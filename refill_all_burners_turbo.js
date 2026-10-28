import fs from 'node:fs';
import crypto from 'node:crypto';

const ACCOUNTS_FILE = './data/accounts.json';
const BURNERS_FILE = './data/campaign_burners.json';
const STATE_FILE = './balances_burners_refill_state.json';
const LOG_FILE = './refill_burners_turbo.log';

const TARGET_PER_BURNER = 1_000_000_000_000; // ₦1.00 Trillion per burner
const CHUNK_SIZE = 100_000_000_000;          // ₦100 Billion per send

function log(msg) {
  const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
  console.log(line);
  try {
    fs.appendFileSync(LOG_FILE, line + '\n');
  } catch {}
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function claimPending(cookie) {
  try {
    const res = await fetch('https://lagoslife.app/api/family', {
      method: 'POST',
      headers: {
        cookie,
        'content-type': 'application/json',
        'user-agent': 'Mozilla/5.0'
      },
      body: JSON.stringify({ action: 'claim' })
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function getBalance(cookie) {
  try {
    const res = await fetch('https://lagoslife.app/api/save', {
      headers: { cookie, 'user-agent': 'Mozilla/5.0' }
    });
    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      return Number(data.game?.money ?? data.snap?.cash ?? data.cash ?? 0);
    }
  } catch {}
  return 0;
}

async function sendToBurner(sender, targetUid, amount) {
  const idempotencyKey = crypto.randomUUID();
  try {
    const body = { to: targetUid, amount };
    if (sender.pin) body.pin = sender.pin;
    const res = await fetch('https://lagoslife.app/api/send', {
      method: 'POST',
      headers: {
        cookie: sender.cookie,
        'content-type': 'application/json',
        accept: 'application/json',
        'idempotency-key': idempotencyKey,
        'user-agent': 'Mozilla/5.0'
      },
      body: JSON.stringify(body)
    });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, ok: res.ok, data };
  } catch (err) {
    return { status: 0, ok: false, error: err.message };
  }
}

async function main() {
  log('========================================================================');
  log('🔋 TURBO BURNER REFILL TO ₦1 TRILLION WAR CHEST');
  log('   TARGET: ₦1.00 Trillion Per Burner Account');
  log('   RULE: Strictly NO Kvngdre');
  log('========================================================================');

  const accountsRaw = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf8'));
  const burnersRaw = JSON.parse(fs.readFileSync(BURNERS_FILE, 'utf8'));

  // Senders armada (strictly no kvngdre)
  const senders = [
    { name: 'Danny', user: 'danyeko', cookie: accountsRaw.find(a => a.user === 'danyeko').cookie, pin: null },
    { name: 'PrinceDavid', user: 'princedavid', cookie: accountsRaw.find(a => a.user === 'princedavid').cookie, pin: null },
    { name: 'Miles Peter', user: 'milespete', cookie: accountsRaw.find(a => a.user === 'milespete').cookie, pin: '4343' }
  ];

  log(`👥 Parallel Funders: ${senders.map(s => `@${s.user}`).join(', ')}`);

  // First, claim all pending and check current balances of all burners
  log('\n🔍 Scanning current balances of all 10 burners...');
  const burnersStatus = [];
  for (const b of burnersRaw) {
    await claimPending(b.cookie);
    const bal = await getBalance(b.cookie);
    const needed = Math.max(0, TARGET_PER_BURNER - bal);
    burnersStatus.push({
      ...b,
      currentBal: bal,
      needed
    });
    log(`   [@${b.user}] Liquid Balance: ₦${(bal / 1e12).toFixed(3)}T | Needed to reach 1T: ₦${(needed / 1e9).toFixed(0)}B`);
  }

  const needyBurners = burnersStatus.filter(b => b.needed > 0);
  if (needyBurners.length === 0) {
    log('🎉 All burners are already at or above ₦1.00 Trillion!');
    return;
  }

  log(`\n📋 Burners requiring refill: ${needyBurners.length}`);

  // Distribute burners across the 3 senders evenly
  const assigned = [[], [], []];
  needyBurners.forEach((b, idx) => {
    assigned[idx % senders.length].push(b);
  });

  // Run 3 funder workers in parallel
  const workerPromises = senders.map(async (sender, sIdx) => {
    const myBurners = assigned[sIdx];
    if (myBurners.length === 0) return;

    log(`👷 [Funder @${sender.user}] Taking charge of ${myBurners.length} burners: ${myBurners.map(b => '@' + b.user).join(', ')}`);

    for (const burner of myBurners) {
      let curBal = burner.currentBal;

      while (curBal < TARGET_PER_BURNER) {
        const remainingNeeded = TARGET_PER_BURNER - curBal;
        const sendAmt = Math.min(CHUNK_SIZE, remainingNeeded);

        log(`⚡ [@${sender.user} ➔ @${burner.user}] Dispatching ₦${(sendAmt / 1e9).toFixed(0)}B...`);

        let sent = false;
        while (!sent) {
          const r = await sendToBurner(sender, burner.uid, sendAmt);

          if (r.ok || r.status === 200) {
            sent = true;
            await claimPending(burner.cookie);
            curBal += sendAmt;
            log(`✅ [@${sender.user} ➔ @${burner.user}] Refilled ₦${(sendAmt / 1e9).toFixed(0)}B! Burner is now at ₦${(curBal / 1e12).toFixed(3)}T / 1.0T`);
          } else if (r.status === 429) {
            log(`⏳ [@${sender.user}] Rate limit 429 hit. Waiting 15s...`);
            await sleep(15000);
          } else {
            const errMsg = r.data?.error || r.error || JSON.stringify(r.data);
            log(`⚠️ [@${sender.user}] Notice (${r.status}): ${errMsg}. Retrying in 5s...`);
            await sleep(5000);
          }
        }

        if (curBal >= TARGET_PER_BURNER) {
          log(`🏆 [@${burner.user}] ₦1.00 TRILLION WAR CHEST RESTORED!`);
          break;
        }

        // Account cooldown
        await sleep(22000);
      }
    }

    log(`🏁 [Funder @${sender.user}] Finished all assigned burner refills!`);
  });

  await Promise.all(workerPromises);

  // Final verification scan
  log('\n========================================================================');
  log('🏁 FINAL AUDIT: All 10 Burner Balances:');
  for (const b of burnersRaw) {
    await claimPending(b.cookie);
    const finalBal = await getBalance(b.cookie);
    log(`   [@${b.user}] Final Liquid Balance: ₦${finalBal.toLocaleString()} (${(finalBal / 1e12).toFixed(3)}T) ✅`);
  }
  log('========================================================================');
  log('🎉 ALL BURNER ACCOUNTS SUCCESSFULLY REFILLED TO ₦1 TRILLION WAR CHESTS!');
}

main().catch(err => {
  log(`💥 FATAL ERROR: ${err.message}`);
  console.error(err);
});
