# LagosLife Automation & API Architecture Dossier

## 1. System Overview
* **Platform Domains:** `https://lagoslife.app` & `https://lagoslife.eliysites.com`
* **API Base URL:** `https://lagoslife.app/api`
* **Protocol:** HTTPS REST / JSON API with cookie-based session authorization and idempotency headers.

---

## 2. Authentication & Session Structure
LagosLife uses 4 primary cookies to authorize all client requests:

| Cookie Name | Purpose | Example / Format |
| :--- | :--- | :--- |
| `ll_vid` | Visitor / Device fingerprint | `2fe99f9ce0624c4abb14` |
| `ll_dev` | Client hardware / dev ID | `4o3z111w5i470l2f` |
| `ll_session` | Server session token | `c0a17f10cf24947e9b87...` |
| `ll_pass` | Base64-signed payload | `eyJpIjoi...` (contains UID, username, display name, token, expiration timestamp + HMAC signature) |

### Required HTTP Headers
```http
Accept: application/json
Content-Type: application/json
Cookie: ll_dev=...; ll_vid=...; ll_session=...; ll_pass=...
User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36
Idempotency-Key: <UUIDv4>   # Mandatory on financial / stateful POSTs
```

---

## 3. Discovered API Endpoints

### 3.1 Financial & Transfers
* **`POST /api/send`**
  * **Payload:** `{"to": "<RECIPIENT_USER_ID>", "amount": <NUMBER>}`
  * **Headers:** Requires a unique `Idempotency-Key: <UUID>` header for every transaction.
  * **Behavior & Limitations:**
    * Standard max transaction: ₦10,000,000,000 (10B) per request.
    * Server throttle delay: ~25s recommended interval between requests.
    * Rate limit error: `429 Too Many Requests` (requires backoff).
    * Restriction error: `429` with message: `"Your account is restricted: you can send up to ₦10m a day. ₦10,000,000 left today."`

### 3.2 Chat & Messaging
* **`GET /api/messages?with=<USER_ID>`**
  * Retrieves direct message conversation history with a target player.
* **`POST /api/messages`**
  * **Payload:** `{"to": "<RECIPIENT_USER_ID>", "body": "<MESSAGE_TEXT>"}`
  * **Response:** `200 {"id": "<MESSAGE_ID>"}`
  * Sends direct in-game chat messages from the authenticated account.

### 3.3 Economy, Commerce & Companies
* **`GET /api/shop`**
  * Returns active player stores, categories, and item listings (`f-amala`, `f-jollof`, `f-suya`, `f-chapman`, etc.), along with owner IDs, district locations, prices, and stock counts.
* **`GET /api/company`**
  * Returns registered corporations, industry classification, issued unit shares, market valuation, and the global treasury/till balance (`snap.till`).
* **`GET /api/till`**
  * Corporate till management and company cash-out operations.
* **`GET /api/jobs`**
  * Job board listings containing available contracts, employer poster IDs, and bounties.

### 3.4 World, Mini-Games & Venues
* **`GET /api/daily`**
  * Daily news briefing: Lagos in-game weather, news headlines, and daily tips.
* **`GET /api/hunt`**
  * Daily gem scavenger hunt: current clue string, count of players who found it today, and the next bounty amount.
* **`GET/POST /api/venue`**
  * Venues and nightlife locations (e.g. `quilox`, `ojuelegba`, `snookerSpot`).
* **`GET/POST /api/action`**
  * In-world interactions (`playWhot`, `playSnooker`, nightclub drink orders).
* **`GET /api/whot` & `/api/game/whot`**
  * Whot multiplayer card game lobby, table state, and move dispatch.
* **`GET /api/save`**
  * Master player save state sync endpoint.

---

## 4. Built Infrastructure & Tooling

### 4.1 Automated Transfer Pipelines (`pipeline_*.js`)
* **State Persistence:** Automatic state synchronization via `balances_<name>.json` files storing `remaining`, `txCount`, and `target`. If interrupted, scripts resume from where they left off without double-spending.
* **Batch Scheduling:** Multi-step scripts (`run_c060_then_resume_blaq.js`, `run_dual_pipeline.js`) that chain transfers sequentially between accounts.
* **Safety & Resiliency:**
  * Auto-generation of random UUID idempotency keys to prevent network duplicates.
  * Status 429 backoff handling.
  * Immediate status 401 session-expiry halting.

### 4.2 Central Dashboard & Server (`server.js`)
* **Multi-Account Storage (`data/accounts.json`):** Manages cookies and credentials for multiple identities (e.g., `@milespete`, `@blaqsebastian`, `@princedavid`).
* **Console 1-Click Sync (`/api/sync`):** Browser console snippet to export cookies and session tokens directly into the backend storage.
* **Live Pipeline Monitor (`/api/transfers/live`):** Reads all active `.json` state files in real time, calculating progress percentages, total transferred funds, and remaining amounts for web UI monitoring.

---

## 5. Account Mappings Mapped
* **`blaqsebastian` / `Sebastian`:** `7785cae4f157450490d5`
* **`milespete` / `Miles Peter`:** `bc745837935d45efbf47`
* **`princedavid`:** `7e791760cd644f13ba5a`
