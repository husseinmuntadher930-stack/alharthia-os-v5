#!/usr/bin/env python3
"""
Alharthia OS — طبقة الكتابة السريعة (fast ink overlay).

المشكلة: نقطة اللمس تمر بمحطات كثيرة قبل ما تنرسم (الكيرنل ← labwc ← محرك الواجهة
← كود السبورة ← تجميع الصورة ← labwc ← الشاشة)، فالخط يطلع متأخر ورا الإصبع.

الحل: هذا البرنامج يقرأ اللمس من الكيرنل مباشرة (/dev/input/event*) ويرسم «الحبر الطري»
— آخر قطعة صغيرة من الخط — على طبقة شفافة فوق كل شي (layer-shell). السبورة تكمل
ترسم الخط الحقيقي اللي ينحفظ، والقطعة المؤقتة تختفي بعد ما يلحكها الخط الحقيقي.

- ما يمسك اللمس (ما يسوي grab) ولا يستقبل نقرات: اللمس يوصل للواجهة عادي.
- الواجهة تخبره (عن طريق الخدمة) وين مسموح يرسم، باللون والسُمك، ومتى يوقف.
- الإحداثيات كلها نسبة من الشاشة (0..1) حتى ما تهم الدقة أو التكبير.
"""
import fcntl
import glob
import json
import os
import select
import struct
import sys
import threading
import time

CACHE = os.path.join(os.path.expanduser("~"), ".cache", "alharthia")
STATE = os.path.join(CACHE, "ink-state.json")      # تكتبه الخدمة من الواجهة
LAST = os.path.join(CACHE, "ink-last.json")        # آخر لمسات (للمعايرة التلقائية)
STATUS = os.path.join(CACHE, "ink-status.json")    # حالة البرنامج للإعدادات
FOCUS_FILE = os.path.join(CACHE, "shell-focus")    # يكتبه alharthia_host.py

# ---------------------------------------------------------------- evdev بدون مكتبات
EV_SYN, EV_KEY, EV_ABS = 0, 1, 3
SYN_REPORT, SYN_DROPPED = 0, 3
BTN_TOUCH = 0x14A
ABS_X, ABS_Y = 0x00, 0x01
ABS_MT_SLOT, ABS_MT_POSITION_X, ABS_MT_POSITION_Y, ABS_MT_TRACKING_ID = 0x2F, 0x35, 0x36, 0x39
EVENT = struct.Struct("llHHi")                      # struct input_event على 64-bit


def _ioc(d, t, nr, size):
    return (d << 30) | (size << 16) | (ord(t) << 8) | nr


def EVIOCGNAME(n):
    return _ioc(2, "E", 0x06, n)


def EVIOCGBIT(ev, n):
    return _ioc(2, "E", 0x20 + ev, n)


def EVIOCGABS(code):
    return _ioc(2, "E", 0x40 + code, 24)


def _bit(buf, n):
    return bool(buf[n // 8] & (1 << (n % 8)))


def probe(path):
    """جهاز لمس؟ يرجّع {path, name, mt, rx, ry} أو None."""
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NONBLOCK)
    except OSError:
        return None
    try:
        name = bytearray(256)
        try:
            fcntl.ioctl(fd, EVIOCGNAME(256), name)
        except OSError:
            pass
        name = bytes(name).split(b"\0")[0].decode("utf-8", "replace")
        absb, keyb = bytearray(8), bytearray(96)
        fcntl.ioctl(fd, EVIOCGBIT(EV_ABS, 8), absb)
        try:
            fcntl.ioctl(fd, EVIOCGBIT(EV_KEY, 96), keyb)
        except OSError:
            pass
        mt = _bit(absb, ABS_MT_POSITION_X) and _bit(absb, ABS_MT_POSITION_Y)
        st = _bit(absb, ABS_X) and _bit(absb, ABS_Y) and _bit(keyb, BTN_TOUCH)
        if not (mt or st):
            return None
        cx, cy = (ABS_MT_POSITION_X, ABS_MT_POSITION_Y) if mt else (ABS_X, ABS_Y)
        rng = []
        for c in (cx, cy):
            ai = bytearray(24)
            fcntl.ioctl(fd, EVIOCGABS(c), ai)
            _v, mn, mx = struct.unpack_from("iii", ai)
            rng.append((mn, mx if mx > mn else mn + 1))
        return {"path": path, "name": name, "mt": mt, "rx": rng[0], "ry": rng[1]}
    except OSError:
        return None
    finally:
        os.close(fd)


def find_touch():
    return [d for d in (probe(p) for p in sorted(glob.glob("/dev/input/event*"))) if d]


# ---------------------------------------------------------------- المنطق (بدون واجهة — ينفحص لوحده)
def load_json(path, default):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def write_json(path, data):
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f)
        os.replace(tmp, path)
    except OSError:
        pass


