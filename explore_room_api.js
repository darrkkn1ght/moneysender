import fs from "node:fs/promises";

const COOKIE = "ll_vid=e2c5139529b14929bd43; ll_session=778892b94ea1f4c36ffde880a8bc6ea0bbd0618c651b69fe4659bcf488de52b8; ll_dev=165o5s0h0y6i4x6k; ll_pass=eyJpIjoiYmM3NDU4Mzc5MzVkNDVlZmJmNDciLCJ1IjoibWlsZXNwZXRlIiwibiI6Ik1pbGVzIFBldGVyIiwidCI6IlRVVkdqWXdLU3MyaFI5VEYiLCJlIjoxNzkxNTg6MDU1NjI1fQ.7VzMtbZ14jWfYBHbtBd9tAxUjIlA0fmu8irKlTynBJI";
const BASE_URL = "https://lagoslife.eliysites.com/api";

async function exploreRoom() {
  console.log("=== Exploring Profile & Room Endpoints ===");
  
  // 1. Get profile to find house / room ID
  try {
    const profResp = await fetch(`${BASE_URL}/profile`, {
      headers: { "cookie": COOKIE, "accept": "application/json" }
    });
    const profile = await profResp.json();
    console.log("[PROFILE]:", JSON.stringify(profile, null, 2));
    await fs.writeFile("./profile_dump.json", JSON.stringify(profile, null, 2));
  } catch (e) {
    console.error("Profile error:", e.message);
  }

  // 2. Test room variations
  const testUrls = [
    "/room",
    "/room?house=bc745837935d45efbf47",
    "/room?id=bc745837935d45efbf47",
    "/room?user=milespete",
    "/room?owner=bc745837935d45efbf47"
  ];

  for (const path of testUrls) {
    try {
      const resp = await fetch(`${BASE_URL}${path}`, {
        headers: { "cookie": COOKIE, "accept": "application/json" }
      });
      const data = await resp.text();
      console.log(`[${resp.status}] GET ${path}:`, data.substring(0, 200));
    } catch (e) {
      console.error(`GET ${path} err:`, e.message);
    }
  }
}

exploreRoom().catch(console.error);
