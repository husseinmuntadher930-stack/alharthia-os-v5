#!/usr/bin/env python3
"""
Alharthia OS — CamLink 2 (يشتغل على الراسبيري 4).

الراسبيري 4 + كاميرا الشريط (Camera Module 3 / NoIR) يصير «كاميرا» للراسبيري 5:
- الكاميرا تلتقط 640×480 على 120 صورة/ثانية (وضع الكاميرا السريع، الصورة كاملة).
- كل صورة تنضغط ضغط خفيف (JPEG رمادي، ~٢ms) وتنرسل للراسبيري 5 (كيبل USB-C أو Ethernet).
- ينرسل دائماً آخر صورة بس — إذا الطرف الثاني تأخر ما تتجمع صور قديمة.

CamLink 2 يضيف واجهة لمس (تطلع لمن توصل الراسبيري 4 بشاشة):
- معاينة الكاميرا حتى تضبط مكانها.
- شبكات الواي فاي والاتصال بيها.
- زر «البث»: يعطي الإنترنت والصورة للراسبيري 5 (عبر USB-C و Ethernet).

المنافذ:
  TCP 8766  — بث الصورة للراسبيري 5. العميل يدز بايت واحد:
                b'P' → يرجع b'ALHCAM1 640x480\\n' ويسكّر (فحص وجود)
                b'S' → بث: لكل صورة  <I length><d timestamp><B codec 0=jpeg 1=raw><H w><H h> + data
  HTTP 8767 — الواجهة (بس من الجهاز نفسه أو من الراسبيري 5)
"""
import argparse
import ipaddress
import json
import os
import re
import socket
import struct
import subprocess
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

VERSION = "2.0"
HDR = struct.Struct("<IdBHH")
W, H, FPS = 640, 480, 120
HERE = os.path.dirname(os.path.abspath(__file__))
STATE_FILE = os.environ.get("ALH_CAMLINK_STATE", "/var/lib/alharthia-camlink/state.json")
USB_CON = "alharthia-camlink"          # منفذ USB-C (شبكة 10.55.0.x)
ETH_CON = "alharthia-share-eth"        # منفذ Ethernet (شبكة 10.42.0.x)
ALLOWED = [ipaddress.ip_network(n) for n in ("127.0.0.0/8", "10.55.0.0/24", "10.42.0.0/24", "::1/128")]
FAKE = False


def log(*a):
    print("camlink:", *a, flush=True)


