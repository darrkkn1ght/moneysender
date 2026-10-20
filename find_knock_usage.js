import fs from 'node:fs';

async function scanUsage() {
  const pageRes = await fetch('https://lagoslife.app/');
  const html = await pageRes.text();
  const scriptMatches = [...html.matchAll(/src="(\/_next\/static\/chunks\/[^"]+)"/g)].map(m => m[1]);
  for (const s of scriptMatches) {
    try {
      const r = await fetch('https://lagoslife.app' + s);
      const txt = await r.text();
      if (txt.includes('answerKnock')) {
        console.log('\n=== Script with answerKnock:', s, '===');
        let pos = 0;
        while ((pos = txt.indexOf('answerKnock', pos)) !== -1) {
          console.log('\n--- Usage at', pos, '---');
          console.log(txt.substring(Math.max(0, pos - 150), Math.min(txt.length, pos + 400)));
          pos += 11;
        }
      }
      if (txt.includes('GET /api/knock') || txt.includes('/api/knock') || txt.includes('knocking') || txt.includes('knocks')) {
        let pos = 0;
        while ((pos = txt.indexOf('/api/knock', pos)) !== -1) {
          console.log('\n--- /api/knock at', pos, 'in', s, '---');
          console.log(txt.substring(Math.max(0, pos - 150), Math.min(txt.length, pos + 400)));
          pos += 10;
        }
      }
    } catch (e) {
      console.error('Error on', s, e.message);
    }
  }
}

scanUsage();
