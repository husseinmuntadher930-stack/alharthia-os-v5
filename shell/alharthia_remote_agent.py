#!/usr/bin/env python3
"""
AlharthiaOS — مساعد ريموت المعلم (يشتغل على الـ Zero 2 W، كـ root).

صفحة الريموت (من الصبورة) تكلم هذا البرنامج على http://127.0.0.1:8771 حتى توصل لأشياء الريموت نفسه:
  * المايك USB: تسجيل صوت المعلم ← يندز للصبورة ← يرجع نص.
  * الفلاشة USB: تصفح ملفاتها ونسخها للصبورة لاسلكياً.

الإعدادات: /etc/alharthia-remote.json  {"url": "http://IP:8770/", "token_file": "/home/pi/.alharthia-remote-token"}
البرنامج يتحدث وحده من الصبورة عند كل تشغيل (http://IP:8770/agent.py).
"""
import http.client
import json
import math
import os
import re
import signal
import struct
import subprocess
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, quote, urlparse

VERSION = "1.1"
PORT = 8771
CONF = os.environ.get("ALH_AGENT_CONF", "/etc/alharthia-remote.json")
REC = "/tmp/alh-rec.wav"
MNT = "/media/alh"
MAX_REC = 90                 # ثانية
FAKE = os.environ.get("ALH_AGENT_FAKE") == "1"


def log(*a):
    print("agent:", *a, flush=True)


def conf():
    try:
        with open(CONF, encoding="utf-8") as f:
            c = json.load(f)
    except (OSError, ValueError):
        c = {}
    tok = c.get("token", "")
    if not tok and c.get("token_file"):
        try:
            tok = open(c["token_file"]).read().strip()
        except OSError:
            pass
    return (c.get("url") or "").rstrip("/") + "/", tok


def board_request(method, path, body=None, headers=None, length=None, progress=None, timeout=200):
    """طلب للصبورة (body ممكن يكون bytes أو ملف مفتوح)."""
    url, tok = conf()
    u = urlparse(url)
    if not u.hostname:
        raise OSError("عنوان الصبورة مو مضبوط")
    c = http.client.HTTPConnection(u.hostname, u.port or 80, timeout=timeout)
    h = {"X-Remote-Token": tok}
    h.update(headers or {})
    if body is None:
        c.request(method, path, headers=h)
    elif isinstance(body, (bytes, bytearray)):
        h["Content-Length"] = str(len(body))
        c.request(method, path, body=body, headers=h)
    else:                                        # ملف — نرسله قطع حتى نعرف التقدم
        h["Content-Length"] = str(length)
        c.putrequest(method, path)
        for k, v in h.items():
            c.putheader(k, v)
        c.endheaders()
        sent = 0
        while True:
            chunk = body.read(256 * 1024)
            if not chunk:
                break
            c.send(chunk)
            sent += len(chunk)
            if progress:
                progress(sent)
    r = c.getresponse()
    data = r.read()
    c.close()
    try:
        j = json.loads(data.decode() or "{}")
    except ValueError:
        j = {"error": "رد غير مفهوم من الصبورة (%d)" % r.status}
    if r.status >= 400 and "error" not in j:
        j["error"] = "خطأ %d" % r.status
    return j


# ===================================================================== المايك
def mic_card():
    """رقم كارت المايك USB (أو أي كارت تسجيل)."""
    if FAKE:
        return "fake"
    try:
        out = subprocess.run(["arecord", "-l"], capture_output=True, text=True, timeout=5).stdout
    except (OSError, subprocess.SubprocessError):
        return None
    cards = re.findall(r"^card (\d+): (\S+) \[([^\]]*)\]", out, re.M)
    if not cards:
        return None
    usb = [c for c in cards if "usb" in (c[1] + c[2]).lower()]
    return (usb or cards)[0][0]


