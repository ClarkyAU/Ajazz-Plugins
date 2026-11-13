#!/usr/bin/env python3
"""
Simulated Tuya Wi-Fi devices for testing, built on tinytuya's own message
packing and encryption (so the plugin is checked against an independent
implementation, not against itself).

Each device listens on <ip>:6668 (use different 127.0.0.x addresses) and
sends the same UDP broadcasts real devices send.

  python3 tuya_sim.py devices.json

devices.json: [{"id": "...", "key": "16 chars", "ip": "127.0.0.11",
                "version": "3.3", "dps": {"1": false, "19": 1180},
                "kind": "plug"|"light"}]

Prints JSON lines on stdout: {"event":"control","id":..,"dps":{..}} so tests
can see what the plugin sent. Reads lines on stdin to change state, as if the
device was switched from Google Home: {"id": "...", "dps": {"1": true}}
"""
import hmac
import json
import os
import socket
import struct
import sys
import threading
import time
from hashlib import sha256

import tinytuya
from tinytuya.core import header as H
from tinytuya.core import command_types as CT
from tinytuya.core.message_helper import TuyaMessage, pack_message, unpack_message, parse_header
from tinytuya.core.crypto_helper import AESCipher
from tinytuya.core.udp_helper import udpkey

LOCK = threading.Lock()


def out(obj):
    with LOCK:
        sys.stdout.write(json.dumps(obj) + "\n")
        sys.stdout.flush()