# ===================================================================== الكاميرا
class Camera:
    def __init__(self, raw=False, quality=75):
        self.raw, self.quality = raw, quality
        self.cam = None
        self.lock = threading.Condition()
        self.slock = threading.Lock()
        self.frame, self.seq = None, 0
        self.users = 0
        self.thread = None
        self.running = False
        self.err = ""
        self.fps = 0.0
        self.enc = self._encoder()
        if not raw and self.enc is None:
            self.raw = True

    def _encoder(self):
        try:
            import simplejpeg
            return lambda y: simplejpeg.encode_jpeg(y[:, :, None], quality=self.quality, colorspace="GRAY")
        except Exception:  # noqa
            try:
                import cv2
                return lambda y: cv2.imencode(".jpg", y, [cv2.IMWRITE_JPEG_QUALITY, self.quality])[1].tobytes()
            except Exception:  # noqa
                return None

    def start(self):
        if FAKE:
            self.cam = "fake"
        else:
            from picamera2 import Picamera2
            cam = Picamera2()
            kw = dict(main={"size": (W, H), "format": "YUV420"}, buffer_count=4,
                      controls={"FrameDurationLimits": (int(1e6 / FPS), int(1e6 / FPS))})
            try:   # وضع الكاميرا السريع (1536×864 على 120) — الصورة كاملة بدون قص
                cfg = cam.create_video_configuration(sensor={"output_size": (1536, 864)}, **kw)
            except TypeError:
                cfg = cam.create_video_configuration(**kw)
            cam.configure(cfg)
            cam.start()
            try:
                cam.set_controls({"AfMode": 2})
            except Exception:  # noqa
                pass
            self.cam = cam
        self.running = True
        self.thread = threading.Thread(target=self.loop, daemon=True)
        self.thread.start()
        log("camera started")

    def ensure(self):
        with self.slock:
            if self.running:
                return
            try:
                self.start()
                self.err = ""
            except Exception as e:  # noqa
                self.err = str(e)[:200] or "تعذر تشغيل الكاميرا"
                self.running = False
                log("camera failed:", e)

    def stop(self):
        with self.slock:
            self.running = False
            if self.thread:
                self.thread.join(timeout=2)
            if self.cam not in (None, "fake"):
                try:
                    self.cam.stop()
                    self.cam.close()
                except Exception:  # noqa
                    pass
            self.cam = None
            self.fps = 0.0
            log("camera stopped")

    def _grab(self):
        if self.cam == "fake":
            import numpy as np
            nxt = getattr(self, "_fnext", 0.0) + 1 / FPS          # نفس سرعة الكاميرا الحقيقية
            time.sleep(max(0.0, nxt - time.monotonic()))
            self._fnext = max(nxt, time.monotonic() - 0.05)
            if not hasattr(self, "_fbase"):
                self._fbase = np.fromfunction(lambda r, c: (r * 0.25 + c * 0.15) % 256, (H, W)).astype(np.uint8)
            y = self._fbase.copy()
            x = int((time.time() * 240) % (W - 80))
            y[180:300, x:x + 80] = 250
            y[::60, :] = 40
            return y
        return self.cam.capture_array("main")

    def loop(self):
        t0, n = time.monotonic(), 0
        while self.running:
            try:
                a = self._grab()
            except Exception as e:  # noqa
                self.err = "الكاميرا وقفت: %s" % e
                time.sleep(0.2)
                continue
            ts = time.time()
            y = a[:H, :W]
            if self.raw:
                data, codec = y.tobytes(), 1
            else:
                data, codec = self.enc(y), 0
            n += 1
            now = time.monotonic()
            if now - t0 >= 1:
                self.fps, t0, n = n / (now - t0), now, 0
            with self.lock:
                self.frame = HDR.pack(len(data), ts, codec, W, H) + data
                self.seq += 1
                self.lock.notify_all()

    def jpeg(self, frame):
        """صورة JPEG للمعاينة من نفس الإطار (بدون ضغط ثاني إذا الإطار أصلاً JPEG)."""
        n, _ts, codec, w, h = HDR.unpack_from(frame)
        data = frame[HDR.size:HDR.size + n]
        if codec == 0:
            return data
        enc = self.enc or self._encoder()
        if enc is None:
            return None
        import numpy as np
        return enc(np.frombuffer(data, np.uint8).reshape(h, w))

    def acquire(self):
        with self.lock:
            self.users += 1
        self.ensure()

    def release(self):
        with self.lock:
            self.users -= 1
            last = self.users <= 0
        if last:
            time.sleep(3)                          # إذا رجع بسرعة ما نطفي ونشغّل
            with self.lock:
                idle = self.users <= 0
            if idle and self.running:
                self.stop()

    def wait(self, seen, timeout=2.0):
        """ينتظر صورة أحدث من seen. يرجع (seq, frame) أو (seen, None)."""
        with self.lock:
            if self.seq == seen:
                self.lock.wait(timeout=timeout)
            if self.seq == seen:
                return seen, None
            return self.seq, self.frame


# ===================================================================== الشبكة (NetworkManager)
def nm(*args, timeout=20):
    if FAKE:
        return 0, ""
    try:
        p = subprocess.run(["nmcli", *args], capture_output=True, text=True, timeout=timeout)
        return p.returncode, ((p.stdout or "") + (p.stderr or "")).strip()
    except FileNotFoundError:
        return 127, "NetworkManager مو موجود بهذا النظام"
    except subprocess.TimeoutExpired:
        return 124, "انتهى الوقت"


def carrier(ifc):
    if FAKE:
        return ifc in FAKE_NET["links"]
    try:
        with open("/sys/class/net/%s/carrier" % ifc) as f:
            return f.read().strip() == "1"
    except OSError:
        return False


def _nm_get(field, con):
    rc, out = nm("-g", field, "connection", "show", con)
    return out.strip() if rc == 0 else None


