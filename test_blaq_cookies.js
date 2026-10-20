const BLAQ_COOKIES = [
  { name: "Option 1 (pipeline)", cookie: "ll_dev=4o3z111w5i470l2f; ll_vid=2fe99f9ce0624c4abb14; ll_session=c0a17f10cf24947e9b87549591023ffaf52ecc947a5963da92c6fe5d95abda86; ll_pass=eyJpIjoiNzc4NWNhZTRmMTU3NDUwNDkwZDUiLCJ1IjoiYmxhcXNlYmFzdGlhbiIsIm4iOiJTZWJhc3RpYW4iLCJ0IjoiazBIdUtRd3pKV2w1M0pSNiIsImUiOjE3OTIwODU5ODI5MTd9.E_og7hq2w9ItZKs7wegJiq3hCTVZzbBsIynZA3R_S4Y" },
  { name: "Option 2 (broadcast)", cookie: "ll_dev=4o3z111w5i470l2f; ll_vid=2fe99f9ce0624c4abb14; ll_session=0eb20df322921c02aa976d9fa6d5a813021046eb1ea390f00d26a9646abd3718; ll_pass=eyJpIjoiNzc4NWNhZTRmMTU3NDUwNDkwZDUiLCJ1IjoiYmxhcXNlYmFzdGlhbiIsIm4iOiJTZWJhc3RpYW4iLCJ0Ijoid1hPLXRkQ2ZyVW4zbkJNbiIsImUiOjE3OTIzNDQ1MzI5MTV9.Bxn8glwFir1I4AoRyCRSppJSdA5EyrN6uXS24YqdB20" }
];

async function testBlaq() {
  for (const opt of BLAQ_COOKIES) {
    const res = await fetch("https://lagoslife.app/api/auth/me", {
      headers: { "accept": "application/json", "cookie": opt.cookie }
    });
    const data = await res.json().catch(() => ({}));
    console.log(`[${opt.name}] User:`, data.user ? `${data.user.username} (${data.user.id})` : data);
  }
}

testBlaq();
