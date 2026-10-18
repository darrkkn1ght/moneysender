#!/usr/bin/env python3
"""
money.py — LagosLife Balance-Modification Test Script

This script tests balance-crediting through LagosLife's verified API.
Based on thorough inspection of the codebase, the ONLY mechanism for
crediting another player's balance is the peer-to-peer transfer endpoint:

  POST https://lagoslife.app/api/send
  Payload: {"to": "<RECIPIENT_UID>", "amount": <int>}
  Requires: Cookie auth + Idempotency-Key UUID header

There is NO developer/sandbox/admin credit endpoint. No self-credit.
Balance can ONLY increase via receiving a send from another account.

Verification: GET https://lagoslife.app/api/save  (returns player save state
including current balance in the response JSON)

Modes:
  --dry-run         Show what would happen without sending (default)
  --live            Execute the transfer for real
  --mock            Run against a local mock server

Usage:
  python money.py --dry-run --from milespete --to blaqsebastian --amount 1000
  python money.py --live --from milespete --to blaqsebastian --amount 1000
  python money.py --mock --amount 5000
"""

import argparse
import json
import os
import sys
import time
import uuid
import logging
from datetime import datetime, timezone
from pathlib import Path
from http.server import HTTPServer, BaseHTTPRequestHandler
import threading

# ─── Logging ────────────────────────────────────────────────────────
LOG_FILE = Path(__file__).parent / "money_test.log"

logger = logging.getLogger("money")
logger.setLevel(logging.DEBUG)

# File handler (detailed)
fh = logging.FileHandler(LOG_FILE, encoding="utf-8")
fh.setLevel(logging.DEBUG)
fh.setFormatter(logging.Formatter(
    "%(asctime)s [%(levelname)s] %(message)s", datefmt="%Y-%m-%dT%H:%M:%S"
))
logger.addHandler(fh)

# Console handler (clean)
ch = logging.StreamHandler()
ch.setLevel(logging.INFO)
ch.setFormatter(logging.Formatter("%(message)s"))
logger.addHandler(ch)

# ─── Constants ──────────────────────────────────────────────────────
API_BASE = "https://lagoslife.app/api"
ACCOUNTS_FILE = Path(__file__).parent / "data" / "accounts.json"
MAX_PER_TX = 10_000_000_000   # 10B per request (game limit)
RECOMMENDED_DELAY_S = 25      # Seconds between transactions
REQUEST_TIMEOUT_S = 30

# ─── Account Aliases ───────────────────────────────────────────────
USERNAME_MAP = {
    "blaqsebastian": "7785cae4f157450490d5",
    "blaq":          "7785cae4f157450490d5",
    "sebastian":     "7785cae4f157450490d5",
    "milespete":     "bc745837935d45efbf47",
    "miles":         "bc745837935d45efbf47",
    "princedavid":   "7e791760cd644f13ba5a",
}


def sanitize_cookie(cookie: str) -> str:
    """Mask sensitive cookie values for logging."""
    if not cookie:
        return "<empty>"
    parts = cookie.split(";")
    masked = []
    for part in parts:
        kv = part.strip().split("=", 1)
        if len(kv) == 2:
            key, val = kv
            masked.append(f"{key.strip()}=***{val[-4:]}" if len(val) > 8 else f"{key.strip()}=****")
        else:
            masked.append("****")
    return "; ".join(masked)


def load_accounts():
    """Load accounts from data/accounts.json (existing project infrastructure)."""
    if not ACCOUNTS_FILE.exists():
        logger.error(f"Accounts file not found: {ACCOUNTS_FILE}")
        return []
    try:
        data = json.loads(ACCOUNTS_FILE.read_text("utf-8"))
        return data
    except Exception as e:
        logger.error(f"Failed to load accounts: {e}")
        return []


def find_account(name_or_id: str, accounts: list) -> dict | None:
    """Find an account by name, user field, or ID."""
    needle = name_or_id.strip().lower().replace("@", "")
    for acc in accounts:
        if needle in (acc.get("user", "").lower(), acc.get("id", "").lower()):
            return acc
        if needle in acc.get("name", "").lower():
            return acc
    return None


def resolve_recipient(input_str: str) -> str:
    """Resolve username/alias/URL to a player UID."""
    s = input_str.strip()

    # URL extraction: ?with=XXXXX
    import re
    url_match = re.search(r'[?&]with=([a-f0-9]+)', s, re.I)
    if url_match:
        return url_match.group(1)

    # Profile URL
    profile_match = re.search(r'lagoslife\.app/.*?([a-f0-9]{16,})', s, re.I)
    if profile_match:
        return profile_match.group(1)

    # Username alias
    cleaned = s.lower().replace("@", "")
    if cleaned in USERNAME_MAP:
        return USERNAME_MAP[cleaned]

    # Assume raw UID
    return s