class Device:
    def __init__(self, cfg):
        self.id = cfg["id"]
        self.key = cfg["key"].encode("latin1")
        self.ip = cfg.get("ip", "127.0.0.1")
        self.version = cfg.get("version", "3.3")
        self.dps = dict(cfg.get("dps", {"1": False}))
        self.kind = cfg.get("kind", "plug")
        self.port = cfg.get("port", 6668)
        self.clients = []
        self.seq = 100

    # ---------------------------------------------------------- framing
    def pack(self, conn, cmd, payload, retcode=0):
        """Build a device->client frame using tinytuya's pack_message."""
        v = self.version
        self.seq += 1
        if v == "3.5":
            key = conn["session"] or self.key
            msg = TuyaMessage(self.seq, cmd, retcode, payload, 0, True, H.PREFIX_6699_VALUE, True)
            return pack_message(msg, hmac_key=key)
        if v == "3.4":
            key = conn["session"] or self.key
            enc = AESCipher(key).encrypt(payload, use_base64=False, pad=True) if payload else b""
            body = struct.pack(">I", retcode) + enc
            msg = TuyaMessage(self.seq, cmd, retcode, body, 0, True, H.PREFIX_55AA_VALUE, False)
            return pack_message(msg, hmac_key=key)
        # 3.3: payload already contains header/encryption as needed
        body = struct.pack(">I", retcode) + payload
        msg = TuyaMessage(self.seq, cmd, retcode, body, 0, True, H.PREFIX_55AA_VALUE, False)
        return pack_message(msg)

    def json_payload(self, obj, with_header):
        raw = json.dumps(obj, separators=(",", ":")).encode()
        v = self.version
        if v == "3.3":
            enc = AESCipher(self.key).encrypt(raw, use_base64=False, pad=True)
            return (H.PROTOCOL_33_HEADER + enc) if with_header else enc
        hdr = H.PROTOCOL_34_HEADER if v == "3.4" else H.PROTOCOL_35_HEADER
        return (hdr + raw) if with_header else raw

    def decode_client(self, conn, data):
        """Unpack a client->device frame (no retcode), return (cmd, plaintext)."""
        v = self.version
        if v == "3.5":
            key = conn["session"] or self.key
            m = unpack_message(data, hmac_key=key, no_retcode=True)
            if not m.crc_good:
                raise ValueError("GCM tag check failed")
            p = m.payload
        elif v == "3.4":
            key = conn["session"] or self.key
            m = unpack_message(data, hmac_key=key, no_retcode=True)
            if not m.crc_good:
                raise ValueError("HMAC check failed")
            p = AESCipher(key).decrypt(m.payload, use_base64=False, decode_text=False, verify_padding=True)
        else:
            m = unpack_message(data, no_retcode=True)
            if not m.crc_good:
                raise ValueError("CRC check failed")
            p = m.payload
            if p.startswith(b"3.3"):
                p = p[15:]
            if p:
                p = AESCipher(self.key).decrypt(p, use_base64=False, decode_text=False, verify_padding=True)
        if p[:3] in (b"3.3", b"3.4", b"3.5"):
            p = p[15:]
        return m.cmd, p

    # ---------------------------------------------------------- behaviour
    def status_obj(self, dps):
        if self.version in ("3.4", "3.5"):
            return {"protocol": 4, "t": int(time.time()), "data": {"dps": dps}}
        return {"devId": self.id, "dps": dps, "t": int(time.time())}

    def push(self, dps):
        for conn in list(self.clients):
            if conn["ready"]:
                try:
                    conn["sock"].sendall(self.pack(conn, CT.STATUS, self.json_payload(self.status_obj(dps), True)))
                except OSError:
                    pass

    def handle(self, conn, data):
        v = self.version
        if v in ("3.4", "3.5") and not conn["ready"]:
            return self.negotiate(conn, data)
        cmd, p = self.decode_client(conn, data)
        sock = conn["sock"]
        if cmd == CT.HEART_BEAT:
            sock.sendall(self.pack(conn, CT.HEART_BEAT, b""))
            return
        if cmd in (CT.DP_QUERY, CT.DP_QUERY_NEW):
            out({"event": "query", "id": self.id, "cmd": cmd})
            if v == "3.3":
                reply = {"devId": self.id, "dps": self.dps}
            else:
                reply = {"dps": self.dps}
            sock.sendall(self.pack(conn, cmd, self.json_payload(reply, False)))
            return
        if cmd in (CT.CONTROL, CT.CONTROL_NEW):
            req = json.loads(p.decode())
            dps = req.get("dps") or (req.get("data") or {}).get("dps") or {}
            if v == "3.3" and cmd == CT.CONTROL_NEW and all(val is None for val in dps.values()):
                # device22-style status query
                sock.sendall(self.pack(conn, CT.CONTROL_NEW, self.json_payload({"devId": self.id, "dps": self.dps}, False)))
                return
            out({"event": "control", "id": self.id, "cmd": cmd, "dps": dps, "request": req})
            changed = {}
            for k, val in dps.items():
                self.dps[str(k)] = val
                changed[str(k)] = val
            sock.sendall(self.pack(conn, cmd, b""))
            self.push(changed)
            return
        out({"event": "unknown", "id": self.id, "cmd": cmd})

    def negotiate(self, conn, data):
        v = self.version
        sock = conn["sock"]
        cmd, p = None, None
        if v == "3.5":
            m = unpack_message(data, hmac_key=self.key, no_retcode=True)
            if not m.crc_good:
                out({"event": "neg_fail", "id": self.id, "why": "gcm"})
                return
            cmd, p = m.cmd, m.payload
        else:
            m = unpack_message(data, hmac_key=self.key, no_retcode=True)
            if not m.crc_good:
                out({"event": "neg_fail", "id": self.id, "why": "hmac"})
                return
            cmd = m.cmd
            p = AESCipher(self.key).decrypt(m.payload, use_base64=False, decode_text=False, verify_padding=True)
        if cmd == CT.SESS_KEY_NEG_START:
            conn["client_nonce"] = p[:16]
            conn["remote_nonce"] = os.urandom(16)
            body = conn["remote_nonce"] + hmac.new(self.key, conn["client_nonce"], sha256).digest()
            sock.sendall(self.pack(conn, CT.SESS_KEY_NEG_RESP, body))
        elif cmd == CT.SESS_KEY_NEG_FINISH:
            want = hmac.new(self.key, conn["remote_nonce"], sha256).digest()
            if p[:32] != want:
                out({"event": "neg_fail", "id": self.id, "why": "finish hmac"})
                return
            xor = bytes(a ^ b for a, b in zip(conn["client_nonce"], conn["remote_nonce"]))
            c = AESCipher(self.key)
            if v == "3.4":
                conn["session"] = c.encrypt(xor, False, pad=False)
            else:
                conn["session"] = c.encrypt(xor, use_base64=False, pad=False, iv=conn["client_nonce"][:12])[12:28]
            conn["ready"] = True
            out({"event": "session", "id": self.id, "version": v})

    def serve(self):
        srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        srv.bind((self.ip, self.port))
        srv.listen(4)
        out({"event": "listening", "id": self.id, "ip": self.ip, "port": self.port, "version": self.version})
        while True:
            s, _ = srv.accept()
            conn = {"sock": s, "session": None, "ready": self.version == "3.3"}
            self.clients.append(conn)
            out({"event": "connected", "id": self.id})
            threading.Thread(target=self.client_loop, args=(conn,), daemon=True).start()

    def client_loop(self, conn):
        s = conn["sock"]
        buf = b""
        try:
            while True:
                chunk = s.recv(4096)
                if not chunk:
                    break
                buf += chunk
                while len(buf) >= 16:
                    try:
                        hdr = parse_header(buf)
                    except Exception:
                        buf = buf[1:]
                        continue
                    if len(buf) < hdr.total_length:
                        break
                    frame, buf = buf[:hdr.total_length], buf[hdr.total_length:]
                    try:
                        self.handle(conn, frame)
                    except Exception as e:
                        out({"event": "error", "id": self.id, "error": repr(e)})
        except OSError:
            pass
        finally:
            if conn in self.clients:
                self.clients.remove(conn)
            out({"event": "disconnected", "id": self.id})
            s.close()

    # ---------------------------------------------------------- UDP
    def broadcast_packet(self):
        info = {"ip": self.ip, "gwId": self.id, "active": 2, "ablilty": 0, "encrypt": True,
                "productKey": "simproduct", "version": self.version}
        raw = json.dumps(info).encode()
        if self.version == "3.5":
            msg = TuyaMessage(0, CT.UDP_NEW, 0, raw, 0, True, H.PREFIX_6699_VALUE, True)
            return pack_message(msg, hmac_key=udpkey), 7000
        enc = AESCipher(udpkey).encrypt(raw, use_base64=False, pad=True)
        cmd = CT.BOARDCAST_LPV34 if self.version == "3.4" else CT.UDP_NEW
        msg = TuyaMessage(0, cmd, 0, struct.pack(">I", 0) + enc, 0, True, H.PREFIX_55AA_VALUE, False)
        return pack_message(msg), 6667


def broadcaster(devices, target):
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
    while True:
        for d in devices:
            if d.ip and not getattr(d, "silent", False):
                pkt, port = d.broadcast_packet()
                try:
                    s.sendto(pkt, (target, port))
                except OSError as e:
                    out({"event": "udp_error", "error": repr(e)})
        time.sleep(1.0)


def stdin_loop(devices):
    by_id = {d.id: d for d in devices}
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
            d = by_id[req["id"]]
            changed = {str(k): v for k, v in req["dps"].items()}
            d.dps.update(changed)
            d.push(changed)
            out({"event": "external", "id": d.id, "dps": changed})
        except Exception as e:
            out({"event": "error", "error": repr(e)})


def main():
    cfgs = json.load(open(sys.argv[1]))
    target = os.environ.get("SIM_UDP_TARGET", "127.0.0.1")
    devices = []
    for c in cfgs:
        d = Device(c)
        d.silent = bool(c.get("silent"))
        devices.append(d)
        threading.Thread(target=d.serve, daemon=True).start()
    threading.Thread(target=broadcaster, args=(devices, target), daemon=True).start()
    stdin_loop(devices)
    while True:  # stdin closed: keep the devices running
        time.sleep(3600)


if __name__ == "__main__":
    main()