def apply_net(on):
    """البث شغّال → الراسبيري 4 يشارك الإنترنت مالته عبر USB-C و Ethernet. مطفي → يرجع عادي."""
    if FAKE:
        return ""
    errs = []
    # USB-C: نفس العنوان 10.55.0.2، بس «shared» = توجيه + DNS للراسبيري 5
    meth = _nm_get("ipv4.method", USB_CON)
    if meth is not None:
        want = "shared" if on else "manual"
        if meth != want:
            nm("connection", "modify", USB_CON, "ipv4.method", want)
            if carrier("usb0"):
                rc, out = nm("connection", "up", USB_CON, timeout=30)
                if rc:
                    errs.append("USB-C: " + out[-140:])
    # Ethernet: الراسبيري 4 يصير 10.42.0.1 ويوزّع عنوان للراسبيري 5
    if os.path.exists("/sys/class/net/eth0"):
        if _nm_get("connection.id", ETH_CON) is None:
            nm("connection", "add", "type", "ethernet", "ifname", "eth0", "con-name", ETH_CON,
               "ipv4.method", "shared", "ipv6.method", "ignore",
               "connection.autoconnect", "no", "connection.autoconnect-priority", "100")
        nm("connection", "modify", ETH_CON, "connection.autoconnect", "yes" if on else "no")
        active = _nm_get("GENERAL.STATE", ETH_CON) == "activated"
        if on and carrier("eth0") and not active:
            rc, out = nm("connection", "up", ETH_CON, timeout=30)
            if rc:
                errs.append("Ethernet: " + out[-140:])
        elif not on and active:
            nm("connection", "down", ETH_CON)
    return " · ".join(errs)


class Share:
    def __init__(self):
        self.lock = threading.Lock()
        self.on = True
        self.err = ""
        try:
            with open(STATE_FILE, encoding="utf-8") as f:
                self.on = bool(json.load(f).get("cast", True))
        except (OSError, ValueError):
            pass

    def _save(self):
        try:
            os.makedirs(os.path.dirname(STATE_FILE), exist_ok=True)
            tmp = STATE_FILE + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump({"cast": self.on}, f)
            os.replace(tmp, STATE_FILE)
        except OSError as e:
            log("state save failed:", e)

    def set(self, on):
        with self.lock:
            self.on = bool(on)
            self._save()
            self.err = apply_net(self.on)
        return self.on

    def sync(self):
        """عند التشغيل: نتأكد إعدادات الشبكة مطابقة لحالة الزر."""
        time.sleep(4)
        with self.lock:
            self.err = apply_net(self.on)


def _split_t(line):
    return [x.replace("\\:", ":").replace("\\\\", "\\") for x in re.split(r"(?<!\\):", line)]


FAKE_NET = {"links": {"usb0"}, "active": "Alharthia-School", "nets": [
    ("Alharthia-School", 82, "WPA2"), ("Teachers-5G", 64, "WPA2 WPA3"), ("Library", 41, ""), ("Lab-2", 23, "WPA2")]}


def wifi_list(rescan=False):
    if FAKE:
        return [{"ssid": s, "signal": g, "secure": bool(c), "active": s == FAKE_NET["active"]} for s, g, c in FAKE_NET["nets"]]
    rc, out = nm("-t", "-f", "IN-USE,SSID,SIGNAL,SECURITY", "device", "wifi", "list",
                 "--rescan", "yes" if rescan else "no", timeout=25)
    nets = {}
    for line in out.splitlines() if rc == 0 else []:
        f = _split_t(line)
        if len(f) < 4 or not f[1]:
            continue
        cur, ssid = f[0].strip() == "*", f[1]
        try:
            sig = int(f[2] or 0)
        except ValueError:
            sig = 0
        e = nets.get(ssid)
        if e is None:
            nets[ssid] = e = {"ssid": ssid, "signal": sig, "secure": f[3] not in ("", "--"), "active": cur}
        e["signal"] = max(e["signal"], sig)
        e["active"] = e["active"] or cur
    return sorted(nets.values(), key=lambda n: (not n["active"], -n["signal"]))


def wifi_connect(ssid, psk):
    if FAKE:
        time.sleep(1.2)
        if psk.startswith("bad"):
            return False, "كلمة المرور غلط"
        FAKE_NET["active"] = ssid
        return True, ""
    existed = _nm_get("connection.id", ssid) is not None
    args = ["device", "wifi", "connect", ssid]
    if psk:
        args += ["password", psk]
    rc, out = nm(*args, timeout=45)
    if rc == 0:
        nm("connection", "modify", ssid, "connection.autoconnect", "yes")
        return True, ""
    if not existed:
        nm("connection", "delete", "id", ssid)
    low = out.lower()
    if "secrets were required" in low or "psk" in low or "password" in low:
        msg = "كلمة المرور غلط"
    elif "no network with ssid" in low:
        msg = "الشبكة مو موجودة — قرّب الجهاز وحدّث القائمة"
    elif "timeout" in low or rc == 124:
        msg = "الشبكة ما ردّت — جرب مرة ثانية"
    else:
        msg = out[-160:] or "ما گدرت أتصل"
    return False, msg


