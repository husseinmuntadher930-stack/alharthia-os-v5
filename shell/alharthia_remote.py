#!/usr/bin/env python3
"""
Alharthia OS — ريموت المعلم (Raspberry Pi Zero 2 W + شاشة 5 إنج).

الريموت يفتح صفحة من هذا الخادم (http://<الجهاز>:8770/) ويتحكم بالصبورة:
  * الربط أول مرة برمز PIN يطلع على الصبورة، وبعدها الريموت ياخذ مفتاح خاص بيه.
  * أوامر الريموت (القرعة، الصفحات، الكتابة، المؤشر…) تنحط بطابور، وواجهة الصبورة
    تسحبها من alharthia_server.py (/api/remote/poll) وتنفذها.
  * الواجهة تنشر حالتها (/api/remote/state) والريموت يقراها حتى يعرض نفس الشي.
  * مهام المعلم تنحفظ هنا بملف JSON.

يشتغل داخل alharthia_server.py (نفس العملية)، بس على منفذ ثاني ومفتوح للشبكة،
وكل طلب لازم يحمل مفتاح ريموت مربوط — إلا صفحة الريموت نفسها وطلب الربط.
"""
import hashlib, json, os, secrets, socket, subprocess, threading, time
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

PORT = int(os.environ.get("ALH_REMOTE_PORT", "8770"))
CONF = os.path.expanduser("~/.config/alharthia")
DEV_FILE = os.path.join(CONF, "remotes.json")
TASK_FILE = os.path.join(CONF, "teacher-tasks.json")
PAIR_SECONDS = 180
MAX_FAILS = 8
HOTSPOT_SSID = "AlharthiaOS-Remote"

_lock = threading.Lock()
_cond = threading.Condition(_lock)
ST = {
    "srv": None, "ui_dir": "", "fs": None, "version": "",
    "queue": [], "seq": 0,                      # أوامر للواجهة
    "state": {}, "state_v": 0,                 # حالة الواجهة للريموت
    "pair": {"pin": "", "until": 0.0, "fails": 0, "block_until": 0.0},
    "seen": {},                                # آخر ظهور لكل ريموت
    "ui_seen": 0.0,
}