def _inside(r, x, y):
    return r[0] <= x <= r[2] and r[1] <= y <= r[3]


class InkCore:
    """يحوّل أحداث اللمس الخام لـ«حبر طري». كل الإحداثيات نسبة 0..1 من الشاشة."""

    def __init__(self, dev, clock=time.monotonic, wall=time.time):
        self.dev, self.clock, self.wall = dev, clock, wall
        self.state = {"on": False}
        self.slots, self.slot = {}, 0
        self.st_touch, self.st_xy = False, [0, 0]
        self.stroke = None          # [(x, y, t), ...]
        self.spoiled = False        # إصبعين = تكبير/تحريك، مو كتابة
        self.ignore = False         # اللمسة بدت بمكان ممنوع
        self.ended = 0.0
        self.count = 0
        self.downs = []
        self.cancel_seen = None
        self.dirty = False

    # -- إعدادات من الواجهة
    def set_state(self, st):
        st = st or {}
        c = st.get("cancel")
        if self.cancel_seen is not None and c != self.cancel_seen and self.stroke:
            self.stroke, self.ignore, self.dirty = None, True, True   # الواجهة قررت: هاي اللمسة مو كتابة
        self.cancel_seen = c
        if not st.get("on"):
            if self.stroke:
                self.dirty = True
            self.stroke = None
        self.state = st

    def norm(self, x, y):
        (x0, x1), (y0, y1) = self.dev["rx"], self.dev["ry"]
        nx, ny = (x - x0) / (x1 - x0), (y - y0) / (y1 - y0)
        cal = self.state.get("cal") or {}
        if cal.get("swap"):
            nx, ny = ny, nx
        return nx * cal.get("ax", 1.0) + cal.get("bx", 0.0), ny * cal.get("ay", 1.0) + cal.get("by", 0.0), nx, ny

    def allowed(self, x, y, focused=True):
        s = self.state
        if not (s.get("on") and focused and (s.get("cal") or {}).get("ok")):
            return False
        r = s.get("rect")
        if not r or not _inside(r, x, y):
            return False
        return not any(_inside(d, x, y) for d in s.get("deny") or [])

    # -- أحداث الكيرنل
    def event(self, typ, code, val, focused=True):
        if typ == EV_ABS:
            if code == ABS_MT_SLOT:
                self.slot = val
            elif code == ABS_MT_TRACKING_ID:
                s = self.slots.setdefault(self.slot, {"id": -1, "x": 0, "y": 0})
                s["id"] = val
            elif code == ABS_MT_POSITION_X:
                self.slots.setdefault(self.slot, {"id": -1, "x": 0, "y": 0})["x"] = val
            elif code == ABS_MT_POSITION_Y:
                self.slots.setdefault(self.slot, {"id": -1, "x": 0, "y": 0})["y"] = val
            elif code == ABS_X and not self.dev["mt"]:
                self.st_xy[0] = val
            elif code == ABS_Y and not self.dev["mt"]:
                self.st_xy[1] = val
        elif typ == EV_KEY and code == BTN_TOUCH and not self.dev["mt"]:
            self.st_touch = bool(val)
        elif typ == EV_SYN and code == SYN_REPORT:
            self.frame(focused)

    def frame(self, focused=True):
        if self.dev["mt"]:
            act = [s for s in self.slots.values() if s["id"] >= 0]
        else:
            act = [{"x": self.st_xy[0], "y": self.st_xy[1]}] if self.st_touch else []
        n, prev = len(act), self.count
        self.count = n
        now = self.clock()
        if n == 0:
            if self.stroke:
                self.ended, self.dirty = now, True
            self.spoiled = self.ignore = False
            return
        if n >= 2:
            if self.stroke:
                self.stroke, self.dirty = None, True
            self.spoiled = True
            return
        x, y, rx, ry = self.norm(act[0]["x"], act[0]["y"])
        if prev == 0:                                   # لمسة جديدة
            self.downs = (self.downs + [[round(rx, 5), round(ry, 5), round(self.wall(), 3)]])[-6:]
            write_json(LAST, {"downs": self.downs})
            self.stroke, self.ended = None, 0.0
            self.ignore = not self.allowed(x, y, focused)
            if not self.ignore:
                self.stroke = [(x, y, now)]
                self.dirty = True
            return
        if self.spoiled or self.ignore or not self.stroke:
            return
        lx, ly, _ = self.stroke[-1]
        if abs(x - lx) + abs(y - ly) > 1e-5:
            self.stroke.append((x, y, now))
            if len(self.stroke) > 400:
                del self.stroke[:200]
            self.dirty = True

    def tail(self):
        """النقاط اللي لازم تنرسم هسه (آخر tail ms من الخط)."""
        st = self.stroke
        if not st:
            return []
        now = self.clock()
        win = max(0.03, min(0.4, (self.state.get("tail") or 110) / 1000.0))
        if self.ended:
            if now - self.ended > win:
                self.stroke = None
                return []
            cut = self.ended - win
        else:
            cut = now - win
        i = len(st) - 1
        while i > 0 and st[i - 1][2] >= cut:
            i -= 1
        return st[max(0, i - 1):]


