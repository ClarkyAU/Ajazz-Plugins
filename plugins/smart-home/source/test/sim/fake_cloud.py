#!/usr/bin/env python3
"""
Fake Tuya cloud for tests. Checks every request's signature with Tuya's own
tuya-connector-python signing code, and answers with a small device list.

  python3 fake_cloud.py <port> <access_id> <access_secret> <devices.json>

Prints one JSON line per request: {"path":..,"sign_ok":true,...}
"""
import hashlib
import hmac
import json
import sys
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse, parse_qsl

from tuya_connector import TuyaOpenAPI

PORT, ACCESS_ID, SECRET, DEVFILE = int(sys.argv[1]), sys.argv[2], sys.argv[3], sys.argv[4]
DEVICES = json.load(open(DEVFILE))
TOKEN = "faketoken123456"
UID = "ay1234567890abcdef"
api = TuyaOpenAPI("http://unused", ACCESS_ID, SECRET)


class TokenInfo:
    access_token = TOKEN


def expected_sign(method, path, params, raw_body, t, with_token):
    if raw_body:
        # tuya_connector re-serialises dict bodies; for POSTs follow Tuya's
        # documented algorithm on the raw body bytes instead.
        s = method + "\n" + hashlib.sha256(raw_body).hexdigest() + "\n\n" + path
        if params:
            s += "?" + "&".join(f"{k}={params[k]}" for k in sorted(params))
        msg = ACCESS_ID + (TOKEN if with_token else "") + t + s
        return hmac.new(SECRET.encode(), msg.encode(), hashlib.sha256).hexdigest().upper()
    api.token_info = TokenInfo() if with_token else None
    real_time = time.time
    time.time = lambda: int(t) / 1000
    try:
        sign, _ = api._calculate_sign(method, path, params or None, None)
    finally:
        time.time = real_time
    return sign


def out(obj):
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def reply(self, obj):
        data = json.dumps(obj).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def handle_any(self, method):
        u = urlparse(self.path)
        params = dict(parse_qsl(u.query, keep_blank_values=True))
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b""
        t = self.headers.get("t", "")
        with_token = bool(self.headers.get("access_token"))
        want = expected_sign(method, u.path, params, raw, t, with_token)
        ok = (self.headers.get("sign") == want and self.headers.get("client_id") == ACCESS_ID
              and self.headers.get("sign_method") == "HMAC-SHA256")
        out({"method": method, "path": u.path, "params": params, "sign_ok": ok,
             "body": raw.decode() if raw else None})
        if not ok:
            return self.reply({"success": False, "code": 1004, "msg": "sign invalid", "t": int(time.time() * 1000)})
        p = u.path
        if p == "/v1.0/token":
            return self.reply({"success": True, "t": 0, "result": {"access_token": TOKEN, "expire_time": 7200, "uid": "bay1", "refresh_token": "r"}})
        if with_token and self.headers.get("access_token") != TOKEN:
            return self.reply({"success": False, "code": 1010, "msg": "token invalid"})
        if p == "/v1.0/iot-01/associated-users/devices":
            devs = []
            for d in DEVICES:
                item = {k: v for k, v in d.items() if k not in ("dps", "spec", "hide_key")}
                if d.get("hide_key"):
                    item.pop("local_key", None)
                item["uid"] = UID
                devs.append(item)
            return self.reply({"success": True, "result": {"devices": devs, "has_more": False, "last_row_key": ""}})
        if p == "/v1.3/iot-03/devices":
            lst = [{k: v for k, v in d.items() if k not in ("dps", "spec", "hide_key")} for d in DEVICES]
            return self.reply({"success": True, "result": {"list": lst, "has_more": False}})
        for d in DEVICES:
            if p == f"/v1.1/devices/{d['id']}/specifications":
                return self.reply({"success": True, "result": d.get("spec", {"status": [], "functions": []})})
            if p == f"/v1.0/iot-03/devices/{d['id']}/status":
                return self.reply({"success": True, "result": [{"code": k, "value": v} for k, v in d.get("cloud_status", {}).items()]})
            if p == f"/v1.0/iot-03/devices/{d['id']}/commands":
                return self.reply({"success": True, "result": True})
            if p == f"/v1.0/devices/{d['id']}":
                return self.reply({"success": True, "result": {"id": d["id"], "local_key": d.get("local_key")}})
        return self.reply({"success": False, "code": 1108, "msg": "uri path invalid"})

    def do_GET(self):
        self.handle_any("GET")

    def do_POST(self):
        self.handle_any("POST")


HTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
