import urllib.request
import urllib.error
import http.cookiejar
import json
import time

BASE_URL = "https://lagoslife.app/api"
HEADERS = {
    "Accept": "application/json",
    "Content-Type": "application/json",
    "Origin": "https://lagoslife.app",
    "Referer": "https://lagoslife.app/",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
}

def get_cash_for_session(opener):
    req = urllib.request.Request(f"{BASE_URL}/save", headers=HEADERS, method="GET")
    try:
        with opener.open(req, timeout=15) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            snap = data.get("snap", {})
            cash = snap.get("cash") or snap.get("money") or data.get("cash") or data.get("money")
            return cash, data
    except Exception as e:
        return None, str(e)

def login(opener, username, password):
    login_data = json.dumps({"username": username, "password": password}).encode("utf-8")
    req = urllib.request.Request(f"{BASE_URL}/auth/login", data=login_data, headers=HEADERS, method="POST")
    with opener.open(req, timeout=15) as resp:
        return json.loads(resp.read().decode("utf-8"))

def logout(opener):
    req = urllib.request.Request(f"{BASE_URL}/auth/logout", data=b"{}", headers=HEADERS, method="POST")
    with opener.open(req, timeout=15) as resp:
        return json.loads(resp.read().decode("utf-8"))

print("=== CHECKING PRINCE DAVID BALANCE ACROSS LOGIN CYCLES ===")

# Cycle 1
cj1 = http.cookiejar.CookieJar()
opener1 = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj1))
login(opener1, "princedavid", "Oladelel")
cash1, data1 = get_cash_for_session(opener1)
print(f"Cycle 1 Cash: {cash1:,} (₦{cash1 / 1e12:.4f}T)" if isinstance(cash1, (int, float)) else f"Cycle 1 Cash: {cash1}")
logout(opener1)

time.sleep(2)

# Cycle 2
cj2 = http.cookiejar.CookieJar()
opener2 = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj2))
login(opener2, "princedavid", "Oladelel")
cash2, data2 = get_cash_for_session(opener2)
print(f"Cycle 2 Cash: {cash2:,} (₦{cash2 / 1e12:.4f}T)" if isinstance(cash2, (int, float)) else f"Cycle 2 Cash: {cash2}")
logout(opener2)

if isinstance(cash1, (int, float)) and isinstance(cash2, (int, float)):
    diff = cash2 - cash1
    print(f"\nDifference: {diff:,} (₦{diff / 1e12:.4f}T)")
    if diff == 1_000_000_000_000:
        print("🚨 CONFIRMED! Balance increased by EXACTLY +1 TRILLION on login!")
    elif diff > 0:
        print(f"💰 Balance increased by {diff:,}!")
    else:
        print(f"ℹ️ Balance did not change between these API login cycles.")