def ips():
    out = {}
    if FAKE:
        return {"wlan0": "192.168.1.44", "usb0": "10.55.0.2"}
    try:
        r = subprocess.run(["ip", "-4", "-o", "addr", "show"], capture_output=True, text=True, timeout=3).stdout
        for m in re.finditer(r"^\d+:\s+(\S+)\s+inet\s+([\d.]+)/", r, re.M):
            if m.group(1) != "lo":
                out[m.group(1)] = m.group(2)
    except (OSError, subprocess.SubprocessError):
        pass
    return out


# ===================================================================== حالة الجهاز
class SysInfo:
    def __init__(self):
        self.internet = False
        self.thr = 0
        self.t_thr = -99.0
        threading.Thread(target=self._net_loop, daemon=True).start()

    def _net_loop(self):
        while True:
            ok = FAKE
            for host in ("1.1.1.1", "8.8.8.8"):
                if ok:
                    break
                try:
                    with socket.create_connection((host, 53), timeout=2):
                        ok = True
                except OSError:
                    pass
            self.internet = ok
            time.sleep(8)

    def temp(self):
        try:
            with open("/sys/class/thermal/thermal_zone0/temp") as f:
                return round(int(f.read()) / 1000, 1)
        except (OSError, ValueError):
            return 48.5 if FAKE else None

    def throttled(self):
        if time.monotonic() - self.t_thr > 10:
            self.t_thr = time.monotonic()
            try:
                r = subprocess.run(["vcgencmd", "get_throttled"], capture_output=True, text=True, timeout=3).stdout
                self.thr = int(r.split("=")[1], 16)
            except (OSError, ValueError, IndexError, subprocess.SubprocessError):
                self.thr = 0
        return self.thr


CAM = None
SHARE = None
SYS = None
PREV_FPS = 0          # سرعة المعاينة الفعلية بالواجهة
CLIENTS = {}          # بث الراسبيري 5: peer → وقت البداية
CLOCK = threading.Lock()


def status():
    with CLOCK:
        peers = sorted(CLIENTS)
    wl = [n for n in wifi_list(False) if n["active"]]
    thr = SYS.throttled()
    return {
        "version": VERSION,
        "cast": SHARE.on, "castErr": SHARE.err,
        "links": {"usb": carrier("usb0"), "eth": carrier("eth0")},
        "pi5": peers,
        "cam": {"running": CAM.running, "fps": round(CAM.fps), "preview": PREV_FPS, "err": CAM.err, "size": [W, H]},
        "wifi": wl[0] if wl else None,
        "internet": SYS.internet,
        "temp": SYS.temp(),
        "power": {"now": bool(thr & 0x1), "past": bool(thr & 0x10000)},
        "ips": ips(),
    }


# ===================================================================== بث الصورة للراسبيري 5 (TCP 8766)
def serve_client(conn, peer):
    try:
        conn.settimeout(5)
        cmd = conn.recv(1)
        if not SHARE.on:                        # البث مطفي → الراسبيري 5 ما يشوف الكاميرا
            return
        if cmd == b"P":
            conn.sendall(b"ALHCAM1 %dx%d\n" % (W, H))
            return
        if cmd != b"S":
            return
        conn.settimeout(None)
        conn.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
        conn.setsockopt(socket.SOL_SOCKET, socket.SO_SNDBUF, 96 * 1024)
        with CLOCK:
            CLIENTS[peer[0]] = time.time()
        CAM.acquire()
        try:
            seen, idle = 0, 0
            while SHARE.on:
                seen2, frame = CAM.wait(seen)
                if frame is None:
                    idle += 1
                    if idle % 3 == 0 and not CAM.running:
                        CAM.ensure()                       # الكاميرا وقفت؟ نحاول نرجعها
                    continue
                idle, seen = 0, seen2
                conn.sendall(frame)                         # دائماً آخر صورة بس
        finally:
            CAM.release()
    except OSError:
        pass
    finally:
        with CLOCK:
            CLIENTS.pop(peer[0], None)
        try:
            conn.close()
        except OSError:
            pass


def tcp_server(port):
    srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    srv.bind(("0.0.0.0", port))
    srv.listen(4)
    log("stream on", port, "raw" if CAM.raw else "jpeg")
    while True:
        conn, peer = srv.accept()
        threading.Thread(target=serve_client, args=(conn, peer), daemon=True).start()


