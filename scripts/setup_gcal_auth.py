#!/usr/bin/env python3
"""
setup_gcal_auth.py — Setup Google Calendar OAuth authorization for TREK.

Obtains a permanent Google Calendar refresh token for syyangv@gmail.com,
updates .env, verifies the connection, and optionally syncs upcoming
reservations from data/travel.db to Google Calendar.
"""

import sys
import os
import re
import json
import urllib.parse
import urllib.request
import webbrowser
from http.server import HTTPServer, BaseHTTPRequestHandler
import sqlite3
import datetime

DEFAULT_CALENDAR_ID = "primary"
DEFAULT_PORT = 8085
SCOPES = "https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/calendar.events"

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENV_FILE = os.path.join(REPO_ROOT, ".env")
DB_FILE = os.path.join(REPO_ROOT, "data", "travel.db")

auth_code = None

class OAuthCallbackHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        global auth_code
        parsed = urllib.parse.urlparse(self.path)
        params = urllib.parse.parse_qs(parsed.query)

        if "code" in params:
            auth_code = params["code"][0]
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers()
            self.wfile.write(b"""
                <html>
                <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; text-align: center; padding: 50px;">
                    <h2 style="color: #16a34a;">Google Calendar Authorized!</h2>
                    <p style="color: #4b5563; font-size: 16px;">You can now close this tab and return to the terminal.</p>
                </body>
                </html>
            """)
        else:
            err = params.get("error", ["Unknown error"])[0]
            self.send_response(400)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers()
            self.wfile.write(f"""
                <html>
                <body style="font-family: sans-serif; text-align: center; padding: 50px;">
                    <h2 style="color: #dc2626;">Authorization Failed</h2>
                    <p>{err}</p>
                </body>
                </html>
            """.encode("utf-8"))

    def log_message(self, format, *args):
        pass  # Suppress default HTTP logging


