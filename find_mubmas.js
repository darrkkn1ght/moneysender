const COOKIE = "ll_dev=2l08616a3s395t0d; ll_vid=102f439367af4102b904; ll_session=7905085c7b02a4e840a338dd3484f8995d019cd955fdf7d8f1c2a7ba846d1ee0; ll_pass=eyJpIjoiYmM3NDU4Mzc5MzVkNDVlZmJmNDciLCJ1IjoibWlsZXNwZXRlIiwibiI6Ik1pbGVzIFBldGVyIiwidCI6IlJPZXdwcjRWTlVNRE9uLUkiLCJlIjoxNzkyNDA0OTAyODk1fQ.wyQw5T4rXT32ZYfwVpvzddrsOPc4qM50CFHT6W-awrQ";

async function main() {
  const qList = ["mubmas", "MUBMAS"];
  for (const q of qList) {
    try {
      const res = await fetch(`https://lagoslife.app/api/players?q=${encodeURIComponent(q)}`, {
        headers: { cookie: COOKIE, accept: "application/json", "user-agent": "Mozilla/5.0" }
      });
      const data = await res.json();
      console.log(`Query '${q}':`, JSON.stringify(data));
    } catch (e) {
      console.error(e.message);
    }
  }
}

main();
