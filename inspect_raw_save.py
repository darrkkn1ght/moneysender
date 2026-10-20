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
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
}

cj = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))

login_data = json.dumps({"username": "princedavid", "password": "Oladelel"}).encode("utf-8")
req = urllib.request.Request(f"{BASE_URL}/auth/login", data=login_data, headers=HEADERS, method="POST")
with opener.open(req) as resp:
    print("Login:", resp.getcode())

req2 = urllib.request.Request(f"{BASE_URL}/save", headers=HEADERS, method="GET")
try:
    with opener.open(req2) as resp:
        print("Save response status:", resp.getcode())
        data = json.loads(resp.read().decode("utf-8"))
        print("Keys:", list(data.keys()))
        if "snap" in data:
            print("Snap keys:", list(data["snap"].keys()) if isinstance(data["snap"], dict) else type(data["snap"]))
            print("Snap content sample:", str(data["snap"])[:500])
        else:
            print("Full data sample:", str(data)[:500])
except Exception as e:
    print("Save failed:", e)
