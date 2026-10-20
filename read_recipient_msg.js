

const COOKIE = "ll_dev=5e6j3b5q0h1w6544; ll_vid=41df63d592034b448922; ll_session=9bcfef2875bb6d192379de4fb4927479f6f68ed8205e6e0b4ce45c76c295bc99; ll_pass=eyJpIjoiN2U3OTE3NjBjZDY0NGYxM2JhNWEiLCJ1IjoicHJpbmNlZGF2aWQiLCJuIjoiUHJpbmNlRGF2aWQiLCJ0IjoiMVB1VDQwckFCTkZkdVFtZCIsImUiOjE3OTI0MDQ0NDU2Nzh9.KJyUzDIsOIJuNGvB8QrKY8oSCeUo8tJcvtHcbPmhduU";

async function readMessages() {
  const url = "https://lagoslife.app/api/messages?with=07bcd8554ae245a385ff&since=1792427950756";
  const res = await fetch(url, {
    headers: {
      "accept": "application/json",
      "cookie": COOKIE,
      "user-agent": "Mozilla/5.0"
    }
  });
  console.log("Status:", res.status);
  const data = await res.json().catch(() => ({}));
  console.log("Data:", JSON.stringify(data, null, 2));
}

readMessages();
