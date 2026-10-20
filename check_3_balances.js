const ACCOUNTS = {
  "Blaq": "ll_dev=4o3z111w5i470l2f; ll_vid=2fe99f9ce0624c4abb14; ll_session=0eb20df322921c02aa976d9fa6d5a813021046eb1ea390f00d26a9646abd3718; ll_pass=eyJpIjoiNzc4NWNhZTRmMTU3NDUwNDkwZDUiLCJ1IjoiYmxhcXNlYmFzdGlhbiIsIm4iOiJTZWJhc3RpYW4iLCJ0Ijoid1hPLXRkQ2ZyVW4zbkJNbiIsImUiOjE3OTIzNDQ1MzI5MTV9.Bxn8glwFir1I4AoRyCRSppJSdA5EyrN6uXS24YqdB20",
  "PrinceDavid": "ll_dev=5e6j3b5q0h1w6544; ll_vid=41df63d592034b448922; ll_session=9bcfef2875bb6d192379de4fb4927479f6f68ed8205e6e0b4ce45c76c295bc99; ll_pass=eyJpIjoiN2U3OTE3NjBjZDY0NGYxM2JhNWEiLCJ1IjoicHJpbmNlZGF2aWQiLCJuIjoiUHJpbmNlRGF2aWQiLCJ0IjoiMVB1VDQwckFCTkZkdVFtZCIsImUiOjE3OTI0MDQ0NDU2Nzh9.KJyUzDIsOIJuNGvB8QrKY8oSCeUo8tJcvtHcbPmhduU",
  "MilesPete": "ll_dev=2l08616a3s395t0d; ll_vid=102f439367af4102b904; ll_session=7905085c7b02a4e840a338dd3484f8995d019cd955fdf7d8f1c2a7ba846d1ee0; ll_pass=eyJpIjoiYmM3NDU4Mzc5MzVkNDVlZmJmNDciLCJ1IjoibWlsZXNwZXRlIiwibiI6Ik1pbGVzIFBldGVyIiwidCI6IlJPZXdwcjRWTlVNRE9uLUkiLCJlIjoxNzkyNDA0OTAyODk1fQ.wyQw5T4rXT32ZYfwVpvzddrsOPc4qM50CFHT6W-awrQ"
};

async function checkBalances() {
  for (const [name, cookie] of Object.entries(ACCOUNTS)) {
    try {
      const res = await fetch("https://lagoslife.app/api/save", {
        headers: { "accept": "application/json", "cookie": cookie }
      });
      const data = await res.json().catch(() => ({}));
      console.log(`[${name}] status: ${res.status}`);
      if (data.game) console.log(`   data.game keys:`, Object.keys(data.game), "wallet/cash:", data.game.wallet, data.game.cash, data.game.money);


    } catch (e) {
      console.log(`[${name}] Error:`, e.message);
    }
  }
}

checkBalances();