def format_amount(n: int) -> str:
    """Human-readable amount formatting."""
    if n >= 1_000_000_000_000:
        return f"{n / 1e12:.1f}T"
    if n >= 1_000_000_000:
        return f"{n / 1e9:.1f}B"
    if n >= 1_000_000:
        return f"{n / 1e6:.1f}M"
    return f"₦{n:,}"


# ─── API Client ─────────────────────────────────────────────────────
try:
    import urllib.request
    import urllib.error
    HAS_URLLIB = True
except ImportError:
    HAS_URLLIB = False

try:
    import requests as req_lib
    HAS_REQUESTS = True
except ImportError:
    HAS_REQUESTS = False


class LagosLifeClient:
    """HTTP client for LagosLife API using urllib (no external deps)."""

    def __init__(self, cookie: str, base_url: str = API_BASE):
        self.cookie = cookie
        self.base_url = base_url

    def _headers(self, idempotency_key: str | None = None) -> dict:
        h = {
            "Accept": "application/json",
            "Content-Type": "application/json",
            "Cookie": self.cookie,
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        }
        if idempotency_key:
            h["Idempotency-Key"] = idempotency_key
        return h

    def _request(self, method: str, path: str, body: dict | None = None,
                 idempotency_key: str | None = None) -> dict:
        """Make an HTTP request and return {status, data, error}."""
        url = f"{self.base_url}{path}"
        headers = self._headers(idempotency_key)
        data_bytes = json.dumps(body).encode("utf-8") if body else None

        try:
            req = urllib.request.Request(url, data=data_bytes, headers=headers, method=method)
            with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT_S) as resp:
                resp_body = resp.read().decode("utf-8")
                try:
                    resp_data = json.loads(resp_body)
                except json.JSONDecodeError:
                    resp_data = {"raw": resp_body[:500]}
                return {"status": resp.status, "data": resp_data, "error": None}
        except urllib.error.HTTPError as e:
            resp_body = e.read().decode("utf-8", errors="replace") if e.fp else ""
            try:
                resp_data = json.loads(resp_body)
            except (json.JSONDecodeError, Exception):
                resp_data = {"raw": resp_body[:500]}
            return {"status": e.code, "data": resp_data, "error": str(e.reason)}
        except urllib.error.URLError as e:
            return {"status": 0, "data": None, "error": f"Network error: {e.reason}"}
        except Exception as e:
            return {"status": 0, "data": None, "error": str(e)}

    def get_balance(self) -> dict:
        """Fetch player save state via GET /api/save."""
        return self._request("GET", "/save")

    def send_money(self, to: str, amount: int, idempotency_key: str) -> dict:
        """Transfer money via POST /api/send."""
        return self._request("POST", "/send",
                             body={"to": to, "amount": amount},
                             idempotency_key=idempotency_key)


# ─── Local Mock Server ──────────────────────────────────────────────
MOCK_BALANCE = 50_000_000_000_000  # 50T starting mock balance


class MockHandler(BaseHTTPRequestHandler):
    """Simple mock of /api/save and /api/send for offline testing."""
    balance = MOCK_BALANCE
    tx_log = []

    def log_message(self, format, *args):
        pass  # Suppress default HTTP log noise

    def _respond(self, status, body):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(body).encode())

    def do_GET(self):
        if self.path == "/api/save":
            self._respond(200, {
                "snap": {"cash": MockHandler.balance},
                "mock": True,
                "timestamp": datetime.now(timezone.utc).isoformat()
            })
        else:
            self._respond(404, {"error": "Not found"})

    def do_POST(self):
        if self.path == "/api/send":
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length)) if length else {}
            amount = body.get("amount", 0)
            to = body.get("to", "")
            idem_key = self.headers.get("Idempotency-Key", "")

            # Check duplicate
            if idem_key in [tx["key"] for tx in MockHandler.tx_log]:
                self._respond(200, {"msg": "duplicate idempotency key (already processed)", "mock": True})
                return

            # Check balance
            if amount > MockHandler.balance:
                self._respond(400, {"error": "Insufficient balance", "mock": True})
                return

            if amount <= 0:
                self._respond(400, {"error": "Invalid amount", "mock": True})
                return

            # Process
            MockHandler.balance -= amount
            MockHandler.tx_log.append({
                "key": idem_key, "to": to, "amount": amount,
                "at": datetime.now(timezone.utc).isoformat()
            })
            self._respond(200, {
                "msg": f"Sent {amount} to {to}",
                "balance_after": MockHandler.balance,
                "mock": True
            })
        else:
            self._respond(404, {"error": "Not found"})


