#!/usr/bin/env python3
"""
prince_david_login_logout.py — Automated Login/Logout Loop for Prince David
Uses Python standard library (urllib + http.cookiejar) with zero external dependencies.
"""

import sys
import time
import json
import urllib.request
import urllib.error
import http.cookiejar

BASE_URL = "https://lagoslife.app/api/auth"
USERNAME = "princedavid"

def cycle_login_logout(username, password, cycles=50, delay=2.0):
    print("=" * 60)
    print(f"🔄 LAGOSLIFE AUTOMATED LOGIN/LOGOUT LOOP")
    print(f"   Target Account: {username}")
    print(f"   Total Cycles:   {cycles}")
    print(f"   Interval Delay: {delay}s")
    print("=" * 60 + "\n")

    successful_cycles = 0

    for i in range(1, cycles + 1):
        # Create a clean cookie jar and opener for each cycle
        cookie_jar = http.cookiejar.CookieJar()
        opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cookie_jar))

        headers = {
            "Accept": "application/json",
            "Content-Type": "application/json",
            "Origin": "https://lagoslife.app",
            "Referer": "https://lagoslife.app/",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36"
        }

        # 1. Login
        login_data = json.dumps({
            "username": username,
            "password": password
        }).encode("utf-8")

        req = urllib.request.Request(f"{BASE_URL}/login", data=login_data, headers=headers, method="POST")

        try:
            print(f"[{i}/{cycles}] [{time.strftime('%X')}] Logging IN as {username}...")
            with opener.open(req, timeout=15) as resp:
                status = resp.getcode()
                body = resp.read().decode("utf-8")
                cookie_names = [c.name for c in cookie_jar]
                print(f"   ✅ Logged in successfully! (Status {status}, Cookies: {cookie_names})")
        except urllib.error.HTTPError as e:
            err_body = e.read().decode("utf-8", errors="ignore")
            print(f"   ❌ Login HTTP error {e.code}: {err_body}")
            time.sleep(delay)
            continue
        except Exception as e:
            print(f"   ⚠️ Network error logging in: {e}")
            time.sleep(delay)
            continue

        time.sleep(delay)

        # 2. Logout
        logout_req = urllib.request.Request(f"{BASE_URL}/logout", data=b"{}", headers=headers, method="POST")

        try:
            print(f"   [{time.strftime('%X')}] 🚪 Logging OUT...")
            with opener.open(logout_req, timeout=15) as resp:
                status = resp.getcode()
                print(f"   ✅ Logged out successfully! (Status {status})")
                successful_cycles += 1
        except urllib.error.HTTPError as e:
            err_body = e.read().decode("utf-8", errors="ignore")
            print(f"   ⚠️ Logout HTTP error {e.code}: {err_body}")
        except Exception as e:
            print(f"   ⚠️ Network error logging out: {e}")

        time.sleep(delay)

    print("\n" + "=" * 60)
    print(f"🎉 COMPLETED! Successfully cycled login/logout {successful_cycles}/{cycles} times.")
    print("=" * 60)

if __name__ == "__main__":
    pwd = sys.argv[1] if len(sys.argv) > 1 else "Oladelel"
    count = int(sys.argv[2]) if len(sys.argv) > 2 else 50
    interval = float(sys.argv[3]) if len(sys.argv) > 3 else 2.0

    cycle_login_logout(USERNAME, pwd, cycles=count, delay=interval)
