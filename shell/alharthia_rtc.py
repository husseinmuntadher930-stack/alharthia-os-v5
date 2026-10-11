#!/usr/bin/env python3
"""
AlharthiaOS — ساعة DS1302 (قطعة RTC ببطارية CR2032) للراسبيري 5.

الفكرة: الصبورة تعرف الوقت حتى لو طفت وماكو إنترنت (مهم لجدول الحصص والعد التنازلي).
- عند التشغيل: إذا ماكو إنترنت (الساعة مو متزامنة)، ناخذ الوقت من القطعة ونضبط ساعة النظام.
- لمن يجي إنترنت: نكتب الوقت الصحيح على القطعة (كل ٣٠ دقيقة).
- الوقت يتخزن بالقطعة بتوقيت UTC.

التوصيل (أرقام الدبابيس بالراسبيري 5):
    VCC2 → دبوس 17 (3.3V)       GND  → دبوس 14
    SCLK → دبوس 11 (GPIO17)     I/O  → دبوس 13 (GPIO27)
    RST  → دبوس 15 (GPIO22)     VCC1 → لا توصله (هو البطارية)

الاستعمال:
    sudo python3 alharthia_rtc.py read      ← يقرا الوقت من القطعة
    sudo python3 alharthia_rtc.py write     ← يكتب وقت النظام على القطعة
    sudo python3 alharthia_rtc.py daemon    ← الخدمة (systemd)
"""
import calendar
import json
import os
import subprocess
import sys
import time

PIN_CLK, PIN_IO, PIN_CE = 17, 27, 22
STATUS = "/run/alharthia-rtc.json"


def bcd2i(b):
    return (b >> 4) * 10 + (b & 0x0F)


