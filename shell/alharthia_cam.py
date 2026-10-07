#!/usr/bin/env python3
"""كاميرا مساعدة للمس — Alharthia OS (تجريبية)

كاميرا USB مركّبة فوك الصبورة وموجّهة لتحت. لوحة اللمس بالشاشة توصل نقاط اللمس متأخرة،
فالكاميرا تتابع حركة الإصبع/القلم بين نقطة وثانية وتخلي الخط بالسبورة يلحك الإصبع أسرع.

- التعرّف على كاميرات USB يشتغل بدون أي مكتبة (sysfs + ioctl)
- كاميرات الراسبيري بالشريط (CSI، مثل Camera Module 3 / NoIR) تشتغل عن طريق picamera2
- المتابعة تحتاج OpenCV (python3-opencv). إذا ما موجودة النظام يشتغل عادي بدون كاميرا
- الكاميرا تقترح «ذيل» مؤقت للخط بس؛ الخط المحفوظ دائماً من نقاط الشاشة نفسها
"""
import fcntl
import glob
import json
import os
import re
import shutil
import struct
import subprocess
import threading
import time

CFG_PATH = os.path.expanduser("~/.config/alharthia/cam.json")
SYS_V4L, DEV_V4L = "/sys/class/video4linux", "/dev/v4l"
VIDIOC_QUERYCAP = 0x80685600          # _IOR('V', 0, struct v4l2_capability) — 104 bytes
CAP_VIDEO_CAPTURE, CAP_CAPTURE_MPLANE, CAP_DEVICE_CAPS = 0x1, 0x1000, 0x80000000

try:
    import cv2                        # noqa
    import numpy as np                # noqa
    HAVE_CV = True
except Exception:                     # noqa
    cv2 = np = None
    HAVE_CV = False


# ------------------------------------------------------------------ التعرّف على الكاميرات
def _read(p):
    try:
        with open(p, encoding="utf-8", errors="replace") as f:
            return f.read().strip()
    except OSError:
        return ""


def _querycap(dev):
    try:
        fd = os.open(dev, os.O_RDWR | os.O_NONBLOCK)
    except OSError:
        return None
    try:
        buf = bytearray(104)
        fcntl.ioctl(fd, VIDIOC_QUERYCAP, buf)
        caps, dcaps = struct.unpack_from("<II", buf, 84)
        eff = dcaps if caps & CAP_DEVICE_CAPS else caps
        return {"card": bytes(buf[16:48]).split(b"\0")[0].decode("utf-8", "replace").strip(),
                "bus": bytes(buf[48:80]).split(b"\0")[0].decode("utf-8", "replace").strip(),
                "capture": bool(eff & (CAP_VIDEO_CAPTURE | CAP_CAPTURE_MPLANE))}
    except OSError:
        return None
    finally:
        os.close(fd)


def _usb_dev_dir(real):
    """مجلد جهاز الـUSB نفسه (مو الواجهة) — حتى الكاميرا الوحدة تنحسب مرة وحدة."""
    d = real
    while d and d != "/":
        if os.path.exists(os.path.join(d, "idVendor")):
            return d
        d = os.path.dirname(d)
    return None


# كاميرات USB تعطي 720p على 60 صورة/ثانية (MJPG): Logitech C922 و Razer Kiyo
HD60 = {"046d:085c": (1280, 720), "1532:0e03": (1280, 720)}
PS3_EYE = {"1415:2000"}          # Sony PlayStation Eye (OV534) — يشتغل بدرايفر gspca الجاهز بالكيرنل

GENERIC = re.compile(r"^(uvc\s*camera|usb\s*(2\.0\s*)?(pc\s*)?camera|camera|video\s*capture|webcam)"
                     r"(\s*\([0-9a-f]{4}:[0-9a-f]{4}\))?$", re.I)


def _nice_name(product, sysname, card):
    for raw in (product, sysname, card):
        # "HD Webcam C270: HD Webcam C270" أو "USB 2.0 Camera: USB Camera" → نفحص كل جزء لوحده
        for n in (raw or "").split(": "):
            n = re.sub(r"\s+", " ", n).strip()
            if n and not GENERIC.match(n):
                return n
    return "USB camera"