# ---------------------------------------------------------------- القراءة من الكيرنل
class Reader(threading.Thread):
    def __init__(self, on_change):
        super().__init__(daemon=True)
        self.on_change = on_change
        self.cores = {}
        self.state = {"on": False}
        self.focused = True

    def set_state(self, st):
        self.state = st
        for c in list(self.cores.values()):
            c.set_state(st)

    def run(self):
        fds = {}
        last_scan = 0
        while True:
            if not fds or time.monotonic() - last_scan > 10:
                last_scan = time.monotonic()
                for d in find_touch():
                    if d["path"] in [c.dev["path"] for c in self.cores.values()]:
                        continue
                    try:
                        fd = os.open(d["path"], os.O_RDONLY | os.O_NONBLOCK)
                    except OSError:
                        continue
                    core = InkCore(d)
                    core.set_state(self.state)
                    self.cores[fd], fds[fd] = core, True
                write_json(STATUS, {"pid": os.getpid(), "t": time.time(),
                                    "devices": [c.dev["name"] for c in self.cores.values()]})
            if not fds:
                time.sleep(2)
                continue
            r, _, _ = select.select(list(fds), [], [], 1.0)
            for fd in r:
                core = self.cores[fd]
                try:
                    data = os.read(fd, EVENT.size * 64)
                except OSError:
                    os.close(fd)
                    del fds[fd], self.cores[fd]
                    continue
                for off in range(0, len(data) - EVENT.size + 1, EVENT.size):
                    _s, _u, typ, code, val = EVENT.unpack_from(data, off)
                    core.event(typ, code, val, self.focused)
                if core.dirty:
                    core.dirty = False
                    self.on_change(core)


def shell_focused():
    """الواجهة قدّام؟ (None = ما نعرف → نعتبرها قدّام)"""
    try:
        if time.time() - os.path.getmtime(FOCUS_FILE) > 15:
            return True
        with open(FOCUS_FILE) as f:
            return f.read().strip() == "1"
    except OSError:
        return True