def load_env() -> dict[str, str]:
    env = {}
    if os.path.exists(ENV_FILE):
        with open(ENV_FILE, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if "=" in line and not line.startswith("#"):
                    k, v = line.split("=", 1)
                    env[k.strip()] = v.strip()
    return env


def update_env_file(updates: dict[str, str]):
    if not os.path.exists(ENV_FILE):
        lines = []
    else:
        with open(ENV_FILE, "r", encoding="utf-8") as f:
            lines = f.readlines()

    existing_keys = set()
    new_lines = []
    for line in lines:
        matched = False
        for k, v in updates.items():
            if re.match(rf"^{k}\s*=", line):
                new_lines.append(f"{k}={v}\n")
                existing_keys.add(k)
                matched = True
                break
        if not matched:
            new_lines.append(line)

    for k, v in updates.items():
        if k not in existing_keys:
            if new_lines and not new_lines[-1].endswith("\n"):
                new_lines.append("\n")
            new_lines.append(f"{k}={v}\n")

    with open(ENV_FILE, "w", encoding="utf-8") as f:
        f.writelines(new_lines)
    print(f"✓ Updated {ENV_FILE}")


def exchange_code_for_tokens(client_id: str, client_secret: str, code: str, redirect_uri: str) -> dict:
    data = urllib.parse.urlencode({
        "client_id": client_id,
        "client_secret": client_secret,
        "code": code,
        "grant_type": "authorization_code",
        "redirect_uri": redirect_uri,
    }).encode("utf-8")

    req = urllib.request.Request("https://oauth2.googleapis.com/token", data=data, method="POST")
    req.add_header("Content-Type", "application/x-www-form-urlencoded")
    with urllib.request.urlopen(req, timeout=15) as res:
        return json.loads(res.read().decode("utf-8"))


def test_calendar_connection(access_token: str, calendar_id: str) -> dict:
    url = f"https://www.googleapis.com/calendar/v3/calendars/{urllib.parse.quote(calendar_id)}/events?maxResults=1"
    req = urllib.request.Request(url, method="GET")
    req.add_header("Authorization", f"Bearer {access_token}")
    with urllib.request.urlopen(req, timeout=15) as res:
        return json.loads(res.read().decode("utf-8"))


def sync_upcoming_reservations_direct(access_token: str, calendar_id: str):
    if not os.path.exists(DB_FILE):
        print(f"! Database file {DB_FILE} not found; skipping direct DB sync.")
        return

    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    rows = cursor.execute("""
        SELECT r.*,
               p.name as place_name, p.address as place_address, p.lat as place_lat, p.lng as place_lng,
               t.title as trip_title
        FROM reservations r
        LEFT JOIN places p ON r.place_id = p.id
        JOIN trips t ON r.trip_id = t.id
        WHERE t.is_archived = 0
          AND (
            r.reservation_time >= date('now', '-1 day')
            OR r.reservation_end_time >= date('now', '-1 day')
            OR t.end_date >= date('now', '-1 day')
            OR t.end_date IS NULL
          )
        ORDER BY r.reservation_time ASC, r.id ASC
    """).fetchall()

    if not rows:
        print("ℹ No upcoming reservations found in travel.db.")
        conn.close()
        return

    print(f"\nFound {len(rows)} upcoming reservation(s) in TREK:")
    TYPE_EMOJIS = {
        "flight": "✈️", "hotel": "🏨", "lodging": "🏨",
        "restaurant": "🍽️", "dining": "🍽️", "car": "🚗",
        "rental": "🚗", "transit": "🚆", "train": "🚆",
        "activity": "🎟️", "medical": "🏥",
    }

    synced = 0
    for r in rows:
        r_id = r["id"]
        res_type = (r["type"] or "other").lower()
        emoji = TYPE_EMOJIS.get(res_type, "📅")
        summary = r["title"] if r["title"].startswith(emoji) else f"{emoji} {r['title']}"

        # Load endpoints if flight/transit
        endpoints = cursor.execute(
            "SELECT * FROM reservation_endpoints WHERE reservation_id = ? ORDER BY sequence ASC",
            (r_id,)
        ).fetchall()

        # Load accommodation if hotel
        stay = None
        if r["accommodation_id"]:
            stay = cursor.execute("""
                SELECT a.*, sd.date as start_date, ed.date as end_date
                FROM day_accommodations a
                LEFT JOIN days sd ON a.start_day_id = sd.id
                LEFT JOIN days ed ON a.end_day_id = ed.id
                WHERE a.id = ?
            """, (r["accommodation_id"],)).fetchone()

        place_lat = r["place_lat"]
        place_lng = r["place_lng"]
        place_address = r["place_address"]
        place_name = r["place_name"]

        if (not place_lat or not place_lng) and r["trip_id"]:
            matched = cursor.execute(
                "SELECT name, lat, lng, address FROM places WHERE trip_id = ? AND name = ? AND lat IS NOT NULL LIMIT 1",
                (r["trip_id"], r["title"])
            ).fetchone()
            if matched:
                if not place_lat: place_lat = matched["lat"]
                if not place_lng: place_lng = matched["lng"]
                if not place_address: place_address = matched["address"]
                if not place_name: place_name = matched["name"]

        trip_place_tz = None
        if r["trip_id"]:
            trip_place = cursor.execute(
                "SELECT lat, lng FROM places WHERE trip_id = ? AND lat IS NOT NULL LIMIT 1",
                (r["trip_id"],)
            ).fetchone()
            if trip_place and trip_place["lng"] and trip_place["lng"] < -100:
                trip_place_tz = "America/Los_Angeles"

        start = {}
        end = {}
        default_tz = trip_place_tz or "America/New_York"

        if endpoints:
            first = endpoints[0]
            last = endpoints[-1]
            if first["local_date"] and first["local_time"]:
                start_tz = first["timezone"] or default_tz
                end_tz = last["timezone"] or start_tz if last != first else start_tz
                start = {"dateTime": f"{first['local_date']}T{first['local_time']}:00", "timeZone": start_tz}
                if last != first and last["local_date"] and last["local_time"]:
                    end = {"dateTime": f"{last['local_date']}T{last['local_time']}:00", "timeZone": end_tz}
                elif r["reservation_end_time"]:
                    end = {"dateTime": f"{r['reservation_end_time']}:00" if "T" in r["reservation_end_time"] else r["reservation_end_time"], "timeZone": start_tz}
                else:
                    end = {"dateTime": f"{first['local_date']}T{first['local_time']}:00", "timeZone": start_tz}

        if not start and stay and stay["start_date"]:
            if stay["check_in"] and stay["check_out"] and stay["end_date"]:
                start = {"dateTime": f"{stay['start_date']}T{stay['check_in']}:00", "timeZone": default_tz}
                end = {"dateTime": f"{stay['end_date']}T{stay['check_out']}:00", "timeZone": default_tz}
            else:
                start = {"date": stay["start_date"]}
                end_d = stay["end_date"] or stay["start_date"]
                # Add 1 day
                d_obj = datetime.date.fromisoformat(end_d) + datetime.timedelta(days=1)
                end = {"date": d_obj.isoformat()}

        if not start and r["reservation_time"]:
            r_time = r["reservation_time"]
            if "T" in r_time:
                start_iso = f"{r_time}:00" if len(r_time.split("T")[1].split(":")) == 2 else r_time
                start = {"dateTime": start_iso, "timeZone": default_tz}
                if r["reservation_end_time"] and "T" in r["reservation_end_time"]:
                    end_iso = f"{r['reservation_end_time']}:00" if len(r['reservation_end_time'].split("T")[1].split(":")) == 2 else r['reservation_end_time']
                    end = {"dateTime": end_iso, "timeZone": default_tz}
                else:
                    # +1 hour
                    dt_obj = datetime.datetime.fromisoformat(start_iso) + datetime.timedelta(hours=1)
                    end = {"dateTime": dt_obj.strftime("%Y-%m-%dT%H:%M:%S"), "timeZone": default_tz}
            else:
                start = {"date": r_time}
                end_d = r["reservation_end_time"] if (r["reservation_end_time"] and r["reservation_end_time"] >= r_time) else r_time
                d_obj = datetime.date.fromisoformat(end_d) + datetime.timedelta(days=1)
                end = {"date": d_obj.isoformat()}

        if not start or not end:
            print(f"  ⚠ Skipping reservation #{r_id} ({r['title']}): no valid date/time found")
            continue

        desc_parts = []
        if r["confirmation_number"]:
            desc_parts.append(f"Confirmation: {r['confirmation_number']}")
        if r["status"]:
            desc_parts.append(f"Status: {r['status']}")
        if r["notes"]:
            desc_parts.append(f"\nNotes:\n{r['notes']}")
        desc_parts.append(f"\nTrip: {r['trip_title']} (TREK ID: {r['trip_id']})")
        desc_parts.append(f"TREK Reservation ID: {r_id}")

        event_payload = {
            "summary": summary,
            "location": r["location"] or place_address or place_name or "",
            "description": "\n".join(desc_parts),
            "start": start,
            "end": end,
            "extendedProperties": {
                "private": {
                    "trekReservationId": str(r_id),
                    "trekTripId": str(r["trip_id"]),
                }
            }
        }

        # Parse metadata
        meta = {}
        if r["metadata"]:
            try:
                meta = json.loads(r["metadata"])
            except Exception:
                meta = {}

        existing_event_id = meta.get("gcal_event_id")
        method = "PATCH" if existing_event_id else "POST"
        url = (
            f"https://www.googleapis.com/calendar/v3/calendars/{urllib.parse.quote(calendar_id)}/events/{urllib.parse.quote(existing_event_id)}"
            if existing_event_id
            else f"https://www.googleapis.com/calendar/v3/calendars/{urllib.parse.quote(calendar_id)}/events"
        )

        try:
            req = urllib.request.Request(url, data=json.dumps(event_payload).encode("utf-8"), method=method)
            req.add_header("Authorization", f"Bearer {access_token}")
            req.add_header("Content-Type", "application/json")
            with urllib.request.urlopen(req, timeout=15) as resp:
                resp_data = json.loads(resp.read().decode("utf-8"))
                new_event_id = resp_data.get("id")

                meta["gcal_event_id"] = new_event_id
                meta["gcal_synced_at"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
                cursor.execute("UPDATE reservations SET metadata = ? WHERE id = ?", (json.dumps(meta), r_id))
                conn.commit()
                synced += 1
                print(f"  ✓ Synced #{r_id} {summary} -> Google Calendar event {new_event_id}")
        except urllib.error.HTTPError as e:
            if e.code == 404 and existing_event_id:
                # Recreate
                post_url = f"https://www.googleapis.com/calendar/v3/calendars/{urllib.parse.quote(calendar_id)}/events"
                req = urllib.request.Request(post_url, data=json.dumps(event_payload).encode("utf-8"), method="POST")
                req.add_header("Authorization", f"Bearer {access_token}")
                req.add_header("Content-Type", "application/json")
                with urllib.request.urlopen(req, timeout=15) as resp:
                    resp_data = json.loads(resp.read().decode("utf-8"))
                    new_event_id = resp_data.get("id")
                    meta["gcal_event_id"] = new_event_id
                    meta["gcal_synced_at"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
                    cursor.execute("UPDATE reservations SET metadata = ? WHERE id = ?", (json.dumps(meta), r_id))
                    conn.commit()
                    synced += 1
                    print(f"  ✓ Re-created #{r_id} {summary} -> Google Calendar event {new_event_id}")
            else:
                print(f"  ✗ Failed to sync #{r_id} ({summary}): HTTP {e.code} {e.read().decode('utf-8')}")
        except Exception as ex:
            print(f"  ✗ Failed to sync #{r_id} ({summary}): {ex}")

    conn.close()
    print(f"\n✓ Successfully synced {synced}/{len(rows)} reservation(s) to Google Calendar!")


def main():
    env = load_env()
    client_id = os.environ.get("GOOGLE_CALENDAR_CLIENT_ID") or env.get("GOOGLE_CALENDAR_CLIENT_ID")
    client_secret = os.environ.get("GOOGLE_CALENDAR_CLIENT_SECRET") or env.get("GOOGLE_CALENDAR_CLIENT_SECRET")
    calendar_id = os.environ.get("GOOGLE_CALENDAR_ID") or env.get("GOOGLE_CALENDAR_ID") or DEFAULT_CALENDAR_ID
    port = DEFAULT_PORT
    redirect_uri = f"http://localhost:{port}"

    if not client_id:
        client_id = input("Enter Google OAuth Client ID: ").strip()
    if not client_secret:
        client_secret = input("Enter Google OAuth Client Secret: ").strip()

    if not client_id or not client_secret:
        print("✗ Error: GOOGLE_CALENDAR_CLIENT_ID and GOOGLE_CALENDAR_CLIENT_SECRET are required.")
        print("Please configure them in .env or provide via environment variables.")
        sys.exit(1)

    print("=" * 65)
    print(" TREK -> Google Calendar OAuth Authorization Setup")
    print("=" * 65)
    print(f"Target Account: syyangv@gmail.com")
    print(f"Calendar:       {calendar_id}")
    print(f"OAuth Client:   {client_id[:20]}...")
    print("=" * 65)

    params = {
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": SCOPES,
        "access_type": "offline",
        "prompt": "consent",
        "login_hint": "syyangv@gmail.com",
    }
    auth_url = f"https://accounts.google.com/o/oauth2/v2/auth?{urllib.parse.urlencode(params)}"

    print("\nPlease authorize Google Calendar access in your browser.")
    print("If your browser doesn't open automatically, visit this URL:")
    print(f"\n  {auth_url}\n")

    server = HTTPServer(("127.0.0.1", port), OAuthCallbackHandler)
    print(f"Waiting for authorization on {redirect_uri} ...")

    try:
        webbrowser.open(auth_url)
    except Exception:
        pass

    while auth_code is None:
        server.handle_request()

    server.server_close()
    print("✓ Authorization code received from Google!")

    tokens = exchange_code_for_tokens(client_id, client_secret, auth_code, redirect_uri)
    refresh_token = tokens.get("refresh_token")
    access_token = tokens.get("access_token")

    if not refresh_token:
        print("✗ Error: Google did not return a refresh token.")
        print("Tip: Go to https://myaccount.google.com/permissions, remove access for this app, and try again.")
        sys.exit(1)

    print("✓ Successfully obtained permanent Google OAuth refresh token.")

    # Update .env immediately
    update_env_file({
        "GOOGLE_CALENDAR_CLIENT_ID": client_id,
        "GOOGLE_CALENDAR_CLIENT_SECRET": client_secret,
        "GOOGLE_CALENDAR_REFRESH_TOKEN": refresh_token,
        "GOOGLE_CALENDAR_ID": calendar_id,
        "GOOGLE_CALENDAR_SYNC_ENABLED": "true",
    })

    # Validate
    try:
        cal_info = test_calendar_connection(access_token, calendar_id)
        cal_name = cal_info.get("summary", calendar_id)
        print(f"✓ Verified Google Calendar connection: '{cal_name}'")
    except Exception as e:
        print(f"ℹ Calendar connection check: {e}")

    # Sync upcoming reservations
    sync_upcoming_reservations_direct(access_token, calendar_id)

    print("\n🎉 Google Calendar integration setup is complete!")
    print("All future reservations created, modified, or removed in TREK will be automatically synced.")


if __name__ == "__main__":
    main()