def list_cameras():
    """كل كاميرات USB الموصولة: [{id, dev, name}] — id ثابت حتى لو تغيّر رقم /dev/videoN."""
    by_link = {}
    for pat in (DEV_V4L + "/by-id/*", DEV_V4L + "/by-path/*"):
        for ln in sorted(glob.glob(pat)):
            by_link.setdefault(os.path.realpath(ln), os.path.basename(ln))
    seen, out = set(), []
    nodes = sorted(glob.glob(SYS_V4L + "/video*"), key=lambda p: int(re.sub(r"\D", "", os.path.basename(p)) or 0))
    for sysd in nodes:
        dev = "/dev/" + os.path.basename(sysd)
        real = os.path.realpath(os.path.join(sysd, "device"))
        if "/usb" not in real:                         # كاميرات/مشفّرات الراسبيري الداخلية ما تهمنا
            continue
        usb = _usb_dev_dir(real) or real
        if usb in seen:
            continue
        cap = _querycap(dev)
        if not cap or not cap["capture"]:              # عقد metadata الخاصة بـUVC
            continue
        seen.add(usb)
        name = _nice_name(_read(os.path.join(usb, "product")), _read(os.path.join(sysd, "name")), cap["card"])
        vidpid = "%s:%s" % (_read(os.path.join(usb, "idVendor")), _read(os.path.join(usb, "idProduct")))
        if vidpid in PS3_EYE:                          # كاميرا PS3 Eye تتعرّف باسم غامض (USB Camera-B4.09.24.1)
            name = "PlayStation Eye (PS3)"
        out.append({"id": by_link.get(dev, os.path.basename(usb)), "dev": dev, "name": name, "vidpid": vidpid})
    out += list_csi()
    # نفس الاسم لكاميرتين → نرقّمهن
    cnt = {}
    for c in out:
        cnt[c["name"]] = cnt.get(c["name"], 0) + 1
    idx = {}
    for c in out:
        if cnt[c["name"]] > 1:
            idx[c["name"]] = idx.get(c["name"], 0) + 1
            c["name"] = "%s (%d)" % (c["name"], idx[c["name"]])
    return out


# ------------------------------------------------------------------ كاميرات الشريط (CSI)
CSI_NAMES = {"imx708": "Camera Module 3", "imx708_noir": "Camera Module 3 NoIR",
             "imx708_wide": "Camera Module 3 Wide", "imx708_wide_noir": "Camera Module 3 Wide NoIR",
             "imx219": "Camera Module v2", "imx219_noir": "Camera Module v2 NoIR", "ov5647": "Camera Module v1",
             "imx477": "HQ Camera", "imx296": "Global Shutter Camera", "imx500": "AI Camera"}
CSI_SIZE = (1536, 864)        # وضع Camera Module 3 السريع: الصورة كاملة على 120 صورة/ثانية
TRACK_W = 960                 # المتابعة على نسخة مصغّرة (أخف على المعالج ونفس ضبط المتابعة)
_csi = {"t": -99.0, "list": []}


def list_csi():
    """كاميرات الشريط الموصولة بالراسبيري: [{id: csi-0, dev: csi:0, name}] — مخزّنة ١٠ ثواني."""
    if time.monotonic() - _csi["t"] < 10:
        return [dict(c) for c in _csi["list"]]
    out, txt = [], ""
    exe = shutil.which("rpicam-hello") or shutil.which("libcamera-hello")
    try:
        if exe:
            p = subprocess.run([exe, "--list-cameras"], capture_output=True, text=True, timeout=8)
            txt = (p.stdout or "") + (p.stderr or "")
            for m in re.finditer(r"^\s*(\d+)\s*:\s*([A-Za-z0-9_]+)\s*\[", txt, re.M):
                out.append((int(m.group(1)), m.group(2)))
        else:
            code = ("import json\nfrom picamera2 import Picamera2\n"
                    "print(json.dumps([[c.get('Num', i), c.get('Model', '')] for i, c in enumerate(Picamera2.global_camera_info())]))")
            p = subprocess.run(["python3", "-c", code], capture_output=True, text=True, timeout=12)
            out = [tuple(x) for x in json.loads((p.stdout or "[]").strip().splitlines()[-1] or "[]")]
    except Exception:  # noqa
        out = []
    lst = [{"id": "csi-%d" % n, "dev": "csi:%d" % n, "vidpid": "csi", "model": mdl,
            "name": "Raspberry Pi " + CSI_NAMES.get(mdl, "Camera (%s)" % mdl)} for n, mdl in out]
    _csi.update(t=time.monotonic(), list=lst)
    return [dict(c) for c in lst]