def i2bcd(v):
    return ((v // 10) << 4) | (v % 10)


def encode(t):
    """struct_time (UTC) → ٨ بايتات لأمر الكتابة المتتالية (burst)."""
    wd = (t.tm_wday + 1) % 7 + 1          # الأحد=1 … السبت=7
    return [i2bcd(t.tm_sec) & 0x7F, i2bcd(t.tm_min), i2bcd(t.tm_hour) & 0x3F,     # 24 ساعة، والساعة شغالة (CH=0)
            i2bcd(t.tm_mday), i2bcd(t.tm_mon), wd, i2bcd(t.tm_year % 100), 0x00]


def decode(b):
    """٨ بايتات → وقت UTC (ثواني) أو None إذا القطعة مو موجودة / الوقت خربان."""
    if len(b) < 7 or all(x == 0xFF for x in b[:7]) or all(x == 0 for x in b[:7]):
        return None
    if b[0] & 0x80:                       # CH: الساعة واكفة (أول مرة، أو البطارية خلصت)
        return None
    if b[2] & 0x80:                       # نظام ١٢ ساعة
        h = bcd2i(b[2] & 0x1F) % 12 + (12 if b[2] & 0x20 else 0)
    else:
        h = bcd2i(b[2] & 0x3F)
    s, m = bcd2i(b[0] & 0x7F), bcd2i(b[1] & 0x7F)
    d, mo, y = bcd2i(b[3] & 0x3F), bcd2i(b[4] & 0x1F), 2000 + bcd2i(b[6])
    if not (0 <= s < 60 and 0 <= m < 60 and 0 <= h < 24 and 1 <= d <= 31 and 1 <= mo <= 12 and 2024 <= y <= 2099):
        return None
    try:
        return calendar.timegm((y, mo, d, h, m, s, 0, 0, 0))
    except (ValueError, OverflowError):
        return None


class DS1302:
    """بروتوكول ٣ أسلاك (مو I2C) — نحرّك الدبابيس بنفسنا عن طريق lgpio."""

    def __init__(self, clk=PIN_CLK, io=PIN_IO, ce=PIN_CE):
        import lgpio
        self.g = lgpio
        self.clk, self.io, self.ce = clk, io, ce
        self.h = None
        for chip in (0, 4, 1, 2, 3, 5):   # الراسبيري 5: gpiochip0 (الأنظمة الجديدة) أو gpiochip4 (القديمة)
            try:
                h = lgpio.gpiochip_open(chip)
            except Exception:  # noqa
                continue
            try:
                info = lgpio.gpio_get_chip_info(h)
                _st, lines, _name, lab = info               # (status, lines, name, label)
                lab = str(lab).lower()
                if lines >= 28 and ("rp1" in lab or "bcm2711" in lab or "bcm2835" in lab):
                    self.h = h
                    break
            except Exception:  # noqa
                pass
            lgpio.gpiochip_close(h)
        if self.h is None:
            raise OSError("ما لگيت GPIO")
        lgpio.gpio_claim_output(self.h, self.clk, 0)
        lgpio.gpio_claim_output(self.h, self.ce, 0)
        lgpio.gpio_claim_output(self.h, self.io, 0)
        self.out = True

    def close(self):
        try:
            for p in (self.clk, self.io, self.ce):
                self.g.gpio_free(self.h, p)
            self.g.gpiochip_close(self.h)
        except Exception:  # noqa
            pass

    def _dir(self, out):
        if out != self.out:
            self.g.gpio_free(self.h, self.io)
            if out:
                self.g.gpio_claim_output(self.h, self.io, 0)
            else:
                self.g.gpio_claim_input(self.h, self.io)
            self.out = out

    def _tick(self):
        self.g.gpio_write(self.h, self.clk, 1)
        time.sleep(2e-6)
        self.g.gpio_write(self.h, self.clk, 0)
        time.sleep(2e-6)

    def _wbyte(self, v):
        self._dir(True)
        for _ in range(8):                # البت الأصغر أول
            self.g.gpio_write(self.h, self.io, v & 1)
            time.sleep(1e-6)
            self._tick()
            v >>= 1

    def _rbyte(self):
        self._dir(False)
        v = 0
        for i in range(8):
            v |= (self.g.gpio_read(self.h, self.io) & 1) << i
            self._tick()
        return v

    def _begin(self):
        self.g.gpio_write(self.h, self.clk, 0)
        self.g.gpio_write(self.h, self.ce, 1)
        time.sleep(4e-6)

    def _end(self):
        self.g.gpio_write(self.h, self.ce, 0)
        time.sleep(4e-6)

    def _write_reg(self, addr, val):
        self._begin()
        self._wbyte(addr)
        self._wbyte(val)
        self._end()

    def read_raw(self):
        self._begin()
        self._wbyte(0xBF)                 # قراءة الساعة كلها مرة وحدة
        b = [self._rbyte() for _ in range(8)]
        self._end()
        return b

    def read(self):
        return decode(self.read_raw())

    def write(self, epoch):
        self._write_reg(0x8E, 0x00)       # نشيل حماية الكتابة
        self._write_reg(0x90, 0x00)       # نطفي الشحن — بطارية CR2032 ما تنشحن!
        self._begin()
        self._wbyte(0xBE)                 # كتابة الساعة كلها مرة وحدة
        for x in encode(time.gmtime(int(epoch))):
            self._wbyte(x)
        self._end()
        self._write_reg(0x8E, 0x80)       # نرجّع الحماية


def ntp_synced():
    try:
        r = subprocess.run(["timedatectl", "show", "-p", "NTPSynchronized", "--value"],
                           capture_output=True, text=True, timeout=5)
        return r.stdout.strip() == "yes"
    except (OSError, subprocess.SubprocessError):
        return False


def set_system_time(epoch):
    subprocess.run(["date", "-u", "-s", "@%d" % int(epoch)], capture_output=True, timeout=5)


def status(**kw):
    try:
        with open(STATUS, "w") as f:
            json.dump(dict(kw, t=int(time.time())), f)
    except OSError:
        pass


def log(*a):
    print("rtc:", *a, flush=True)


def daemon():
    try:
        rtc = DS1302()
    except Exception as e:  # noqa
        log("GPIO ما اشتغل:", e)
        status(present=False, error=str(e))
        time.sleep(3600)
        return 1
    # ١) عند التشغيل: ننطي الإنترنت ١٥ ثانية، وإذا ما تزامن ناخذ الوقت من القطعة
    for _ in range(15):
        if ntp_synced():
            break
        time.sleep(1)
    t = rtc.read()
    if t is None:
        log("القطعة مو موصولة، أو وقتها مو مضبوط بعد (يتضبط أول ما يجي إنترنت)")
    elif not ntp_synced():
        set_system_time(t)
        log("ضبطت ساعة النظام من القطعة:", time.strftime("%Y-%m-%d %H:%M:%S UTC", time.gmtime(t)))
    status(present=t is not None, rtc=t, synced=ntp_synced())
    # ٢) كل ما يكون اكو إنترنت: نكتب الوقت الصحيح على القطعة
    last_write = 0
    while True:
        if ntp_synced() and time.time() - last_write > 1800:
            try:
                rtc.write(time.time())
                last_write = time.time()
                back = rtc.read()
                ok = back is not None and abs(back - time.time()) < 5
                log("كتبت الوقت على القطعة" + ("" if ok else " — بس القراءة ما طابقت (تأكد من التوصيل)"))
                status(present=ok, rtc=back, synced=True, written=int(last_write))
            except Exception as e:  # noqa
                log("الكتابة فشلت:", e)
        time.sleep(60)


def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else "read"
    if cmd == "daemon":
        return daemon()
    rtc = DS1302()
    try:
        if cmd == "write":
            rtc.write(time.time())
            print("كتبت:", time.strftime("%Y-%m-%d %H:%M:%S", time.localtime()))
        raw = rtc.read_raw()
        t = decode(raw)
        print("الخام:", " ".join("%02X" % x for x in raw))
        print("وقت القطعة:", time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(t)) if t else "— (مو موصولة أو مو مضبوطة)")
        print("وقت النظام:", time.strftime("%Y-%m-%d %H:%M:%S", time.localtime()))
    finally:
        rtc.close()


if __name__ == "__main__":
    sys.exit(main() or 0)