# ------------------------------------------------------------------ files
def _load(path, default):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def _save(path, data):
    os.makedirs(CONF, exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    os.replace(tmp, path)
    try:
        os.chmod(path, 0o600)
    except OSError:
        pass


def devices():
    return _load(DEV_FILE, {"devices": [], "enabled": True, "hotspot": {"on": False, "psk": ""}})


def _hash(tok):
    return hashlib.sha256(tok.encode()).hexdigest()


def device_of(token):
    if not token:
        return None
    h = _hash(token)
    for d in devices()["devices"]:
        if secrets.compare_digest(d.get("h", ""), h):
            return d
    return None


# ------------------------------------------------------------------ queue (remote -> board UI)
def push(cmd):
    with _cond:
        ST["seq"] += 1
        cmd = dict(cmd, seq=ST["seq"], t=time.time())
        ST["queue"].append(cmd)
        if len(ST["queue"]) > 400:
            ST["queue"] = ST["queue"][-300:]
        _cond.notify_all()
    return cmd["seq"]


def poll(after, timeout=20.0):
    """الواجهة تسأل: شنو الأوامر الجديدة بعد رقم after؟ (ينتظر لحد ما يجي أمر)"""
    end = time.time() + timeout
    with _cond:
        ST["ui_seen"] = time.time()
        if after < 0:                  # الواجهة توها اشتغلت: ما نعيد أوامر قديمة
            return {"seq": ST["seq"], "cmds": []}
        if after > ST["seq"]:          # الخادم انعاد تشغيله
            after = 0
        while True:
            items = [c for c in ST["queue"] if c["seq"] > after]
            if items:
                return {"seq": ST["seq"], "cmds": items}
            left = end - time.time()
            if left <= 0:
                return {"seq": ST["seq"], "cmds": []}
            _cond.wait(left)


def set_state(st):
    with _cond:
        ST["state"] = st
        ST["state_v"] += 1
        ST["ui_seen"] = time.time()
        _cond.notify_all()


def get_state(after, timeout=15.0):
    end = time.time() + timeout
    with _cond:
        while ST["state_v"] <= after:
            left = end - time.time()
            if left <= 0:
                break
            _cond.wait(left)
        return {"v": ST["state_v"], "state": ST["state"], "board": time.time() - ST["ui_seen"] < 30}


# ------------------------------------------------------------------ pairing
def pair_start():
    p = ST["pair"]
    p["pin"] = "".join(secrets.choice("0123456789") for _ in range(6))
    p["until"] = time.time() + PAIR_SECONDS
    p["fails"] = 0
    return {"pin": p["pin"], "seconds": PAIR_SECONDS}


def pair_cancel():
    ST["pair"].update(pin="", until=0.0)


def pair_try(pin, name):
    p = ST["pair"]
    now = time.time()
    if now < p["block_until"]:
        return None, "محاولات كثيرة — انتظر دقيقة وجرب مرة ثانية"
    if not p["pin"] or now > p["until"]:
        return None, "اضغط «ربط ريموت جديد» من إعدادات الصبورة حتى يطلع الرمز"
    if not secrets.compare_digest(str(pin).strip(), p["pin"]):
        p["fails"] += 1
        if p["fails"] >= MAX_FAILS:
            p["block_until"] = now + 60
            pair_cancel()
        return None, "الرمز غلط"
    tok = secrets.token_urlsafe(32)
    d = devices()
    dev = {"id": secrets.token_hex(4), "name": (name or "ريموت المعلم")[:40], "h": _hash(tok), "paired": int(now)}
    d["devices"].append(dev)
    d["devices"] = d["devices"][-6:]
    _save(DEV_FILE, d)
    pair_cancel()
    push({"a": "paired", "name": dev["name"]})
    return tok, dev


def remove_device(dev_id):
    d = devices()
    d["devices"] = [x for x in d["devices"] if x.get("id") != dev_id]
    _save(DEV_FILE, d)


def rename_device(dev_id, name):
    d = devices()
    for x in d["devices"]:
        if x.get("id") == dev_id:
            x["name"] = str(name)[:40]
    _save(DEV_FILE, d)


def set_enabled(on):
    d = devices()
    d["enabled"] = bool(on)
    _save(DEV_FILE, d)


# ------------------------------------------------------------------ teacher tasks
def tasks():
    return _load(TASK_FILE, {"items": []})


def tasks_do(b):
    t = tasks()
    items = t["items"]
    a = b.get("op")
    if a == "add" and str(b.get("text", "")).strip():
        items.insert(0, {"id": secrets.token_hex(4), "text": str(b["text"]).strip()[:200], "done": False, "t": int(time.time())})
    elif a == "toggle":
        for it in items:
            if it["id"] == b.get("id"):
                it["done"] = not it["done"]
    elif a == "del":
        t["items"] = [it for it in items if it["id"] != b.get("id")]
    elif a == "clearDone":
        t["items"] = [it for it in items if not it["done"]]
    t["items"] = t["items"][:100]
    _save(TASK_FILE, t)
    push({"a": "tasks"})
    return t


# ------------------------------------------------------------------ network info
def lan_ips():
    ips = []
    try:
        out = subprocess.run(["hostname", "-I"], capture_output=True, text=True, timeout=3).stdout.split()
        ips = [x for x in out if ":" not in x and not x.startswith("127.")]
    except Exception:  # noqa
        pass
    if not ips:
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            s.connect(("10.255.255.255", 1))
            ips = [s.getsockname()[0]]
            s.close()
        except OSError:
            pass
    return ips


def status():
    d = devices()
    now = time.time()
    p = ST["pair"]
    return {
        "on": bool(ST["srv"]), "enabled": d.get("enabled", True), "port": PORT, "ips": lan_ips(),
        "hostname": socket.gethostname(),
        "devices": [{"id": x["id"], "name": x["name"], "paired": x.get("paired", 0),
                     "online": now - ST["seen"].get(x["id"], 0) < 25, "seen": ST["seen"].get(x["id"], 0)} for x in d["devices"]],
        "pairing": {"pin": p["pin"], "left": max(0, int(p["until"] - now))} if p["pin"] and now < p["until"] else None,
        "hotspot": {"on": bool(d.get("hotspot", {}).get("on")), "ssid": HOTSPOT_SSID, "psk": d.get("hotspot", {}).get("psk", "")},
    }


def hotspot(on, helper):
    """شبكة Wi-Fi خاصة بالريموت من الجهاز نفسه (إذا ماكو راوتر بالصف)."""
    d = devices()
    hs = d.setdefault("hotspot", {"on": False, "psk": ""})
    if not hs.get("psk"):
        hs["psk"] = "".join(secrets.choice("abcdefghjkmnpqrstuvwxyz23456789") for _ in range(10))
    cmd = ["sudo", "-n", helper, "hotspot", "on" if on else "off", hs["psk"]]
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=40)
    if r.returncode != 0:
        raise RuntimeError((r.stdout + r.stderr).strip().splitlines()[-1:] or ["تعذر تشغيل الشبكة"])
    hs["on"] = bool(on)
    _save(DEV_FILE, d)
    return status()