class Mic:
    def __init__(self):
        self.proc = None
        self.t0 = 0.0
        self.lock = threading.Lock()

    def start(self):
        with self.lock:
            self.stop_proc()
            card = mic_card()
            if card is None:
                return {"error": "ما لگيت مايك — اشبك المايك USB بالريموت"}
            try:
                os.remove(REC)
            except OSError:
                pass
            if FAKE:
                cmd = ["python3", "-c", FAKE_REC, REC]
            else:
                cmd = ["arecord", "-q", "-D", "plughw:%s,0" % card, "-f", "S16_LE", "-r", "16000", "-c", "1",
                       "-d", str(MAX_REC), "-t", "wav", REC]
            self.proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
            self.t0 = time.time()
            return {"ok": True}

    def stop_proc(self):
        p, self.proc = self.proc, None
        if p and p.poll() is None:
            p.send_signal(signal.SIGINT)         # arecord يصلّح رأس ملف WAV لمن يوكف بـ SIGINT
            try:
                p.wait(timeout=3)
            except subprocess.TimeoutExpired:
                p.kill()
        return p

    def level(self):
        """مستوى الصوت الحالي 0..1 (للمؤشر بالشاشة)."""
        if not self.proc:
            return {"rec": False, "level": 0, "t": 0}
        lvl = 0.0
        try:
            with open(REC, "rb") as f:
                f.seek(0, 2)
                size = f.tell()
                if size > 44 + 3200:
                    f.seek(size - 3200)
                    raw = f.read(3200)
                    n = len(raw) // 2
                    v = struct.unpack("<%dh" % n, raw[:n * 2])
                    lvl = min(1.0, math.sqrt(sum(x * x for x in v) / n) / 8000.0)
        except OSError:
            pass
        alive = self.proc.poll() is None
        return {"rec": alive, "level": round(lvl, 3), "t": round(time.time() - self.t0, 1)}

    def stop(self, lang="ar"):
        with self.lock:
            p = self.stop_proc()
            if not p:
                return {"error": "ما كان اكو تسجيل"}
        if not os.path.exists(REC) or os.path.getsize(REC) < 1000:
            err = (p.stderr.read().decode(errors="ignore") if p and p.stderr else "").strip()
            return {"error": "التسجيل ما اشتغل" + (": " + err[-120:] if err else "")}
        with open(REC, "rb") as f:
            data = f.read()
        try:
            return board_request("POST", "/api/voice?lang=" + quote(lang), data, {"Content-Type": "audio/wav"})
        except OSError as e:
            return {"error": "الصبورة ما ترد: %s" % e}


FAKE_REC = r"""
import sys, wave, math, struct, time, signal
w = wave.open(sys.argv[1], 'wb'); w.setnchannels(1); w.setsampwidth(2); w.setframerate(16000)
stop = []
signal.signal(signal.SIGINT, lambda *a: stop.append(1))
t = 0
while not stop and t < 16000 * 30:
    w.writeframes(b''.join(struct.pack('<h', int(9000 * math.sin(i / 8))) for i in range(t, t + 1600)))
    t += 1600; time.sleep(0.1)
w.close()
"""


# ===================================================================== الفلاشة
def usb_parts():
    """أجزاء الفلاشات (USB) — ونركّبها للقراءة بس إذا مو مركّبة."""
    if FAKE:
        os.makedirs(os.path.join(MNT, "FAKE"), exist_ok=True)
        return [{"name": "FAKE", "label": "فلاشة تجربة", "size": "8G", "path": os.path.join(MNT, "FAKE")}]
    try:
        j = json.loads(subprocess.run(["lsblk", "-J", "-b", "-o", "NAME,PATH,LABEL,SIZE,RM,TRAN,MOUNTPOINT,FSTYPE,TYPE"],
                                      capture_output=True, text=True, timeout=5).stdout or "{}")
    except (OSError, ValueError, subprocess.SubprocessError):
        return []
    out = []

    def walk(devs, tran=None, rm=False):
        for d in devs or []:
            t = d.get("tran") or tran
            r = d.get("rm") in (True, "1", 1) or rm
            if d.get("type") == "part" or (d.get("type") == "disk" and d.get("fstype")):
                if (t == "usb" or r) and d.get("fstype") and d.get("fstype") != "swap":
                    mp = d.get("mountpoint")
                    if not mp:
                        mp = mount(d)
                    if mp:
                        gb = int(d.get("size") or 0) / 1e9
                        out.append({"name": d["name"], "label": d.get("label") or d["name"],
                                    "size": ("%.0fG" % gb) if gb >= 1 else ("%.0fM" % (gb * 1000)), "path": mp})
            walk(d.get("children"), t, r)

    walk(j.get("blockdevices"))
    return out


