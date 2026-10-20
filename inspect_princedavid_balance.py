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

def test_login_balance():
    cj = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))

    # 1. Login
    login_data = json.dumps({"username": "princedavid", "password": "Oladelel"}).encode("utf-8")
    req = urllib.request.Request(f"{BASE_URL}/auth/login", data=login_data, headers=HEADERS, method="POST")
    
    with opener.open(req, timeout=15) as resp:
        login_res = json.loads(resp.read().decode("utf-8"))
        print("Login response:", json.dumps(login_res, indent=2))

    # 2. Check /api/auth/me or user info
    try:
        me_req = urllib.request.Request(f"{BASE_URL}/auth/me", headers=HEADERS, method="GET")
        with opener.open(me_req, timeout=15) as resp:
            me_res = json.loads(resp.read().decode("utf-8"))
            print("Me response:", json.dumps(me_res, indent=2))
    except Exception as e:
        print("Failed to get /auth/me:", e)

    # 3. Check /api/wallet
    try:
        w_req = urllib.request.Request(f"{BASE_URL}/wallet", headers=HEADERS, method="GET")
        with opener.open(w_req, timeout=15) as resp:
            w_res = json.loads(resp.read().decode("utf-8"))
            print("Wallet response:", json.dumps(w_res, indent=2))
    except Exception as e:
        print("Failed to get /wallet:", e)

test_login_balance()
