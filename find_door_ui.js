import fs from 'node:fs';

async function main() {
  const pageRes = await fetch('https://lagoslife.app/');
  const html = await pageRes.text();
  const scriptMatches = [...html.matchAll(/src="(\/_next\/static\/chunks\/[^"]+)"/g)].map(m => m[1]);
  for (const s of scriptMatches) {
    try {
      const r = await fetch('https://lagoslife.app' + s);
      const txt = await r.text();
      // Check if this chunk references answerKnock
      if (txt.includes('answerKnock')) {
        console.log(`=== answerKnock in ${s} ===`);
      }
      // Check if this chunk has "Let them in" or "Let in" or "at the door"
      const lower = txt.toLowerCase();
      for (const phrase of ['let them in', 'at the door', 'rings', 'doorbell', 'is knocking', 'at your door']) {
        let idx = 0;
        while ((idx = lower.indexOf(phrase, idx)) !== -1) {
          console.log(`=== Found "${phrase}" in ${s} at ${idx} ===`);
          console.log(txt.substring(Math.max(0, idx - 150), Math.min(txt.length, idx + 300)));
          idx += phrase.length;
        }
      }
    } catch (e) {
      console.error(s, e.message);
    }
  }
}

main();