def mount(d):
    mp = os.path.join(MNT, re.sub(r"[^\w.-]", "_", d.get("label") or d["name"]))
    os.makedirs(mp, exist_ok=True)
    fs = d.get("fstype")
    opts = "ro,nosuid,nodev,noexec"
    if fs in ("vfat", "exfat", "ntfs", "ntfs3"):
        opts += ",uid=1000,gid=1000,utf8" if fs != "exfat" else ",uid=1000,gid=1000"
    for t in ([fs] if fs != "ntfs" else ["ntfs3", "ntfs-3g", "ntfs"]):
        r = subprocess.run(["mount", "-t", t, "-o", opts, d["path"], mp], capture_output=True, text=True)
        if r.returncode == 0:
            log("mounted", d["path"], "->", mp)
            return mp
    log("mount failed", d["path"], r.stderr.strip())
    return None


def under_mnt(p):
    rp = os.path.realpath(p)
    return rp == MNT or rp.startswith(MNT + os.sep)


def ls(path):
    if not path:
        return {"path": "", "items": [{"name": p["label"], "path": p["path"], "dir": True, "size": 0, "drive": p["size"]}
                                      for p in usb_parts()]}
    if not under_mnt(path) or not os.path.isdir(path):
        raise PermissionError("مسار غير مسموح")
    items = []
    for n in os.listdir(path):
        if n.startswith(".") or n in ("System Volume Information", "$RECYCLE.BIN"):
            continue
        full = os.path.join(path, n)
        try:
            st = os.stat(full)
        except OSError:
            continue
        d = os.path.isdir(full)
        items.append({"name": n, "path": full, "dir": d, "size": 0 if d else st.st_size, "mtime": int(st.st_mtime),
                      "ext": "" if d else os.path.splitext(n)[1].lower().lstrip(".")})
    items.sort(key=lambda e: (not e["dir"], e["name"].lower()))
    parent = os.path.dirname(os.path.realpath(path))
    return {"path": path, "parent": parent if under_mnt(parent) and parent != MNT else "", "items": items[:500]}


JOBS = {}


def send_job(paths, open_after):
    jid = uuid.uuid4().hex[:8]
    files = [p for p in paths if under_mnt(p) and os.path.isfile(p)]
    total = sum(os.path.getsize(p) for p in files)
    job = {"id": jid, "total": total, "done": 0, "count": len(files), "i": 0, "name": "", "state": "run", "error": "", "saved": []}
    JOBS[jid] = job

    def run():
        base = 0
        try:
            for i, p in enumerate(files):
                job.update(i=i + 1, name=os.path.basename(p))
                size = os.path.getsize(p)
                with open(p, "rb") as f:
                    r = board_request("POST", "/api/upload?name=" + quote(os.path.basename(p)), f,
                                      {"Content-Type": "application/octet-stream"}, length=size,
                                      progress=lambda s, b=base: job.update(done=b + s), timeout=600)
                if r.get("error"):
                    raise OSError(r["error"])
                job["saved"].append(r)
                base += size
                job["done"] = base
            if open_after and len(job["saved"]) == 1:
                s = job["saved"][0]
                board_request("POST", "/api/cmd", json.dumps({"a": "open", "path": s["path"], "name": s["name"],
                                                              "ext": s.get("ext", ""), "size": s["size"], "mtime": s["mtime"]}).encode(),
                              {"Content-Type": "application/json"})
            job["state"] = "ok"
        except Exception as e:  # noqa
            job.update(state="error", error=str(e)[:200])
            log("send failed:", e)

    threading.Thread(target=run, daemon=True).start()
    return job


def eject():
    if FAKE:
        return {"ok": True}
    for p in usb_parts():
        subprocess.run(["umount", p["path"]], capture_output=True)
    subprocess.run(["sync"])
    return {"ok": True}


# ===================================================================== الخادم المحلي
MIC = Mic()


