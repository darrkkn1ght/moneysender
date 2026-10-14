import fs from "node:fs/promises";

const COOKIE = "ll_vid=e2c5139529b14929bd43; ll_session=778892b94ea1f4c36ffde880a8bc6ea0bbd0618c651b69fe4659bcf488de52b8; ll_dev=165o5s0h0y6i4x6k; ll_pass=eyJpIjoiYmM3NDU4Mzc5MzVkNDVlZmJmNDciLCJ1IjoibWlsZXNwZXRlIiwibiI6Ik1pbGVzIFBldGVyIiwidCI6IlRVVkdqWXdLU3MyaFI5VEYiLCJlIjoxNzkxNTQ0ODQ4MTAzfQ.oxLDmu3-MgFQ7M1ybgW20DshT9nixQa9uwb_kI_m1V8";

const BASE_URL = "https://lagoslife.app/api";

async function fetchEndpoint(path) {
  try {
    const resp = await fetch(`${BASE_URL}${path}`, {
      headers: {
        "accept": "*/*",
        "content-type": "application/json",
        "cookie": COOKIE,
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
      }
    });

    if (resp.ok) {
      return await resp.json();
    }
  } catch (err) {
    console.error(`Error fetching ${path}:`, err.message);
  }
  return null;
}

async function extractAllData() {
  console.log("=================================================");
  console.log("    LAGOS LIFE GAME SYSTEM DATA EXTRACTION");
  console.log("=================================================");
  console.log("");

  // 1. Player Shops Catalog
  console.log("1. FETCHING PLAYER SHOPS & STOCKS...");
  const shopData = await fetchEndpoint("/shop");
  let shopSummary = [];
  if (shopData && shopData.shops) {
    console.log(`   Found ${shopData.shops.length} Active Player Shops!`);
    shopData.shops.forEach((shop, index) => {
      console.log(`   [Shop #${index + 1}] ${shop.name || "Store"} (${shop.by || shop.owner}) | Co: ${shop.co}`);
      if (shop.items && shop.items.length > 0) {
        shop.items.forEach(item => {
          console.log(`        - Item: ${item.name || item.p} | Price: N${item.price} | Stock: ${item.stock}`);
        });
      }
    });
    shopSummary = shopData.shops;
  } else {
    console.log("   Unable to fetch shop data.");
  }
  console.log("");

  // 2. Company & Till Balances
  console.log("2. FETCHING COMPANIES & TILL STATS...");
  const companyData = await fetchEndpoint("/company");
  if (companyData && companyData.snap && companyData.snap.companies) {
    console.log(`   Found ${companyData.snap.companies.length} Companies! Till Balance: N${companyData.snap.till}`);
    companyData.snap.companies.forEach(co => {
      console.log(`   [Company] ${co.name} (${co.ind}) | Units: ${co.units} | Value: N${co.value}`);
    });
  }
  console.log("");

  // 3. Job Board Listings
  console.log("3. FETCHING JOB BOARD LISTINGS...");
  const jobData = await fetchEndpoint("/jobs");
  if (jobData && jobData.board) {
    console.log(`   Found ${jobData.board.length} Active Jobs on Board!`);
    jobData.board.forEach((j, i) => {
      console.log(`   [Job #${i + 1}] Poster: ${j.poster} (ID: ${j.posterId})`);
    });
  }
  console.log("");

  // 4. Daily Gem Hunt Status
  console.log("4. FETCHING DAILY GEM HUNT DATA...");
  const huntData = await fetchEndpoint("/hunt");
  if (huntData) {
    console.log(`   Today's Clue: "${huntData.clue}"`);
    console.log(`   Total Found Today: ${huntData.found} players | Next Reward: N${huntData.nextReward}`);
  }
  console.log("");

  // 5. Daily Lagos News & Weather
  console.log("5. FETCHING DAILY CITY NEWS & WEATHER...");
  const dailyData = await fetchEndpoint("/daily");
  if (dailyData) {
    console.log(`   Date: ${dailyData.date} (${dailyData.weekday}) | Weather: ${dailyData.weather}`);
    console.log(`   Headline: "${dailyData.headline}"`);
    console.log(`   City Tip: "${dailyData.tip}"`);
  }
  console.log("");

  // Save complete payload
  const fullDump = {
    extractedAt: new Date().toISOString(),
    shops: shopData,
    companies: companyData,
    jobs: jobData,
    hunt: huntData,
    daily: dailyData
  };

  await fs.writeFile("./game_data_report.json", JSON.stringify(fullDump, null, 2));
  console.log("=================================================");
  console.log("Full data extraction saved to ./game_data_report.json");
  console.log("=================================================");
}

extractAllData();
