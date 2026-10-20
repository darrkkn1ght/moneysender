const COOKIE = "ll_dev=2l08616a3s395t0d; ll_vid=102f439367af4102b904; ll_session=7905085c7b02a4e840a338dd3484f8995d019cd955fdf7d8f1c2a7ba846d1ee0; ll_pass=eyJpIjoiYmM3NDU4Mzc5MzVkNDVlZmJmNDciLCJ1IjoibWlsZXNwZXRlIiwibiI6Ik1pbGVzIFBldGVyIiwidCI6IlJPZXdwcjRWTlVNRE9uLUkiLCJlIjoxNzkyNDA0OTAyODk1fQ.wyQw5T4rXT32ZYfwVpvzddrsOPc4qM50CFHT6W-awrQ";

async function testSendLLDC() {
  const res = await fetch("https://lagoslife.app/api/send", {
    method: "POST",
    headers: {
      "accept": "application/json",
      "content-type": "application/json",
      "cookie": COOKIE,
      "user-agent": "Mozilla/5.0"
    },
    body: JSON.stringify({ to: "LLDC", amount: 1000 })
  });
  console.log("Status:", res.status);
  const data = await res.json().catch(() => ({}));
  console.log("Data:", data);

  // Also test looking up LLDC
  const r2 = await fetch("https://lagoslife.app/api/players?q=LLDC", {
    headers: { "cookie": COOKIE, "accept": "application/json" }
  });
  console.log("Players query status:", r2.status);
  const d2 = await r2.json().catch(() => ({}));
  console.log("Players query data:", JSON.stringify(d2, null, 2));
}

testSendLLDC();
