import fs from "node:fs/promises";

const COOKIE = "ll_vid=e2c5139529b14929bd43; ll_session=778892b94ea1f4c36ffde880a8bc6ea0bbd0618c651b69fe4659bcf488de52b8; ll_dev=165o5s0h0y6i4x6k; ll_pass=eyJpIjoiYmM3NDU4Mzc5MzVkNDVlZmJmNDciLCJ1IjoibWlsZXNwZXRlIiwibiI6Ik1pbGVzIFBldGVyIiwidCI6IlRVVkdqWXdLU3MyaFI5VEYiLCJlIjoxNzkxNTQ0ODQ4MTAzfQ.oxLDmu3-MgFQ7M1ybgW20DshT9nixQa9uwb_kI_m1V8";

const BASE_URL = "https://lagoslife.app/api";

const ENDPOINTS_TO_TEST = [
  { path: "/messages", method: "GET", query: "?with=7785cae4f157450490d5" },
  { path: "/user", method: "GET" },
  { path: "/profile", method: "GET" },
  { path: "/me", method: "GET" },
  { path: "/jobs", method: "GET" },
  { path: "/work", method: "GET" },
  { path: "/hunt", method: "GET" },
  { path: "/gem", method: "GET" },
  { path: "/daily", method: "GET" },
  { path: "/shop", method: "GET" },
  { path: "/company", method: "GET" },
  { path: "/till", method: "GET" },
  { path: "/leaderboard", method: "GET" },
  { path: "/world", method: "GET" },
  { path: "/search", method: "GET", query: "?q=blaqsebastian" }
];

async function explore() {
  console.log("==========================================");
  console.log("LagosLife API Feature & Endpoint Discovery");
  console.log("==========================================");
  console.log("");

  const results = {};

  for (const ep of ENDPOINTS_TO_TEST) {
    const url = `${BASE_URL}${ep.path}${ep.query || ""}`;
    try {
      const resp = await fetch(url, {
        method: ep.method,
        headers: {
          "accept": "*/*",
          "content-type": "application/json",
          "cookie": COOKIE,
          "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
        }
      });

      const contentType = resp.headers.get("content-type") || "";
      let data = null;

      if (contentType.includes("application/json")) {
        data = await resp.json();
      } else {
        data = await resp.text();
      }

      console.log(`[${resp.status}] ${ep.method} ${ep.path}${ep.query || ""}`);
      if (resp.ok) {
        console.log("   -> Data Snippet:", typeof data === "object" ? JSON.stringify(data).substring(0, 150) + "..." : String(data).substring(0, 150));
      }

      results[ep.path] = {
        status: resp.status,
        ok: resp.ok,
        sample: data
      };
    } catch (err) {
      console.log(`[ERR] ${ep.method} ${ep.path}: ${err.message}`);
    }
  }

  await fs.writeFile("./discovery_results.json", JSON.stringify(results, null, 2));
  console.log("");
  console.log("Discovery results saved to ./discovery_results.json");
}

explore();
