import urllib.request
import urllib.error
import http.cookiejar
import json

BASE_URL = "https://lagoslife.app/api"
HEADERS = {
    "Accept": "application/json",
    "Content-Type": "application/json",
    "Origin": "https://lagoslife.app",
    "Referer": "https://lagoslife.app/",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36"
}

cj = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))

# 1. Login
login_data = json.dumps({"username": "princedavid", "password": "Oladelel"}).encode("utf-8")
req = urllib.request.Request(f"{BASE_URL}/auth/login", data=login_data, headers=HEADERS, method="POST")
with opener.open(req) as resp:
    print("Login:", resp.getcode())

cookie_dict = {c.name: c.value for c in cj}
cookie_str = "; ".join([f"{c.name}={c.value}" for c in cj])
print("Fresh Cookie String:\n", cookie_str)

# 2. Read messages with 07bcd8554ae245a385ff
req2 = urllib.request.Request(f"{BASE_URL}/messages?with=07bcd8554ae245a385ff", headers=HEADERS, method="GET")
try:
    with opener.open(req2) as resp:
        print("Messages status:", resp.getcode())
        data = json.loads(resp.read().decode("utf-8"))
        print("Messages:", json.dumps(data, indent=2))
except Exception as e:
    print("Messages failed:", e)

# 3. Check save for PrinceDavid money
req3 = urllib.request.Request(f"{BASE_URL}/save", headers=HEADERS, method="GET")
try:
    with opener.open(req3) as resp:
        save_data = json.loads(resp.read().decode("utf-8"))
        money = save_data.get("game", {}).get("money")
        print("PrinceDavid money:", f"{money:,}" if money else "N/A")
except Exception as e:
    print("Save failed:", e)