# ------------------------------------------------------------------ HTTP server for the remote
class RemoteHandler(BaseHTTPRequestHandler):
    server_version = "AlharthiaRemote"

    def log_message(self, *a):
        pass

    def send_json(self, obj, code=200):
        data = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        try:
            self.wfile.write(data)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def jbody(self):
        n = min(int(self.headers.get("Content-Length") or 0), 512 * 1024)
        raw = self.rfile.read(n) if n else b""
        try:
            return json.loads(raw.decode() or "{}")
        except ValueError:
            return {}

    def token(self, q):
        tok = self.headers.get("X-Remote-Token", "")
        if not tok:
            ck = self.headers.get("Cookie", "")
            for part in ck.split(";"):
                k, _, v = part.strip().partition("=")
                if k == "alhrt":
                    tok = v
        return tok or (q.get("k") or [""])[0]

    def page(self):
        path = os.path.join(ST["ui_dir"], "remote.html")
        try:
            data = open(path, "rb").read()
        except OSError:
            data = "<h1>صفحة الريموت غير موجودة — شغّل تحديث النظام</h1>".encode()
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        self.route("GET")

    def do_POST(self):
        self.route("POST")

    def route(self, m):
        u = urlparse(self.path)
        q = parse_qs(u.query)
        if not devices().get("enabled", True):
            return self.send_json({"error": "الريموت مطفي من إعدادات الصبورة"}, 403)
        if u.path in ("/", "/index.html", "/remote"):
            return self.page()
        if u.path == "/setup.sh":
            base = os.path.dirname(ST["ui_dir"])
            for cand in (os.path.join(base, "remote-zero-setup.sh"), os.path.join(os.path.dirname(base), "tools", "remote-zero-setup.sh")):
                if os.path.isfile(cand):
                    data = open(cand, "rb").read()
                    self.send_response(200)
                    self.send_header("Content-Type", "text/x-shellscript; charset=utf-8")
                    self.send_header("Content-Length", str(len(data)))
                    self.end_headers()
                    self.wfile.write(data)
                    return
            return self.send_json({"error": "not found"}, 404)
        if u.path == "/api/hello":
            return self.send_json({"ok": True, "name": "AlharthiaOS", "version": ST["version"], "host": socket.gethostname()})
        if u.path == "/api/pair" and m == "POST":
            b = self.jbody()
            tok, dev = pair_try(b.get("pin", ""), b.get("name", ""))
            if not tok:
                return self.send_json({"error": dev}, 403)
            data = json.dumps({"ok": True, "token": tok, "id": dev["id"], "name": dev["name"]}, ensure_ascii=False).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Set-Cookie", f"alhrt={tok}; Max-Age=315360000; Path=/; HttpOnly; SameSite=Strict")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        dev = device_of(self.token(q))
        if not dev:
            return self.send_json({"error": "unpaired"}, 401)
        ST["seen"][dev["id"]] = time.time()
        try:
            if u.path == "/api/state":
                after = int((q.get("v") or ["0"])[0] or 0)
                r = get_state(after, timeout=float((q.get("wait") or ["15"])[0] or 15))
                r["me"] = {"id": dev["id"], "name": dev["name"]}
                return self.send_json(r)
            if u.path == "/api/cmd" and m == "POST":
                b = self.jbody()
                cmds = b.get("cmds") if isinstance(b.get("cmds"), list) else [b]
                seq = 0
                for c in cmds[:60]:
                    if isinstance(c, dict) and isinstance(c.get("a"), str):
                        c = dict(c, dev=dev["name"])
                        seq = push(c)
                return self.send_json({"ok": True, "seq": seq})
            if u.path == "/api/tasks":
                return self.send_json(tasks_do(self.jbody()) if m == "POST" else tasks())
            if u.path == "/api/files":
                fs = ST["fs"]
                if not fs:
                    return self.send_json({"items": []})
                return self.send_json(fs((q.get("path") or [""])[0]))
            return self.send_json({"error": "unknown"}, 404)
        except Exception as e:  # noqa
            return self.send_json({"error": str(e)}, 500)


def start(ui_dir, fs_list=None, version=""):
    """يشغّل خادم الريموت بالخلفية (مرة وحدة)."""
    if ST["srv"]:
        return True
    ST["ui_dir"], ST["fs"], ST["version"] = ui_dir, fs_list, version
    try:
        srv = ThreadingHTTPServer(("0.0.0.0", PORT), RemoteHandler)
    except OSError as e:
        print("remote: cannot listen", e, flush=True)
        return False
    srv.daemon_threads = True
    ST["srv"] = srv
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    print(f"Alharthia remote on :{PORT}", flush=True)
    return True