# ---------------------------------------------------------------- الطبقة الشفافة (GTK + layer-shell)
def main():
    import gi
    gi.require_version("Gtk", "3.0")
    gi.require_version("GtkLayerShell", "0.1")
    from gi.repository import Gtk, Gdk, GLib, GtkLayerShell
    import cairo

    win = Gtk.Window()
    win.set_app_paintable(True)
    vis = win.get_screen().get_rgba_visual()
    if vis:
        win.set_visual(vis)
    GtkLayerShell.init_for_window(win)
    GtkLayerShell.set_layer(win, GtkLayerShell.Layer.OVERLAY)
    GtkLayerShell.set_namespace(win, "alharthia-ink")
    for edge in (GtkLayerShell.Edge.TOP, GtkLayerShell.Edge.BOTTOM, GtkLayerShell.Edge.LEFT, GtkLayerShell.Edge.RIGHT):
        GtkLayerShell.set_anchor(win, edge, True)
    GtkLayerShell.set_exclusive_zone(win, -1)
    if hasattr(GtkLayerShell, "set_keyboard_mode"):
        GtkLayerShell.set_keyboard_mode(win, GtkLayerShell.KeyboardMode.NONE)
    else:
        GtkLayerShell.set_keyboard_interactivity(win, False)

    st = {"core": None, "box": None, "mtime": 0, "state": {"on": False}}

    def click_through(*_):
        win.input_shape_combine_region(cairo.Region())   # ما يستقبل أي لمس — كلشي يعبر للي تحته

    win.connect("realize", click_through)
    win.connect("size-allocate", click_through)

    def on_draw(_w, cr):
        cr.set_operator(cairo.OPERATOR_SOURCE)
        cr.set_source_rgba(0, 0, 0, 0)
        cr.paint()
        core = st["core"]
        pts = core.tail() if core else []
        if len(pts) < 1:
            return False
        W, H = win.get_allocated_width(), win.get_allocated_height()
        s = st["state"]
        c = s.get("color") or "#111827"
        try:
            r, g, b = (int(c[i:i + 2], 16) / 255 for i in (1, 3, 5))
        except ValueError:
            r = g = b = 0
        cr.set_operator(cairo.OPERATOR_OVER)
        cr.set_source_rgba(r, g, b, 1)
        cr.set_line_width(max(1.5, (s.get("width") or 0.003) * W))
        cr.set_line_cap(cairo.LINE_CAP_ROUND)
        cr.set_line_join(cairo.LINE_JOIN_ROUND)
        cr.move_to(pts[0][0] * W, pts[0][1] * H)
        for x, y, _t in pts[1:]:
            cr.line_to(x * W, y * H)
        if len(pts) == 1:
            cr.line_to(pts[0][0] * W + 0.1, pts[0][1] * H)
        cr.stroke()
        return False

    win.connect("draw", on_draw)

    def redraw():
        """نرسم بس المنطقة اللي تغيّرت (أخف على الشاشة)."""
        core = st["core"]
        W, H = win.get_allocated_width(), win.get_allocated_height()
        pts = core.tail() if core else []
        pad = max(4, (st["state"].get("width") or 0.003) * W) + 4
        box = None
        if pts:
            xs, ys = [p[0] * W for p in pts], [p[1] * H for p in pts]
            box = (min(xs) - pad, min(ys) - pad, max(xs) + pad, max(ys) + pad)
        old, st["box"] = st["box"], box
        for b in (old, box):
            if b:
                win.queue_draw_area(int(b[0]), int(b[1]), int(b[2] - b[0]) + 2, int(b[3] - b[1]) + 2)
        if core and core.stroke and core.ended:
            GLib.timeout_add(16, lambda: (redraw(), False)[1])
        return False

    def on_change(core):
        st["core"] = core
        GLib.idle_add(redraw)

    reader = Reader(on_change)

    def poll():
        try:
            m = os.path.getmtime(STATE)
        except OSError:
            m = 0
        if m != st["mtime"]:
            st["mtime"] = m
            s = load_json(STATE, {"on": False})
            st["state"] = s
            reader.set_state(s)
            redraw()
            want = bool(s.get("on"))
            if want and not win.get_visible():
                win.show_all()
                click_through()
            elif not want and win.get_visible():
                win.hide()
        reader.focused = shell_focused()
        return True

    GLib.timeout_add(80, poll)
    reader.start()
    poll()
    Gtk.main()


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(0)