def start_mock_server(port=9877):
    """Start a local mock LagosLife API server."""
    server = HTTPServer(("127.0.0.1", port), MockHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    logger.info(f"🧪 Mock server started on http://127.0.0.1:{port}")
    return server, f"http://127.0.0.1:{port}/api"


# ─── Core Test Flow ─────────────────────────────────────────────────

def extract_balance(save_response: dict) -> int | None:
    """Extract cash balance from /api/save response."""
    data = save_response.get("data")
    if not data:
        return None
    # Try common structures
    if isinstance(data, dict):
        snap = data.get("snap", data)
        if isinstance(snap, dict):
            cash = snap.get("cash")
            if cash is not None:
                return int(cash)
            # Try nested
            for key in ("balance", "money", "wallet", "funds"):
                val = snap.get(key)
                if val is not None:
                    return int(val)
    return None


def run_test(mode: str, sender_account: dict | None, recipient_id: str,
             amount: int, base_url: str = API_BASE):
    """
    Execute the balance-modification test.

    mode: 'dry-run', 'live', or 'mock'
    """
    ts = datetime.now(timezone.utc).isoformat()
    logger.info("=" * 60)
    logger.info("  LagosLife Balance-Modification Test")
    logger.info(f"  Mode:      {mode.upper()}")
    logger.info(f"  Timestamp: {ts}")
    logger.info("=" * 60)

    # ── Endpoint verification report ──
    logger.info("")
    logger.info("📋 VERIFIED ENDPOINT REPORT")
    logger.info("─" * 40)
    logger.info("Endpoint:      POST /api/send")
    logger.info("Method:        Peer-to-peer transfer (debit sender, credit recipient)")
    logger.info("Payload:       {\"to\": \"<recipient_uid>\", \"amount\": <integer>}")
    logger.info("Auth:          Cookie-based (ll_vid, ll_session, ll_dev, ll_pass)")
    logger.info("Required Hdr:  Idempotency-Key: <UUIDv4> (per transaction)")
    logger.info("Max per TX:    10,000,000,000 (10B)")
    logger.info("Rate limit:    ~25s recommended interval, 429 on exceed")
    logger.info("Balance check: GET /api/save → response.snap.cash")
    logger.info("")
    logger.info("⚠️  NO sandbox/admin/self-credit endpoint exists.")
    logger.info("    Balance modification ONLY via send from another account.")
    logger.info("─" * 40)

    if not sender_account and mode != "mock":
        logger.error("❌ No sender account found. Cannot proceed in live mode.")
        return False

    # Build client
    cookie = sender_account["cookie"] if sender_account else "mock-cookie"
    client = LagosLifeClient(cookie=cookie, base_url=base_url)

    logger.info(f"Sender:    {sender_account.get('name', 'Mock') if sender_account else 'Mock Account'}")
    logger.info(f"Sender cookie: {sanitize_cookie(cookie)}")
    logger.info(f"Recipient: {recipient_id}")
    logger.info(f"Amount:    {format_amount(amount)} ({amount:,})")
    logger.info("")

    # ── Step 1: Pre-transfer balance check ──
    logger.info("📊 Step 1: Checking sender balance (GET /api/save)...")
    balance_before = None

    if mode == "dry-run":
        logger.info("   [DRY-RUN] Skipping actual API call")
        logger.info(f"   Would fetch: {base_url}/save")
    else:
        save_resp = client.get_balance()
        logger.debug(f"   Save response status: {save_resp['status']}")
        if save_resp["status"] == 200:
            balance_before = extract_balance(save_resp)
            if balance_before is not None:
                logger.info(f"   ✅ Current balance: {format_amount(balance_before)} ({balance_before:,})")
            else:
                logger.warning("   ⚠️ Got 200 but couldn't extract balance from response")
                logger.debug(f"   Response keys: {list(save_resp['data'].keys()) if isinstance(save_resp['data'], dict) else 'N/A'}")
        elif save_resp["status"] == 401:
            logger.error("   🔒 Authentication failed (401). Session expired.")
            logger.error("   Update cookies in data/accounts.json and retry.")
            return False
        else:
            logger.warning(f"   ⚠️ Balance check returned status {save_resp['status']}: {save_resp.get('error', '')}")

    # ── Step 2: Calculate transaction plan ──
    num_txs = max(1, (amount + MAX_PER_TX - 1) // MAX_PER_TX)
    logger.info("")
    logger.info(f"📝 Step 2: Transaction plan")
    logger.info(f"   Total amount:    {format_amount(amount)}")
    logger.info(f"   Per-TX limit:    {format_amount(MAX_PER_TX)}")
    logger.info(f"   Transactions:    {num_txs}")
    logger.info(f"   Delay between:   {RECOMMENDED_DELAY_S}s")
    logger.info(f"   Est. duration:   ~{num_txs * RECOMMENDED_DELAY_S}s ({num_txs * RECOMMENDED_DELAY_S / 60:.1f} min)")

    if balance_before is not None and balance_before < amount:
        logger.error(f"   ❌ Insufficient balance! Have {format_amount(balance_before)}, need {format_amount(amount)}")
        return False

    # ── Step 3: Execute or simulate ──
    logger.info("")
    if mode == "dry-run":
        logger.info("🧪 Step 3: DRY-RUN — Simulating transactions")
        logger.info("─" * 40)
        remaining = amount
        for i in range(num_txs):
            tx_amount = min(MAX_PER_TX, remaining)
            idem_key = str(uuid.uuid4())
            logger.info(f"   [TX {i+1}/{num_txs}] Would send {format_amount(tx_amount)} to {recipient_id}")
            logger.info(f"      Idempotency-Key: {idem_key}")
            logger.info(f"      POST {base_url}/send")
            logger.info(f"      Body: {{\"to\": \"{recipient_id}\", \"amount\": {tx_amount}}}")
            remaining -= tx_amount
        logger.info("─" * 40)
        logger.info("✅ DRY-RUN COMPLETE — No requests were sent.")
        logger.info(f"   To execute for real, run with --live flag.")
        return True

    # LIVE or MOCK execution
    logger.info(f"🚀 Step 3: Executing {num_txs} transaction(s) [{mode.upper()}]")
    logger.info("─" * 40)

    remaining = amount
    completed = 0
    total_sent = 0

    for i in range(num_txs):
        tx_amount = min(MAX_PER_TX, remaining)
        idem_key = str(uuid.uuid4())
        tx_num = i + 1

        logger.info(f"   [TX {tx_num}/{num_txs}] Sending {format_amount(tx_amount)}...")

        success = False
        retries = 0
        max_retries = 10

        while not success and retries < max_retries:
            retries += 1
            result = client.send_money(to=recipient_id, amount=tx_amount, idempotency_key=idem_key)

            if result["status"] == 200:
                success = True
                completed += 1
                total_sent += tx_amount
                remaining -= tx_amount
                pct = (total_sent / amount) * 100
                logger.info(f"      ✅ OK (200) | Sent: {format_amount(total_sent)} | {pct:.1f}% | {datetime.now().strftime('%H:%M:%S')}")
                if result.get("data"):
                    # Log non-sensitive response data
                    resp_info = {k: v for k, v in result["data"].items()
                                 if k not in ("cookie", "session", "token", "pass")}
                    logger.debug(f"      Response: {json.dumps(resp_info)[:200]}")

            elif result["status"] == 429:
                wait = 10 + retries * 5
                logger.warning(f"      ⏳ Rate limited (429). Retry {retries}/{max_retries} in {wait}s...")
                time.sleep(wait)

            elif result["status"] == 401:
                logger.error("      🔒 Session expired (401)! Halting immediately.")
                logger.error("      Update cookies in data/accounts.json and retry.")
                return False

            elif result["status"] == 0:
                wait = 5
                logger.warning(f"      ⚠️ Network error: {result.get('error', 'unknown')}. Retry in {wait}s...")
                time.sleep(wait)

            else:
                error_msg = result.get("error", "")
                data_msg = json.dumps(result.get("data", {}))[:150] if result.get("data") else ""
                logger.error(f"      ❌ Error {result['status']}: {error_msg} {data_msg}")
                wait = 5
                time.sleep(wait)

        if not success:
            logger.error(f"      ❌ TX {tx_num} failed after {max_retries} retries. Halting.")
            break

        # Delay between transactions
        if remaining > 0:
            logger.info(f"      ⏳ Waiting {RECOMMENDED_DELAY_S}s before next TX...")
            time.sleep(RECOMMENDED_DELAY_S)

    logger.info("─" * 40)

    # ── Step 4: Post-transfer balance verification ──
    logger.info("")
    logger.info("📊 Step 4: Post-transfer balance verification...")

    balance_after = None
    time.sleep(2)  # Brief wait for server state sync
    save_resp = client.get_balance()
    if save_resp["status"] == 200:
        balance_after = extract_balance(save_resp)
        if balance_after is not None:
            logger.info(f"   Balance after: {format_amount(balance_after)} ({balance_after:,})")
        else:
            logger.warning("   ⚠️ Could not extract balance from post-transfer response")
    else:
        logger.warning(f"   ⚠️ Balance check failed: status {save_resp['status']}")

    # ── Summary ──
    logger.info("")
    logger.info("=" * 60)
    logger.info("  TRANSFER TEST SUMMARY")
    logger.info("=" * 60)
    logger.info(f"  Mode:              {mode.upper()}")
    logger.info(f"  Target amount:     {format_amount(amount)}")
    logger.info(f"  Actually sent:     {format_amount(total_sent)}")
    logger.info(f"  Transactions:      {completed}/{num_txs}")
    if balance_before is not None:
        logger.info(f"  Balance before:    {format_amount(balance_before)}")
    if balance_after is not None:
        logger.info(f"  Balance after:     {format_amount(balance_after)}")
    if balance_before is not None and balance_after is not None:
        delta = balance_before - balance_after
        logger.info(f"  Balance delta:     -{format_amount(delta)}")
        if delta == total_sent:
            logger.info("  ✅ VERIFIED: Balance delta matches amount sent!")
        elif delta > 0:
            logger.warning(f"  ⚠️ Delta ({format_amount(delta)}) differs from sent ({format_amount(total_sent)})")
        else:
            logger.warning("  ⚠️ Balance did not decrease as expected")
    logger.info(f"  Log file:          {LOG_FILE}")
    logger.info("=" * 60)

    return completed == num_txs


# ─── CLI ─────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="LagosLife Balance-Modification Test",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python money.py --dry-run --from milespete --to blaqsebastian --amount 1000
  python money.py --live --from milespete --to 7785cae4f157450490d5 --amount 10000000000
  python money.py --mock --amount 5000000000

Amount shorthand:
  1000        = ₦1,000
  1000000000  = ₦1B
  You can also use: 100b, 1t, 500m (case-insensitive)
        """
    )

    mode_group = parser.add_mutually_exclusive_group(required=True)
    mode_group.add_argument("--dry-run", action="store_true",
                            help="Show what would happen without sending")
    mode_group.add_argument("--live", action="store_true",
                            help="Execute real transfers against LagosLife API")
    mode_group.add_argument("--mock", action="store_true",
                            help="Run against a local mock server")

    parser.add_argument("--from", dest="sender", default="milespete",
                        help="Sender account name/user (default: milespete)")
    parser.add_argument("--to", dest="recipient", default="blaqsebastian",
                        help="Recipient username, UID, or chat URL")
    parser.add_argument("--amount", type=str, default="1000",
                        help="Amount to send (supports shorthand: 100b, 1t, etc)")

    args = parser.parse_args()

    # Parse amount with shorthand support
    amount_str = args.amount.strip().lower().replace(",", "").replace("₦", "")
    import re
    shorthand = re.match(r'^([\d.]+)\s*([btmk]?)$', amount_str)
    if shorthand:
        num = float(shorthand.group(1))
        suffix = shorthand.group(2)
        multipliers = {"k": 1_000, "m": 1_000_000, "b": 1_000_000_000, "t": 1_000_000_000_000, "": 1}
        amount = int(num * multipliers.get(suffix, 1))
    else:
        try:
            amount = int(amount_str)
        except ValueError:
            logger.error(f"Invalid amount: {args.amount}")
            sys.exit(1)

    if amount <= 0:
        logger.error("Amount must be positive")
        sys.exit(1)

    # Determine mode
    if args.dry_run:
        mode = "dry-run"
    elif args.mock:
        mode = "mock"
    else:
        mode = "live"

    # Load accounts
    accounts = load_accounts()
    sender_account = None
    base_url = API_BASE

    if mode == "mock":
        # Start mock server
        _server, base_url = start_mock_server()
        sender_account = {"name": "MockSender", "cookie": "mock-session-token", "user": "mock"}
        recipient_id = resolve_recipient(args.recipient)
        time.sleep(0.5)  # Let server start
    else:
        # Find sender account
        sender_account = find_account(args.sender, accounts)
        if not sender_account and mode == "live":
            logger.error(f"❌ Sender account '{args.sender}' not found in {ACCOUNTS_FILE}")
            logger.info(f"   Available accounts: {[a.get('name', a.get('id')) for a in accounts]}")
            sys.exit(1)
        recipient_id = resolve_recipient(args.recipient)

    logger.info(f"Resolved recipient: {args.recipient} → {recipient_id}")

    success = run_test(
        mode=mode,
        sender_account=sender_account,
        recipient_id=recipient_id,
        amount=amount,
        base_url=base_url
    )

    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
