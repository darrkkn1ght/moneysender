import fs from 'node:fs/promises';
import path from 'node:path';

async function main() {
  await fs.mkdir('./chunks', { recursive: true });
  const pageRes = await fetch('https://lagoslife.app/');
  const html = await pageRes.text();
  const scriptMatches = [...html.matchAll(/src="(\/_next\/static\/chunks\/[^"]+)"/g)].map(m => m[1]);

  for (const s of scriptMatches) {
    const filename = path.basename(s);
    try {
      const r = await fetch('https://lagoslife.app' + s);
      const text = await r.text();
      await fs.writeFile(path.join('./chunks', filename), text, 'utf8');
      console.log('Saved', filename, text.length, 'bytes');
    } catch (e) {
      console.error('Failed to download', s, e.message);
    }
  }
}

main();