# ===================================================================== الاستماع المستمر (بدون زر)
STATE_FILE = os.environ.get("ALH_AGENT_STATE", "/var/lib/alharthia-remote/listen.json")


def wav_bytes(pcm, rate=16000):
    import io
    import wave
    b = io.BytesIO()
    with wave.open(b, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(pcm)
    return b.getvalue()


class Listener:
    """المايك يسمع طول الوقت: كل جملة (كلام وبعده سكوت) تنقطع وتندز للصبورة وتنكتب نص."""
    FRAME = 960                      # 30ms × 16kHz × 2 bytes
    PRE = 10                         # 300ms قبل بداية الكلام
    END_SIL = 27                     # 0.8s سكوت = نهاية الجملة
    MAX_LEN = 500                    # 15s أطول جملة
    MIN_LEN = 20                     # 0.6s أقصر جملة

    def __init__(self):
        self.on = self._load()
        self.state = "off"
        self.level = 0.0
        self.noise = 300.0
        self.last = []                # آخر النصوص الي انكتبت
        self.err = ""
        self.proc = None
        self.q = []
        self.qc = threading.Condition()
        threading.Thread(target=self._loop, daemon=True).start()
        threading.Thread(target=self._worker, daemon=True).start()

    def _load(self):
        try:
            with open(STATE_FILE) as f:
                return bool(json.load(f).get("on", True))
        except (OSError, ValueError):
            return True

    def set(self, on):
        on = bool(on)
        if on == self.on:
            return
        self.on = on
        try:
            os.makedirs(os.path.dirname(STATE_FILE), exist_ok=True)
            with open(STATE_FILE, "w") as f:
                json.dump({"on": on}, f)
        except OSError:
            pass
        if not on:
            self._kill()

    def _kill(self):
        p, self.proc = self.proc, None
        if p and p.poll() is None:
            p.kill()

    def status(self):
        return {"on": self.on, "state": self.state, "level": round(self.level, 3), "last": self.last[-4:],
                "err": self.err, "queue": len(self.q)}

    def _open(self):
        card = mic_card()
        if card is None:
            self.err = "ما لگيت مايك — اشبك المايك USB بالريموت"
            return None
        self.err = ""
        if FAKE:
            cmd = ["python3", "-c", FAKE_STREAM]
        else:
            cmd = ["arecord", "-q", "-D", "plughw:%s,0" % card, "-f", "S16_LE", "-r", "16000", "-c", "1", "-t", "raw"]
        return subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, bufsize=0)

    def _loop(self):
        while True:
            if not self.on or MIC.proc:               # مطفي، أو تسجيل يدوي شغال
                self.state, self.level = ("off" if not self.on else "busy"), 0.0
                time.sleep(0.5)
                continue
            self.proc = self._open()
            if not self.proc:
                self.state = "nomic"
                time.sleep(3)
                continue
            self.state = "idle"
            pre, seg, sil, talking = [], [], 0, False
            hot = 0
            try:
                while self.on and self.proc and self.proc.poll() is None and not MIC.proc:
                    fr = self.proc.stdout.read(self.FRAME)
                    if not fr or len(fr) < self.FRAME:
                        break
                    n = len(fr) // 2
                    v = struct.unpack("<%dh" % n, fr)
                    rms = math.sqrt(sum(x * x for x in v) / n)
                    self.level = min(1.0, rms / 6000.0)
                    thr = max(self.noise * 3.0, 450.0)
                    if not talking:
                        self.noise = self.noise * 0.995 + min(rms, self.noise * 2) * 0.005   # الضجة الطبيعية بالصف
                        pre.append(fr)
                        pre = pre[-self.PRE:]
                        hot = hot + 1 if rms > thr else 0
                        if hot >= 3:                  # 90ms كلام متواصل = بداية جملة
                            talking, seg, sil = True, list(pre), 0
                            self.state = "speech"
                    else:
                        seg.append(fr)
                        sil = sil + 1 if rms < thr * 0.7 else 0
                        if sil >= self.END_SIL or len(seg) >= self.MAX_LEN:
                            if len(seg) - sil >= self.MIN_LEN:
                                self._enqueue(b"".join(seg))
                            talking, pre, hot = False, [], 0
                            self.state = "idle"
            except Exception as e:  # noqa
                self.err = str(e)[:120]
            self._kill()
            time.sleep(1)

    def _enqueue(self, pcm):
        with self.qc:
            if len(self.q) < 6:                       # إذا الصبورة متأخرة ما نكدّس
                self.q.append(pcm)
                self.qc.notify()

    def _worker(self):
        while True:
            with self.qc:
                while not self.q:
                    self.qc.wait()
                pcm = self.q.pop(0)
            try:
                r = board_request("POST", "/api/voice?lang=ar", wav_bytes(pcm), {"Content-Type": "audio/wav"})
                t = (r.get("text") or "").strip()
                if t:
                    board_request("POST", "/api/cmd", json.dumps({"a": "text", "text": t, "live": True}).encode(),
                                  {"Content-Type": "application/json"})
                    self.last = (self.last + [t])[-8:]
                elif r.get("error") and "صوت" not in r["error"] and "قصير" not in r["error"] and "فهمت" not in r["error"]:
                    self.err = r["error"]
            except OSError as e:
                self.err = "الصبورة ما ترد: %s" % e


