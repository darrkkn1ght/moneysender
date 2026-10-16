const COOKIE = 'll_dev=2l08616a3s395t0d; ll_session=1d12f55f7b42a1050b3161e5723deaa18ebe88a9e71ce962926a0e3c3768278e; ll_vid=102f439367af4102b904; ll_pass=eyJpIjoiYmM3NDU4Mzc5MzVkNDVlZmJmNDciLCJ1IjoibWlsZXNwZXRlIiwibiI6Ik1pbGVzIFBldGVyIiwidCI6ImU2RWE4Tl93RkRhUEdaRzUiLCJlIjoxNzkxOTk5NzYyODgzfQ.-Y6v-zHronvi4QC3ZiAg8odKZVdQZYHa9qGYxuRFNCI';

async function main() {
  const r = await fetch('https://lagoslife.app/games', { headers: { cookie: COOKIE } });
  console.log('Status /games:', r.status);
  const html = await r.text();
  console.log('Length:', html.length);
  const scripts = [...html.matchAll(/src="(\/_next\/static\/chunks\/[^"]+)"/g)].map(m => m[1]);
  console.log('Scripts:', scripts);
  
  // Also check build manifest
  const manifestMatch = html.match(/src="(\/_next\/static\/[^\/]+\/_buildManifest\.js)"/);
  if (manifestMatch) {
    console.log('Build manifest:', manifestMatch[1]);
  }
}

main().catch(console.error);
