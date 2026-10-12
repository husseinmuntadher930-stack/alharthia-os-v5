#!/usr/bin/env python3
"""
AlharthiaOS — تحويل الكلام إلى نص (بدون إنترنت) على الراسبيري 5.

يستعمل whisper.cpp (ينصّبه tools/update-on-pi.sh في /opt/whisper.cpp).
الريموت يسجّل صوت المعلم (WAV 16kHz) ويدزه للصبورة، والصبورة ترجّع النص.
"""
import glob
import os
import re
import struct
import subprocess
import threading
import wave

ROOT = os.environ.get("ALH_WHISPER_DIR", "/opt/whisper.cpp")
MODELS = ["ggml-small-q5_1.bin", "ggml-small.bin", "ggml-base-q5_1.bin", "ggml-base.bin"]
_lock = threading.Lock()


def _binary():
    for name in ("build/bin/whisper-cli", "build/bin/main", "main"):
        p = os.path.join(ROOT, name)
        if os.path.isfile(p) and os.access(p, os.X_OK):
            return p
    return None


def _model():
    for m in MODELS:
        p = os.path.join(ROOT, "models", m)
        if os.path.isfile(p) and os.path.getsize(p) > 10_000_000:
            return p
    extra = sorted(glob.glob(os.path.join(ROOT, "models", "ggml-*.bin")))
    return extra[0] if extra else None


def status():
    b, m = _binary(), _model()
    if not b:
        return {"ready": False, "msg": "برنامج تحويل الكلام مو منصّب — حدّث الصبورة وهي متصلة بالإنترنت"}
    if not m:
        return {"ready": False, "msg": "ملف لغة تحويل الكلام ناقص — حدّث الصبورة وهي متصلة بالإنترنت"}
    return {"ready": True, "model": os.path.basename(m)}


def wav_info(path):
    """(المدة بالثواني، مستوى الصوت 0..1) — حتى ما نرسل صمت لـ whisper (يألف كلام من الصمت)."""
    try:
        with wave.open(path, "rb") as w:
            n, rate, ch, sw = w.getnframes(), w.getframerate(), w.getnchannels(), w.getsampwidth()
            raw = w.readframes(min(n, rate * 120))
    except (wave.Error, OSError, EOFError):
        return 0.0, 0.0
    dur = n / float(rate or 1)
    if sw != 2 or not raw:
        return dur, 1.0
    cnt = len(raw) // 2
    step = max(1, cnt // 20000)
    vals = struct.unpack("<%dh" % cnt, raw[:cnt * 2])[::step]
    peak = max((abs(v) for v in vals), default=0) / 32768.0
    return dur, peak


def clean(text):
    t = re.sub(r"\[[^\]]*\]|\([^)]*\)", " ", text or "")          # [موسيقى] (تصفيق) …
    t = re.sub(r"\s+", " ", t).strip()
    junk = {"شكرا", "شكراً", "شكرا.", "شكراً.", "ترجمة نانسي قنقر", "اشتركوا في القناة"}
    return "" if t in junk else t


# ---- خادم whisper دائم (الموديل يبقى بالذاكرة — أسرع للاستماع المستمر)
SRV_PORT = 8790
_srv = {"p": None, "model": None}


def _server_bin():
    p = os.path.join(ROOT, "build/bin/whisper-server")
    return p if os.path.isfile(p) and os.access(p, os.X_OK) else None


def _port_open():
    import socket
    try:
        with socket.create_connection(("127.0.0.1", SRV_PORT), timeout=0.3):
            return True
    except OSError:
        return False


def _ensure_server(lang):
    import time
    p = _srv["p"]
    if p and p.poll() is None and _port_open():
        return True
    b, m = _server_bin(), _model()
    if not b or not m:
        return False
    if p and p.poll() is None:
        p.kill()
    _srv["p"] = subprocess.Popen([b, "-m", m, "-l", lang, "-t", str(min(4, os.cpu_count() or 4)), "-nt",
                                  "--host", "127.0.0.1", "--port", str(SRV_PORT)],
                                 stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(120):                        # تحميل الموديل أول مرة
        if _port_open():
            return True
        if _srv["p"].poll() is not None:
            return False
        time.sleep(0.25)
    return False


def _via_server(path):
    import http.client
    import json
    import uuid
    bnd = uuid.uuid4().hex
    with open(path, "rb") as f:
        audio = f.read()
    parts = []
    for k, v in (("response_format", "json"), ("temperature", "0.0")):
        parts.append(("--%s\r\nContent-Disposition: form-data; name=\"%s\"\r\n\r\n%s\r\n" % (bnd, k, v)).encode())
    parts.append(("--%s\r\nContent-Disposition: form-data; name=\"file\"; filename=\"a.wav\"\r\n"
                  "Content-Type: audio/wav\r\n\r\n" % bnd).encode() + audio + b"\r\n")
    body = b"".join(parts) + ("--%s--\r\n" % bnd).encode()
    c = http.client.HTTPConnection("127.0.0.1", SRV_PORT, timeout=120)
    c.request("POST", "/inference", body=body, headers={"Content-Type": "multipart/form-data; boundary=" + bnd})
    r = c.getresponse()
    data = r.read().decode("utf-8", "ignore")
    c.close()
    if r.status != 200:
        raise OSError("whisper-server %d" % r.status)
    try:
        return json.loads(data).get("text", "")
    except ValueError:
        return data


def transcribe(path, lang="ar"):
    """يرجّع {'text': …} أو {'error': …}."""
    st = status()
    if not st["ready"]:
        return {"error": st["msg"]}
    dur, peak = wav_info(path)
    if dur < 0.6:
        return {"error": "التسجيل قصير — اضغط وتكلّم"}
    if peak < 0.02:
        return {"error": "ما وصل صوت — تأكد من المايك"}
    if _server_bin():
        with _lock:
            try:
                if _ensure_server(lang):
                    text = clean(_via_server(path))
                    if not text:
                        return {"error": "ما فهمت الكلام — تكلّم أوضح وقرّب المايك"}
                    return {"text": text, "dur": round(dur, 1)}
            except (OSError, ValueError):
                pass                                   # نرجع للطريقة العادية
    args = [_binary(), "-m", _model(), "-f", path, "-l", lang, "-t", str(min(4, os.cpu_count() or 4)),
            "-nt", "-np", "--no-fallback"]
    with _lock:                                   # وحدة وحدة — المعالج يكفي لوحدة بسرعة
        try:
            r = subprocess.run(args, capture_output=True, text=True, timeout=180)
        except subprocess.TimeoutExpired:
            return {"error": "التحويل طوّل — جرّب كلام أقصر"}
        if r.returncode != 0 and "no-fallback" in " ".join(args):
            args.remove("--no-fallback")         # نسخ قديمة ما تعرف هذا الخيار
            r = subprocess.run(args, capture_output=True, text=True, timeout=180)
    if r.returncode != 0:
        return {"error": "ما گدرت أحوّل الكلام: " + (r.stderr or "").strip()[-160:]}
    text = clean(r.stdout)
    if not text:
        return {"error": "ما فهمت الكلام — تكلّم أوضح وقرّب المايك"}
    return {"text": text, "dur": round(dur, 1)}


if __name__ == "__main__":
    import sys
    print(status())
    if len(sys.argv) > 1:
        print(transcribe(sys.argv[1]))
