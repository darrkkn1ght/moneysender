import http from "node:http";

async function loginAndRead() {
  const loginRes = await fetch("https://lagoslife.app/api/auth/login", {
    method: "POST",
    headers: {
      "accept": "application/json",
      "content-type": "application/json",
      "origin": "https://lagoslife.app",
      "referer": "https://lagoslife.app/",
      "user-agent": "Mozilla/5.0"
    },
    body: JSON.stringify({
      username: "princedavid",
      password: "Oladelel"
    })
  });

  const setCookie = loginRes.headers.getSetCookie ? loginRes.headers.getSetCookie() : [];
  console.log("Login status:", loginRes.status);
  console.log("Set-Cookie:", setCookie);

  // Extract cookies
  const cookieHeader = setCookie.map(c => c.split(';')[0]).join('; ');
  console.log("New Cookie header:", cookieHeader);

  // Now read messages with 07bcd8554ae245a385ff
  const msgRes = await fetch("https://lagoslife.app/api/messages?with=07bcd8554ae245a385ff", {
    headers: {
      "accept": "application/json",
      "cookie": cookieHeader,
      "user-agent": "Mozilla/5.0"
    }
  });

  console.log("Msg status:", msgRes.status);
  const msgData = await msgRes.json().catch(() => ({}));
  console.log("Messages:", JSON.stringify(msgData, null, 2));

  // Also check /save to see PrinceDavid balance
  const saveRes = await fetch("https://lagoslife.app/api/save", {
    headers: {
      "accept": "application/json",
      "cookie": cookieHeader,
      "user-agent": "Mozilla/5.0"
    }
  });
  const saveData = await saveRes.json().catch(() => ({}));
  console.log("PrinceDavid cash:", saveData.game?.money ? Number(saveData.game.money).toLocaleString() : "N/A");
}

loginAndRead().catch(console.error);