# ===================================================================== الواجهة (HTTP 8767)
class UI(BaseHTTPRequestHandler):
    server_version = "AlharthiaCamLink/" + VERSION

    def log_message(self, *a):
        pass

    def _allowed(self):
        try:
            ip = ipaddress.ip_address(self.client_address[0])
            return any(ip in n for n in ALLOWED if n.version == ip.version)
        except ValueError:
            return False

    def _json(self, obj, code=200):
        b = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(b)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(b)

    def _body(self):
        try:
            n = int(self.headers.get("Content-Length") or 0)
            return json.loads(self.rfile.read(n) or b"{}") if 0 < n < 65536 else {}
        except (ValueError, OSError):
            return {}

    def do_GET(self):
        if not self._allowed():
            return self.send_error(403)
        u = urlparse(self.path)
        try:
            if u.path in ("/", "/index.html"):
                with open(os.path.join(HERE, "pi4.html"), "rb") as f:
                    b = f.read()
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Content-Length", str(len(b)))
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                self.wfile.write(b)
            elif u.path == "/stream.mjpg":
                self._mjpeg()
            elif u.path == "/snap.jpg":
                CAM.acquire()
                try:
                    _s, fr = CAM.wait(CAM.seq, 3)
                    jp = CAM.jpeg(fr) if fr else None
                finally:
                    threading.Thread(target=CAM.release, daemon=True).start()
                if not jp:
                    return self.send_error(503)
                self.send_response(200)
                self.send_header("Content-Type", "image/jpeg")
                self.send_header("Content-Length", str(len(jp)))
                self.end_headers()
                self.wfile.write(jp)
            elif u.path == "/api/status":
                self._json(status())
            elif u.path == "/api/wifi":
                q = parse_qs(u.query)
                self._json({"nets": wifi_list(q.get("rescan", ["0"])[0] == "1")})
            else:
                self.send_error(404)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def do_POST(self):
        if not self._allowed():
            return self.send_error(403)
        u = urlparse(self.path)
        d = self._body()
        try:
            if u.path == "/api/cast":
                on = SHARE.set(bool(d.get("on")))
                self._json({"ok": True, "cast": on, "err": SHARE.err})
            elif u.path == "/api/wifi":
                ssid = str(d.get("ssid") or "").strip()
                if not ssid:
                    return self._json({"ok": False, "error": "اختار شبكة"}, 400)
                ok, err = wifi_connect(ssid, str(d.get("psk") or ""))
                self._json({"ok": ok, "error": err})
            elif u.path == "/api/power":
                a = d.get("a")
                if a not in ("reboot", "poweroff"):
                    return self._json({"ok": False}, 400)
                self._json({"ok": True})
                if not FAKE:
                    threading.Timer(1.0, lambda: subprocess.Popen(["systemctl", a])).start()
            else:
                self.send_error(404)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def _mjpeg(self):
        self.send_response(200)
        self.send_header("Content-Type", "multipart/x-mixed-replace; boundary=alhframe")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        CAM.acquire()
        try:
            global PREV_FPS
            seen, t0, n = 0, time.monotonic(), 0
            while True:
                seen2, fr = CAM.wait(seen)
                if fr is None:
                    if not CAM.running:
                        CAM.ensure()
                    continue
                seen = seen2
                jp = CAM.jpeg(fr)                         # كل صورة (١٢٠/ثانية) — بدون ضغط ثاني
                if not jp:
                    continue
                self.wfile.write(b"--alhframe\r\nContent-Type: image/jpeg\r\nContent-Length: %d\r\n\r\n" % len(jp) + jp + b"\r\n")
                n += 1
                now = time.monotonic()
                if now - t0 >= 1:
                    PREV_FPS, t0, n = round(n / (now - t0)), now, 0
        except (BrokenPipeError, ConnectionResetError, OSError):
            pass
        finally:
            PREV_FPS = 0
            CAM.release()


def main():
    global CAM, SHARE, SYS, FAKE
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8766)
    ap.add_argument("--ui-port", type=int, default=8767)
    ap.add_argument("--raw", action="store_true", help="بدون ضغط (يحتاج كيبل إنترنت)")
    ap.add_argument("--quality", type=int, default=75)
    ap.add_argument("--fake", action="store_true", help="للتجربة بدون كاميرا ولا NetworkManager")
    a = ap.parse_args()
    FAKE = a.fake
    CAM = Camera(raw=a.raw, quality=a.quality)
    SHARE = Share()
    SYS = SysInfo()
    threading.Thread(target=SHARE.sync, daemon=True).start()
    threading.Thread(target=tcp_server, args=(a.port,), daemon=True).start()
    httpd = ThreadingHTTPServer(("0.0.0.0", a.ui_port), UI)
    httpd.daemon_threads = True
    log("CamLink", VERSION, "ui on", a.ui_port, "cast" if SHARE.on else "cast off")
    httpd.serve_forever()


if __name__ == "__main__":
    main()