class CsiCap:
    """نفس واجهة cv2.VideoCapture تقريباً، بس للكاميرا الي بالشريط (picamera2)."""

    def __init__(self, num):
        self.cam, self.err = None, ""
        try:
            from picamera2 import Picamera2
        except Exception:  # noqa
            self.err = "مكتبة picamera2 مو مثبتة (sudo apt install python3-picamera2)"
            return
        try:
            cam = Picamera2(num)
            cfg = cam.create_video_configuration(main={"size": CSI_SIZE, "format": "YUV420"}, buffer_count=4,
                                                 controls={"FrameDurationLimits": (8333, 8333)})
            cam.configure(cfg)
            cam.start()
            try:
                cam.set_controls({"AfMode": 2})       # تركيز تلقائي مستمر (Camera Module 3)
            except Exception:  # noqa
                pass
            sz = cam.camera_configuration()["main"]["size"]
            self.W, self.H = int(sz[0]), int(sz[1])
            self.cam = cam
        except Exception as e:  # noqa
            self.err = "تعذر فتح كاميرا الشريط: %s" % str(e)[:120]
            try:
                cam.close()
            except Exception:  # noqa
                pass

    def isOpened(self):
        return self.cam is not None

    def set(self, *a):
        return False

    def read(self):
        try:
            return True, self.cam.capture_array("main")
        except Exception:  # noqa
            return False, None

    def gray(self, a):
        y = a[:self.H, :self.W]
        return cv2.resize(y, (TRACK_W, round(TRACK_W * self.H / self.W)), interpolation=cv2.INTER_AREA)

    def bgr(self, a):
        return cv2.cvtColor(a[:self.H * 3 // 2, :self.W], cv2.COLOR_YUV2BGR_I420)

    def native(self):
        return (self.W, self.H)

    def release(self):
        try:
            self.cam.stop()
            self.cam.close()
        except Exception:  # noqa
            pass


# ------------------------------------------------------------------ المحرّك
class CamAssist:
    def __init__(self):
        self.lock = threading.Lock()
        self.cond = threading.Condition(self.lock)
        self.cfg = self._load()
        self.thread = None
        self.running = False
        self.err = ""
        self.gray = None
        self.fts = 0.0
        self.fseq = 0
        self.fps = 0.0
        self.size = (0, 0)
        self.jpeg = None
        self.want_preview = 0.0
        self.base = None
        self.calib = []
        self.H = self.Hi = None
        self._set_h(self.cfg.get("H"))
        # المتابعة
        self.active = False
        self.anchor = None          # (x, y) نسبة من الشاشة
        self.anchor_new = False
        self.pts = None
        self.c0 = None
        self.acc = None
        self.prev = None
        self.ev = None
        self.eseq = 0

    # -- الإعدادات
    def _load(self):
        try:
            with open(CFG_PATH, encoding="utf-8") as f:
                return json.load(f)
        except (OSError, ValueError):
            return {"enabled": False, "id": None, "H": None}

    def _save(self):
        os.makedirs(os.path.dirname(CFG_PATH), exist_ok=True)
        tmp = CFG_PATH + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(self.cfg, f)
        os.replace(tmp, CFG_PATH)

    def _set_h(self, H):
        self.H = self.Hi = None
        if H and HAVE_CV:
            try:
                self.H = np.array(H, dtype=np.float64).reshape(3, 3)
                self.Hi = np.linalg.inv(self.H)
            except Exception:   # noqa
                self.H = self.Hi = None

    def status(self):
        cams = list_cameras()
        cur = next((c for c in cams if c["id"] == self.cfg.get("id")), None)
        return {"cv": HAVE_CV, "cams": cams, "enabled": bool(self.cfg.get("enabled")), "id": self.cfg.get("id"),
                "connected": bool(cur), "name": cur["name"] if cur else None, "running": self.running,
                "fps": round(self.fps, 1), "size": list(self.size), "calibrated": self.H is not None,
                "calibId": self.cfg.get("calibId"), "error": self.err}

    def configure(self, enabled=None, cid=None):
        if cid is not None and cid != self.cfg.get("id"):
            self.cfg["id"] = cid or None
            if self.cfg.get("calibId") != cid:      # كاميرا ثانية = معايرة جديدة
                self.cfg["H"] = None
                self._set_h(None)
        if enabled is not None:
            self.cfg["enabled"] = bool(enabled)
        self._save()
        self.restart()
        return self.status()

    # -- التشغيل
    def restart(self):
        self.stop()
        if self.cfg.get("enabled") and self.cfg.get("id"):
            self.start()

    def ensure(self):
        """تشغيل مؤقت (للمعاينة/المعايرة) حتى لو مو مفعّلة."""
        if not self.running and self.cfg.get("id"):
            self.start()

    def start(self):
        if not HAVE_CV:
            self.err = "OpenCV مو مثبتة"
            return
        cam = next((c for c in list_cameras() if c["id"] == self.cfg.get("id")), None)
        if not cam:
            self.err = "الكاميرا مو موصولة"
            return
        self.err = ""
        self.running = True
        self.thread = threading.Thread(target=self._loop, args=(cam["dev"], cam.get("vidpid", "")), daemon=True)
        self.thread.start()

    def stop(self):
        self.running = False
        t = self.thread
        if t and t.is_alive() and t is not threading.current_thread():
            t.join(timeout=2)
        self.thread = None

    def _open(self, dev, vidpid=""):
        if dev.startswith("csi:"):
            return CsiCap(int(dev[4:] or 0))
        cap = cv2.VideoCapture(dev, cv2.CAP_V4L2)
        if not cap.isOpened():
            cap = cv2.VideoCapture(int(re.sub(r"\D", "", dev) or 0))
        if vidpid not in PS3_EYE:                      # PS3 Eye ما تدعم MJPG: YUYV خام 640x480 على 60 صورة/ثانية
            cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*"MJPG"))
        w, h = HD60.get(vidpid, (640, 480))
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, w)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, h)
        cap.set(cv2.CAP_PROP_FPS, 60)
        try:
            cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)        # أحدث إطار دائماً، بدون طابور
        except Exception:   # noqa
            pass
        return cap

    def _loop(self, dev, vidpid=""):
        cap = self._open(dev, vidpid)
        if not cap.isOpened():
            self.err = getattr(cap, "err", "") or "تعذر فتح الكاميرا"
            self.running = False
            return
        csi = hasattr(cap, "gray")
        jlast = 0.0
        t_last, n = time.monotonic(), 0
        try:
            while self.running:
                ok, fr = cap.read()
                if not ok:
                    self.err = "الكاميرا وقفت"
                    time.sleep(0.2)
                    continue
                now = time.monotonic()
                if csi:
                    g = cap.gray(fr)
                else:
                    g = cv2.cvtColor(fr, cv2.COLOR_BGR2GRAY)
                    if g.shape[1] > TRACK_W:                     # 720p → نسخة مصغّرة للمتابعة
                        g = cv2.resize(g, (TRACK_W, round(TRACK_W * g.shape[0] / g.shape[1])), interpolation=cv2.INTER_AREA)
                n += 1
                if now - t_last >= 1:
                    self.fps, n, t_last = n / (now - t_last), 0, now
                with self.cond:
                    self.prev, self.gray, self.fts = self.gray, g, now
                    self.fseq += 1
                    self.size = cap.native() if csi else (fr.shape[1], fr.shape[0])
                    self.cond.notify_all()
                if now - self.want_preview < 3 and now - jlast >= 1 / 30:     # المعاينة ٣٠ صورة/ثانية تكفي
                    jlast = now
                    img = cap.bgr(fr) if csi else fr
                    if img.shape[1] > 1280:
                        img = cv2.resize(img, (1280, round(1280 * img.shape[0] / img.shape[1])), interpolation=cv2.INTER_AREA)
                    ok2, jp = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 80])
                    if ok2:
                        self.jpeg = jp.tobytes()
                if not self.cfg.get("enabled") and self.base is None and now - self.want_preview > 12:
                    break                                   # ما أحد يشوف المعاينة ولا مساعدة الكاميرا شغالة → نفصل الكاميرا
                if self.active and self.H is not None:
                    self._track(g, now)
        finally:
            cap.release()
            self.running = False

    def wait_frame(self, after_seq, timeout=1.5):
        end = time.monotonic() + timeout
        with self.cond:
            while self.fseq <= after_seq and time.monotonic() < end:
                self.cond.wait(timeout=0.1)
            return self.fseq, (None if self.gray is None else self.gray.copy())

    def preview(self):
        self.want_preview = time.monotonic()
        self.ensure()
        return self.jpeg

    # -- المعايرة: الشاشة تعرض نقطة بيضاء وحدة بكل مرة على خلفية سودة
    def calib_begin(self):
        self.ensure()
        if not self.running:
            raise RuntimeError(self.err or "الكاميرا مو شغالة")
        frames = []
        seq = self.fseq
        for _ in range(4):
            seq, g = self.wait_frame(seq)
            if g is not None:
                frames.append(g.astype(np.float32))
        if not frames:
            raise RuntimeError("ما وصلت صورة من الكاميرا")
        self.base = sum(frames) / len(frames)
        self.calib = []
        return {"ok": True}

    def calib_point(self, x, y):
        if self.base is None:
            raise RuntimeError("ابدأ المعايرة أولاً")
        seq = self.fseq
        acc = []
        for _ in range(3):
            seq, g = self.wait_frame(seq)
            if g is not None:
                acc.append(g.astype(np.float32))
        if not acc:
            raise RuntimeError("ما وصلت صورة من الكاميرا")
        diff = np.clip(sum(acc) / len(acc) - self.base, 0, 255).astype(np.uint8)
        diff = cv2.GaussianBlur(diff, (9, 9), 0)
        mx = float(diff.max())
        if mx < 25:
            return {"found": False, "strength": mx}
        _, th = cv2.threshold(diff, max(20, mx * 0.5), 255, cv2.THRESH_BINARY)
        cnts, _ = cv2.findContours(th, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if not cnts:
            return {"found": False, "strength": mx}
        c = max(cnts, key=cv2.contourArea)
        m = cv2.moments(c)
        if m["m00"] <= 0:
            return {"found": False, "strength": mx}
        cx, cy = m["m10"] / m["m00"], m["m01"] / m["m00"]
        self.calib.append(((cx, cy), (float(x), float(y))))
        return {"found": True, "cam": [round(cx, 1), round(cy, 1)], "strength": mx}

    def calib_finish(self):
        if len(self.calib) < 4:
            raise RuntimeError("النقاط اللي انشافت قليلة — قرّب الكاميرا أو خفف الإضاءة")
        src = np.array([c for c, _ in self.calib], dtype=np.float64)
        dst = np.array([s for _, s in self.calib], dtype=np.float64) * 1000.0
        H, mask = cv2.findHomography(src, dst, cv2.RANSAC, 25.0)
        if H is None:
            raise RuntimeError("تعذر حساب المعايرة")
        # نحوّل لإحداثيات نسبية (٠–١) للشاشة
        Hn = np.diag([1 / 1000.0, 1 / 1000.0, 1.0]) @ H
        proj = cv2.perspectiveTransform(src.reshape(-1, 1, 2), Hn).reshape(-1, 2)
        err = float(np.mean(np.linalg.norm(proj - dst / 1000.0, axis=1)))
        self.cfg["H"] = Hn.tolist()
        self.cfg["calibId"] = self.cfg.get("id")
        self._set_h(self.cfg["H"])
        self._save()
        self.base = None
        return {"ok": True, "points": len(self.calib), "used": int(mask.sum()) if mask is not None else len(self.calib),
                "error": round(err, 4)}

    # -- المتابعة
    def touch(self, phase, x=None, y=None):
        with self.lock:
            if phase == "down":
                self.active, self.anchor, self.anchor_new = True, (float(x), float(y)), True
                self.pts = None
            elif phase == "move" and self.active:
                self.anchor, self.anchor_new = (float(x), float(y)), True
            elif phase == "up":
                self.active, self.pts = False, None
                self._emit({"up": 1})
        return {"ok": True}

    def _to_cam(self, p):
        v = self.Hi @ np.array([p[0], p[1], 1.0])
        return v[:2] / v[2]

    def _to_scr(self, c):
        v = self.H @ np.array([c[0], c[1], 1.0])
        return v[:2] / v[2]

    def _seed(self, g, c):
        h, w = g.shape
        r = 48
        x0, y0, x1, y1 = int(max(0, c[0] - r)), int(max(0, c[1] - r)), int(min(w, c[0] + r)), int(min(h, c[1] + r))
        if x1 - x0 < 8 or y1 - y0 < 8:
            return None
        p = cv2.goodFeaturesToTrack(g[y0:y1, x0:x1], 40, 0.01, 4)
        if p is None:
            return None
        return (p + np.array([[x0, y0]], dtype=np.float32)).astype(np.float32)

    def _track(self, g, now):
        with self.lock:
            if self.anchor_new or self.pts is None:
                self.c0 = self._to_cam(self.anchor)
                self.acc = np.zeros(2)
                self.pts = self._seed(g, self.c0)
                self.anchor_new = False
                return
            prev, pts = self.prev, self.pts
        if prev is None or pts is None or len(pts) < 3:
            with self.lock:
                self.pts = self._seed(g, self.c0 + self.acc)
            return
        nxt, st, _ = cv2.calcOpticalFlowPyrLK(prev, g, pts, None, winSize=(15, 15), maxLevel=2,
                                              criteria=(cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 10, 0.03))
        if nxt is None:
            return
        ok = st.reshape(-1) == 1
        d = (nxt - pts).reshape(-1, 2)[ok]
        mag = np.linalg.norm(d, axis=1)
        moving = d[mag > 0.6]                       # الخلفية والحبر ثابتين — نتبع بس الي يتحرك (اليد/القلم)
        with self.lock:
            if not self.active or self.anchor_new:
                return
            if len(moving) >= 3:
                self.acc = self.acc + np.median(moving, axis=0)
                s = self._to_scr(self.c0 + self.acc)
                if -0.05 <= s[0] <= 1.05 and -0.05 <= s[1] <= 1.05:
                    self._emit({"x": round(float(s[0]), 5), "y": round(float(s[1]), 5), "t": round(now, 4)})
            self.pts = nxt.reshape(-1, 1, 2)[ok].astype(np.float32)

    def _emit(self, ev):
        self.eseq += 1
        ev["seq"] = self.eseq
        self.ev = ev
        self.cond.notify_all()

    def wait_event(self, after, timeout=15):
        end = time.monotonic() + timeout
        with self.cond:
            while self.eseq <= after and time.monotonic() < end:
                self.cond.wait(timeout=0.5)
            return self.eseq, (self.ev if self.eseq > after else None)


ENGINE = None


def engine():
    global ENGINE
    if ENGINE is None:
        ENGINE = CamAssist()
        if ENGINE.cfg.get("enabled"):
            ENGINE.restart()
    return ENGINE


if __name__ == "__main__":
    print(json.dumps(list_cameras(), ensure_ascii=False, indent=1))
    print("OpenCV:", HAVE_CV)
