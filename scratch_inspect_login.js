async function findAuthDetails() {
  const url = "https://lagoslife.app/_next/static/chunks/2eck5xr9ivv_u.js";
  const res = await fetch(url);
  const text = await res.text();
  
  // Search for /api/auth/login
  const idx = text.indexOf("/api/auth/login");
  if (idx !== -1) {
    console.log("LOGIN SNIPPET:");
    console.log(text.substring(idx - 200, idx + 400));
  }

  const outIdx = text.indexOf("/api/auth/logout");
  if (outIdx !== -1) {
    console.log("\nLOGOUT SNIPPET:");
    console.log(text.substring(outIdx - 150, outIdx + 250));
  }
}
findAuthDetails();
