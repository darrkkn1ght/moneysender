import fs from "node:fs";

const ACCOUNTS = [
  {
    name: "Miles Peter (@milespete)",
    user: "milespete",
    cookie: "ll_dev=2l08616a3s395t0d; ll_vid=102f439367af4102b904; ll_session=7905085c7b02a4e840a338dd3484f8995d019cd955fdf7d8f1c2a7ba846d1ee0; ll_pass=eyJpIjoiYmM3NDU4Mzc5MzVkNDVlZmJmNDciLCJ1IjoibWlsZXNwZXRlIiwibiI6Ik1pbGVzIFBldGVyIiwidCI6IlJPZXdwcjRWTlVNRE9uLUkiLCJlIjoxNzkyNDA0OTAyODk1fQ.wyQw5T4rXT32ZYfwVpvzddrsOPc4qM50CFHT6W-awrQ"
  },
  {
    name: "mr_who (@mr_who)",
    user: "mr_who",
    cookie: "ll_dev=0u144y403y0n5o4c; ll_session=30ed25151a51189b01b77ec860906bcf4ff53eef06599f910f94fa3b4f329fba; ll_vid=6f8f48ee77d84176833b; ll_pass=eyJpIjoiZDRmNGFlZDk0ZDZlNDkxOTg5Y2YiLCJ1IjoibXJfd2hvIiwibiI6Iklka3dldHVsbWEiLCJ0IjoicHdjNFB1U3R0M2ROZ0ZkVCIsImUiOjE3OTI0MzAwNTY0MDF9.wr29SLka5_4Xba5zcPiq9Aqe0qXtzmlBqv3kJKS1dIY"
  },
  {
    name: "Prince David (@princedavid)",
    user: "princedavid",
    cookie: "ll_dev=5e6j3b5q0h1w6544; ll_vid=41df63d592034b448922; ll_session=a49594e973a5e03650d28b08973a21b3a27c0407175e842e4f2711fa57b61159; ll_pass=eyJpIjoiN2U3OTE3NjBjZDY0NGYxM2JhNWEiLCJ1IjoicHJpbmNlZGF2aWQiLCJuIjoiUHJpbmNlRGF2aWQiLCJ0IjoiQ1VyZEdoazVKUTZFUEU2eSIsImUiOjE3OTI0Mjk4MzU3NTZ9.GmDFWFsTr1DID-Zg7nc0n08uDbe4SJM7ObMrNmz9ZJ8"
  },
  {
    name: "Sebastian (@blaqsebastian)",
    user: "blaqsebastian",
    cookie: "ll_dev=4o3z111w5i470l2f; ll_vid=2fe99f9ce0624c4abb14; ll_session=0eb20df322921c02aa976d9fa6d5a813021046eb1ea390f00d26a9646abd3718; ll_pass=eyJpIjoiNzc4NWNhZTRmMTU3NDUwNDkwZDUiLCJ1IjoiYmxhcXNlYmFzdGlhbiIsIm4iOiJTZWJhc3RpYW4iLCJ0Ijoid1hPLXRkQ2ZyVW4zbkJNbiIsImUiOjE3OTIzNDQ1MzI5MTV9.Bxn8glwFir1I4AoRyCRSppJSdA5EyrN6uXS24YqdB20"
  },
  {
    name: "Kvngdre (Dre)",
    user: "Kvngdre",
    cookie: "ll_dev=671n6y1n0l06545d; ll_session=d436631e376dd892b0fda0f40b675e04b6f3e38d3bea98f239be881504fbb0f0.hmvgcg8sd; ll_vid=5d27862aa58d43f38a0f; ll_pass=eyJpIjoiMWFiM2E0NTA0NTU0NDU3NGFmZTgiLCJ1IjoiS3ZuZ2RyZSIsIm4iOiJEcmUiLCJ0IjoiV0dGSFhwMEIyYmhJREFKbSIsImUiOjE3OTI0OTMyNDA5MDR9.ZB7Z6ee0ZHrRYhtlz4QfsruJ1_M8Wl5y6TE2qSdaeOE"
  },
  {
    name: "MR_ACE (@bigola2823)",
    user: "bigola2823",
    cookie: "ll_dev=5f3n1l1q1l345y3h; ll_session=d592c1fad731b326567fc1ba47077a51b59e74b80f175739e0e8e79abcae1b4e; ll_pass=eyJpIjoiNmUzYzRiZGFhYzZmNDc2NWJhNTIiLCJ1IjoiYmlnb2xhMjgyMyIsIm4iOiJNUl9BQ0UiLCJ0IjoieU9tTzF2cmstOGZtNU5DRCIsImUiOjE3OTI1MjE0ODIyNzJ9.D_iFTKRZWA_wuzkb9j77u5G8NNnlhLJ7ScbJE_hftQQ"
  }
];

async function check() {
  for (const acc of ACCOUNTS) {
    try {
      const res = await fetch("https://lagoslife.app/api/auth/me", {
        headers: { "cookie": acc.cookie, "user-agent": "Mozilla/5.0" }
      });
      const auth = await res.json().catch(() => ({}));
      if (res.status === 200 && auth.user) {
        const resSave = await fetch("https://lagoslife.app/api/save", {
          headers: { "cookie": acc.cookie, "user-agent": "Mozilla/5.0" }
        });
        const save = await resSave.json().catch(() => ({}));
        const money = save.game?.money ?? 0;
        console.log(`[${acc.user}] ACTIVE | Money: ₦${Number(money).toLocaleString()} | Name: ${auth.user.name}`);
      } else {
        console.log(`[${acc.user}] EXPIRED / INVALID (status ${res.status})`);
      }
    } catch (e) {
      console.log(`[${acc.user}] ERROR:`, e.message);
    }
  }
}
check();
