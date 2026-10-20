

const BLAQ_COOKIES = [
  "ll_dev=4o3z111w5i470l2f; ll_vid=2fe99f9ce0624c4abb14; ll_session=c0a17f10cf24947e9b87549591023ffaf52ecc947a5963da92c6fe5d95abda86; ll_pass=eyJpIjoiNzc4NWNhZTRmMTU3NDUwNDkwZDUiLCJ1IjoiYmxhcXNlYmFzdGlhbiIsIm4iOiJTZWJhc3RpYW4iLCJ0IjoiazBIdUtRd3pKV2w1M0pSNiIsImUiOjE3OTIwODU5ODI5MTd9.E_og7hq2w9ItZKs7wegJiq3hCTVZzbBsIynZA3R_S4Y",
  "ll_dev=4o3z111w5i470l2f; ll_vid=2fe99f9ce0624c4abb14; ll_session=0eb20df322921c02aa976d9fa6d5a813021046eb1ea390f00d26a9646abd3718; ll_pass=eyJpIjoiNzc4NWNhZTRmMTU3NDUwNDkwZDUiLCJ1IjoiYmxhcXNlYmFzdGlhbiIsIm4iOiJTZWJhc3RpYW4iLCJ0Ijoid1hPLXRkQ2ZyVW4zbkJNbiIsImUiOjE3OTIzNDQ1MzI5MTV9.Bxn8glwFir1I4AoRyCRSppJSdA5EyrN6uXS24YqdB20"
];

const PRINCE_COOKIE = "ll_dev=5e6j3b5q0h1w6544; ll_vid=41df63d592034b448922; ll_session=9bcfef2875bb6d192379de4fb4927479f6f68ed8205e6e0b4ce45c76c295bc99; ll_pass=eyJpIjoiN2U3OTE3NjBjZDY0NGYxM2JhNWEiLCJ1IjoicHJpbmNlZGF2aWQiLCJuIjoiUHJpbmNlRGF2aWQiLCJ0IjoiMVB1VDQwckFCTkZkdVFtZCIsImUiOjE3OTI0MDQ0NDU2Nzh9.KJyUzDIsOIJuNGvB8QrKY8oSCeUo8tJcvtHcbPmhduU";

const MILES_COOKIE = "ll_dev=2l08616a3s395t0d; ll_vid=102f439367af4102b904; ll_session=7905085c7b02a4e840a338dd3484f8995d019cd955fdf7d8f1c2a7ba846d1ee0; ll_pass=eyJpIjoiYmM3NDU4Mzc5MzVkNDVlZmJmNDciLCJ1IjoibWlsZXNwZXRlIiwibiI6Ik1pbGVzIFBldGVyIiwidCI6IlJPZXdwcjRWTlVNRE9uLUkiLCJlIjoxNzkyNDA0OTAyODk1fQ.wyQw5T4rXT32ZYfwVpvzddrsOPc4qM50CFHT6W-awrQ";

async function checkAccount(name, cookie) {
  try {
    const res = await fetch("https://lagoslife.app/api/auth/me", {
      headers: {
        "accept": "application/json",
        "cookie": cookie,
        "user-agent": "Mozilla/5.0"
      }
    });
    const data = await res.json().catch(() => ({}));
    console.log(`[${name}] /auth/me -> Status: ${res.status}, User:`, data.user ? `${data.user.username} (${data.user.id})` : data);
    return res.status === 200;
  } catch (e) {
    console.log(`[${name}] Error:`, e.message);
    return false;
  }
}

async function testAll() {
  console.log("Testing Prince David fresh cookie...");
  await checkAccount("PrinceDavid", PRINCE_COOKIE);

  console.log("Testing Miles Pete fresh cookie...");
  await checkAccount("MilesPete", MILES_COOKIE);

  console.log("Testing Blaq cookies...");
  for (let i = 0; i < BLAQ_COOKIES.length; i++) {
    console.log(`Testing Blaq Cookie Option ${i + 1}...`);
    const ok = await checkAccount(`Blaq Option ${i + 1}`, BLAQ_COOKIES[i]);
    if (ok) break;
  }
}

testAll();