FAKE_STREAM = r"""
import sys, math, struct, time
out = sys.stdout.buffer
t = 0
while True:
    sec = (t // 16000) % 4                      # ثانيتين كلام، ثانيتين سكوت
    amp = 7000 if sec < 2 else 60
    out.write(b''.join(struct.pack('<h', int(amp * math.sin(i / 6))) for i in range(t, t + 480)))
    out.flush(); t += 480; time.sleep(0.03)
"""


LISTEN = Listener()


class H(BaseHTTPRequestHandler):
    server_version = "AlharthiaAgent/" + VERSION

    def log_message(self, *a):
        pass

    def cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Private-Network", "true")

    def j(self, o, code=200):
        b = json.dumps(o, ensure_ascii=False).encode()
        self.send_response(code)
        self.cors()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(b)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(b)

    def body(self):
        n = min(int(self.headers.get("Content-Length") or 0), 65536)
        try:
            return json.loads(self.rfile.read(n) or b"{}")
        except ValueError:
            return {}

    def do_OPTIONS(self):
        self.send_response(204)
        self.cors()
        self.end_headers()

    def do_GET(self):
        u = urlparse(self.path)
        q = parse_qs(u.query)
        try:
            if u.path == "/hello":
                return self.j({"ok": True, "v": VERSION, "mic": mic_card() is not None, "usb": len(usb_parts()), "listen": LISTEN.on})
            if u.path == "/listen":
                return self.j(LISTEN.status())
            if u.path == "/mic/level":
                return self.j(MIC.level())
            if u.path == "/usb/ls":
                return self.j(ls((q.get("path") or [""])[0]))
            if u.path == "/usb/job":
                return self.j(JOBS.get((q.get("id") or [""])[0]) or {"error": "ما موجود"})
            self.j({"error": "unknown"}, 404)
        except Exception as e:  # noqa
            self.j({"error": str(e)}, 400)

    def do_POST(self):
        u = urlparse(self.path)
        b = self.body()
        try:
            if u.path == "/listen":
                LISTEN.set(b.get("on", True))
                return self.j(LISTEN.status())
            if u.path == "/mic/start":
                return self.j(MIC.start())
            if u.path == "/mic/stop":
                return self.j(MIC.stop(b.get("lang") or "ar"))
            if u.path == "/mic/cancel":
                MIC.stop_proc()
                return self.j({"ok": True})
            if u.path == "/usb/send":
                return self.j(send_job(b.get("paths") or [], bool(b.get("open"))))
            if u.path == "/usb/eject":
                return self.j(eject())
            self.j({"error": "unknown"}, 404)
        except Exception as e:  # noqa
            self.j({"error": str(e)}, 400)


def main():
    os.makedirs(MNT, exist_ok=True)
    srv = ThreadingHTTPServer(("127.0.0.1", PORT), H)
    srv.daemon_threads = True
    log("agent", VERSION, "on", PORT)
    srv.serve_forever()


if __name__ == "__main__":
    main()
