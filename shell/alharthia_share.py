#!/usr/bin/env python3
"""
Alharthia OS — wireless screen sharing over the classroom Wi-Fi.

Two directions, both through a small web server on the Pi (no app needed):
  * "عرض شاشتي"    : other devices open http://<pi>:8766/?k=KEY and watch this screen.
  * "استقبال شاشة" : a laptop opens the same page, picks "شارك شاشتك" and its screen
                     is shown on the Pi (browser screen capture, frame by frame).

Used by alharthia_server.py; it has no state of its own besides the server thread.
"""
import html, json, os, queue, secrets, shutil, socket, struct, subprocess, threading, time
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler

PORT = int(os.environ.get("ALH_SHARE_PORT", "8766"))
DEVICE_NAME = os.environ.get("ALH_NAME", "شاشة الصف")
FRAME_MIN_MS = 220          # how often the screen is captured at most
VIEWER_TIMEOUT = 8          # seconds without a frame request = viewer left
IN_TIMEOUT = 6              # seconds without an incoming frame = sender stopped

STATE = {
    "srv": None, "thread": None, "on": False, "key": "", "pin": "",
    "viewers": {}, "frame": b"", "frame_t": 0.0, "lock": threading.Lock(),
    "in_frame": b"", "in_t": 0.0, "in_name": "", "quality": 55, "scale": 0.6,
}


# ------------------------------------------------------------------ live H.264 video
def _hls_dir():
    """مجلد مقاطع البث — لازم يكون قابل للكتابة من مستخدم الواجهة (مو /run لأنه للجذر)."""
    import tempfile
    for base in (os.environ.get("XDG_RUNTIME_DIR"), "/dev/shm", tempfile.gettempdir()):
        if not base:
            continue
        d = os.path.join(base, "alharthia-hls")
        try:
            os.makedirs(d, exist_ok=True)
            t = os.path.join(d, ".w")
            open(t, "wb").close()
            os.remove(t)
            return d
        except OSError:
            continue
    return os.path.join(tempfile.gettempdir(), "alharthia-hls")


HLS_DIR = _hls_dir()
VIDEO = {
    "rec": None, "ff": None, "on": False, "init": b"", "clients": set(),
    "lock": threading.Lock(), "err": "", "fps": 30, "height": 720,
}


def video_tools():
    return bool(shutil.which("wf-recorder") and shutil.which("ffmpeg"))


def _read_boxes(pipe):
    """Yields complete top-level MP4 boxes from the ffmpeg pipe."""
    buf = b""
    while True:
        while len(buf) < 8:
            chunk = pipe.read(65536)
            if not chunk:
                return
            buf += chunk
        size = struct.unpack(">I", buf[:4])[0]
        if size < 8 or size > 64 * 1024 * 1024:
            return
        while len(buf) < size:
            chunk = pipe.read(min(1 << 20, size - len(buf)))
            if not chunk:
                return
            buf += chunk
        yield buf[:4 + 4], buf[:size]
        buf = buf[size:]


def _pump():
    """Splits the fragmented MP4 into an init segment + fragments and fans them out."""
    ff = VIDEO["ff"]
    init, pending = b"", b""
    for head, box in _read_boxes(ff.stdout):
        kind = box[4:8]
        if kind in (b"ftyp", b"moov"):
            init += box
            if kind == b"moov":
                VIDEO["init"] = init
            continue
        if kind == b"moof":
            pending = box
            continue
        if kind == b"mdat" and pending:
            frag = pending + box
            pending = b""
            with VIDEO["lock"]:
                dead = []
                for q in VIDEO["clients"]:
                    try:
                        q.put_nowait(frag)
                    except queue.Full:
                        dead.append(q)
                for q in dead:
                    VIDEO["clients"].discard(q)
    VIDEO["on"] = False


def _rec_cmds(fps, h):
    """wf-recorder writing Matroska to stdout — several spellings, most compatible first."""
    core = ["-c", "libx264", "-x", "yuv420p", "-r", str(fps),
            "-p", "preset=ultrafast", "-p", "tune=zerolatency", "-p", "crf=30",
            "-p", "g=" + str(fps), "-F", "scale=-2:%d" % h]
    prof = ["-p", "profile=baseline", "-p", "level=3.1"]
    outs = [["--muxer=matroska", "--file=/dev/stdout"], ["-m", "matroska", "-f", "/dev/stdout"],
            ["-m", "matroska", "-f", "pipe:1"]]
    cmds = []
    for o in outs:
        cmds.append(["wf-recorder"] + o + core + prof)
        cmds.append(["wf-recorder"] + o + core)
    return cmds


def video_start():
    if VIDEO["on"]:
        return True
    if VIDEO.get("rec") or VIDEO.get("ff"):
        video_stop()          # a previous pipeline died — clean it up before starting again
    if not video_tools():
        VIDEO["err"] = "wf-recorder أو ffmpeg غير مثبت"
        return False
    try:
        os.makedirs(HLS_DIR, exist_ok=True)
        for f in os.listdir(HLS_DIR):
            try:
                os.remove(os.path.join(HLS_DIR, f))
            except OSError:
                pass
    except OSError as e:
        VIDEO["err"] = "تعذر تجهيز مجلد البث: %s" % e
        return False
    h, fps = VIDEO["height"], VIDEO["fps"]
    rec = None
    for cmd in _rec_cmds(fps, h):
        try:
            rec = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, bufsize=0)
        except OSError as e:
            VIDEO["err"] = str(e)
            continue
        time.sleep(0.6)
        if rec.poll() is None:
            break
        rec = None
    if rec is None:
        VIDEO["err"] = "تعذر تشغيل wf-recorder (تأكد أن الجلسة Wayland)"
        return False
    try:
        ff = subprocess.Popen(
            ["ffmpeg", "-hide_banner", "-loglevel", "error", "-fflags", "nobuffer", "-i", "pipe:0",
             "-c", "copy", "-map", "0:v", "-f", "tee",
             "[f=mp4:movflags=empty_moov+default_base_moof+frag_keyframe+frag_every_frame]pipe:1|"
             "[f=hls:hls_time=1:hls_list_size=4:hls_flags=delete_segments+independent_segments+omit_endlist]"
             + HLS_DIR + "/live.m3u8"],
            stdin=rec.stdout, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, bufsize=0)
    except OSError as e:
        rec.kill()
        VIDEO["err"] = str(e)
        return False
    VIDEO.update(rec=rec, ff=ff, on=True, init=b"", err="")
    threading.Thread(target=_pump, daemon=True).start()
    return True


def video_stop():
    VIDEO["on"] = False
    for k in ("ff", "rec"):
        p = VIDEO.get(k)
        if p and p.poll() is None:
            try:
                p.terminate()
                p.wait(timeout=3)
            except Exception:  # noqa
                p.kill()
        VIDEO[k] = None
    with VIDEO["lock"]:
        VIDEO["clients"].clear()
    VIDEO["init"] = b""


def video_client():
    q = queue.Queue(maxsize=90)
    with VIDEO["lock"]:
        VIDEO["clients"].add(q)
    return q


def video_drop(q):
    with VIDEO["lock"]:
        VIDEO["clients"].discard(q)


HTTPS_PORT = PORT + 1
TLS = {"srv": None, "cert": "", "key": "", "ip": ""}


def _tls_dir():
    import tempfile
    for base in (os.path.expanduser("~/.cache"), os.environ.get("XDG_RUNTIME_DIR"), tempfile.gettempdir()):
        if not base:
            continue
        d = os.path.join(base, "alharthia")
        try:
            os.makedirs(d, exist_ok=True)
            return d
        except OSError:
            continue
    return tempfile.gettempdir()


def ensure_cert(ip):
    """شهادة ذاتية التوقيع — المتصفحات ما تسمح بمشاركة الشاشة إلا على https."""
    if TLS["cert"] and TLS["ip"] == ip and os.path.exists(TLS["cert"]):
        return True
    if not shutil.which("openssl"):
        return False
    d = _tls_dir()
    cert, key = os.path.join(d, "share-cert.pem"), os.path.join(d, "share-key.pem")
    try:
        subprocess.run(
            ["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "3650",
             "-keyout", key, "-out", cert, "-subj", "/CN=Alharthia OS",
             "-addext", "subjectAltName=IP:%s,DNS:alharthia.local,DNS:alharthia" % ip],
            capture_output=True, timeout=60, check=True)
    except Exception:  # noqa
        return False
    TLS.update(cert=cert, key=key, ip=ip)
    return True


def start_tls():
    if TLS["srv"]:
        return True
    import ssl
    ip = lan_ip()
    if not ensure_cert(ip):
        return False
    try:
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ctx.load_cert_chain(TLS["cert"], TLS["key"])
        srv = ThreadingHTTPServer(("0.0.0.0", HTTPS_PORT), ShareHandler)
        srv.daemon_threads = True
        srv.socket = ctx.wrap_socket(srv.socket, server_side=True)
    except Exception:  # noqa
        return False
    TLS["srv"] = srv
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return True


def stop_tls():
    srv = TLS["srv"]
    TLS["srv"] = None
    if srv:
        threading.Thread(target=srv.shutdown, daemon=True).start()


# ------------------------------------------------------- استقبال بث MJPEG من تطبيق بالهاتف
# يشتغل مع ScreenStream ومع IP Webcam وأي تطبيق يبث multipart/x-mixed-replace
PULL = {"on": False, "url": "", "err": "", "thread": None, "stop": False, "name": ""}
PULL_PATHS = ["", "stream.mjpeg", "stream.mjpg", "mjpeg", "video", "videofeed", "stream"]


def _pull_open(url):
    """يجرب مسارات معروفة لحد ما يلگى بث MJPEG حقيقي."""
    import urllib.request, urllib.parse
    u = url.strip()
    if not u:
        return None, "ماكو عنوان"
    if "://" not in u:
        u = "http://" + u
    parts = urllib.parse.urlsplit(u)
    if not parts.port and parts.scheme == "http" and ":" not in parts.netloc:
        parts = parts._replace(netloc=parts.netloc + ":8080")
    base = urllib.parse.urlunsplit(parts)
    tried = [base] if parts.path not in ("", "/") else [base.rstrip("/") + "/" + x for x in PULL_PATHS]
    last = "ماكو رد من الهاتف"
    for cand in tried:
        try:
            r = urllib.request.urlopen(cand, timeout=6)
        except Exception as e:  # noqa
            last = str(e)
            continue
        ctype = r.headers.get("Content-Type", "")
        if "multipart" in ctype:
            b = ctype.split("boundary=")[-1].strip().strip('"') if "boundary=" in ctype else "--"
            return (r, b), ""
        r.close()
        last = "الرابط مو بث فيديو"
    return None, last


def _pull_loop(url):
    got = _pull_open(url)
    stream, err = got
    if not stream:
        PULL.update(on=False, err=err)
        return
    r, boundary = stream
    PULL.update(on=True, err="")
    bnd = ("--" + boundary).encode() if not boundary.startswith("--") else boundary.encode()
    buf = b""
    try:
        while not PULL["stop"]:
            chunk = r.read(32768)
            if not chunk:
                break
            buf += chunk
            while True:
                a = buf.find(b"\xff\xd8")
                b2 = buf.find(b"\xff\xd9", a + 2) if a >= 0 else -1
                if a < 0 or b2 < 0:
                    break
                jpg = buf[a:b2 + 2]
                buf = buf[b2 + 2:]
                with STATE["lock"]:
                    STATE["in_frame"], STATE["in_t"] = jpg, time.time()
                    STATE["in_name"] = PULL["name"] or "هاتف"
            if len(buf) > 4 * 1024 * 1024:
                buf = buf[-1024:]
    except Exception as e:  # noqa
        PULL["err"] = str(e)
    finally:
        try:
            r.close()
        except Exception:  # noqa
            pass
        PULL.update(on=False, thread=None)


def pull_start(url, name=""):
    pull_stop()
    PULL.update(stop=False, url=url, err="", name=(name or "")[:40])
    t = threading.Thread(target=_pull_loop, args=(url,), daemon=True)
    PULL["thread"] = t
    t.start()
    for _ in range(40):          # ننطر شوية حتى نرد بالنتيجة الحقيقية
        time.sleep(0.2)
        if PULL["on"] or PULL["err"]:
            break
    return PULL["on"], PULL["err"]


def pull_stop():
    PULL["stop"] = True
    t = PULL.get("thread")
    if t and t.is_alive():
        t.join(timeout=2)
    PULL.update(on=False, thread=None, stop=False)


# ------------------------------------------------ اكتشاف تلقائي (تطبيق Alharthia Cast)
DISCO_PORT = 8765          # التطبيق يبث سؤال على هذا المنفذ والجهاز يرد
DISCO = {"sock": None, "stop": False}
DISCO_ASK = b"ALHARTHIA?"


def _disco_loop(sock):
    while not DISCO["stop"]:
        try:
            data, addr = sock.recvfrom(256)
        except OSError:
            break
        if not data.startswith(DISCO_ASK):
            continue
        try:
            reply = json.dumps({
                "app": "alharthia", "name": DEVICE_NAME, "ip": lan_ip(),
                "port": PORT, "pinLen": 6, "v": 1,
            }).encode()
            sock.sendto(reply, addr)
        except OSError:
            pass


def disco_start():
    if DISCO["sock"]:
        return True
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        sock.bind(("0.0.0.0", DISCO_PORT))
    except OSError:
        return False
    DISCO.update(sock=sock, stop=False)
    threading.Thread(target=_disco_loop, args=(sock,), daemon=True).start()
    return True


def disco_stop():
    DISCO["stop"] = True
    s = DISCO.get("sock")
    DISCO["sock"] = None
    if s:
        try:
            s.close()
        except OSError:
            pass


def lan_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except OSError:
        return "127.0.0.1"


CAP = {"err": "", "tool": ""}


def _cap_cmds(q, scale):
    """أدوات التقاط الشاشة — بترتيب الأفضلية."""
    out = []
    if shutil.which("grim"):
        out.append(("grim", ["grim", "-t", "jpeg", "-q", str(q), "-s", str(scale), "-"]))
    if shutil.which("wayshot"):
        out.append(("wayshot", ["wayshot", "--stdout", "--encoding", "jpg"]))
    if shutil.which("scrot"):
        out.append(("scrot", ["scrot", "-o", "-q", str(q), "/dev/stdout"]))
    return out


def capture():
    """A JPEG of the current screen (cached for a moment)."""
    now = time.time()
    with STATE["lock"]:
        if STATE["frame"] and (now - STATE["frame_t"]) * 1000 < FRAME_MIN_MS:
            return STATE["frame"]
    cmds = _cap_cmds(STATE["quality"], STATE["scale"])
    if not cmds:
        CAP["err"] = "ماكو أداة التقاط شاشة — ثبّت grim"
        return b""
    data, err = b"", ""
    # نبدي بالأداة اللي نجحت آخر مرة
    cmds.sort(key=lambda c: c[0] != CAP["tool"])
    for name, cmd in cmds:
        try:
            p = subprocess.run(cmd, capture_output=True, timeout=8,
                               env=dict(os.environ, XDG_RUNTIME_DIR=os.environ.get("XDG_RUNTIME_DIR", "")))
        except Exception as e:  # noqa
            err = "%s: %s" % (name, e)
            continue
        if p.returncode == 0 and p.stdout:
            data, CAP["tool"], CAP["err"] = p.stdout, name, ""
            break
        err = "%s: %s" % (name, (p.stderr or b"").decode("utf-8", "replace").strip()[:160] or "رجع فارغ")
    if not data:
        CAP["err"] = err or "تعذر التقاط الشاشة"
    with STATE["lock"]:
        if data:
            STATE["frame"], STATE["frame_t"] = data, now
        return STATE["frame"] if data else b""


def status():
    now = time.time()
    viewers = {k: v for k, v in STATE["viewers"].items() if now - v < VIEWER_TIMEOUT}
    STATE["viewers"] = viewers
    return {
        "on": STATE["on"], "pin": STATE["pin"], "key": STATE["key"],
        "url": f"http://{lan_ip()}:{PORT}/?k={STATE['key']}" if STATE["on"] else "",
        "ip": lan_ip(), "port": PORT, "viewers": len(viewers),
        "incoming": bool(STATE["in_frame"]) and now - STATE["in_t"] < IN_TIMEOUT,
        "from": STATE["in_name"], "tool": bool(_cap_cmds(50, 1)), "capTool": CAP["tool"], "capErr": CAP["err"],
        "video": VIDEO["on"], "videoTool": video_tools(), "videoErr": VIDEO["err"],
        "https": bool(TLS["srv"]), "httpsPort": HTTPS_PORT,
        "pull": PULL["on"], "pullUrl": PULL["url"], "pullErr": PULL["err"],
        "sendUrl": f"https://{lan_ip()}:{HTTPS_PORT}/send?k={STATE['key']}" if (STATE["on"] and TLS["srv"]) else "",
        "airplay": airplay_status(), "airplayErr": AIR["err"],
    }


def _has_grim():
    from shutil import which
    return which("grim")


PAGE_HOME = """<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Alharthia — العرض اللاسلكي</title>
<style>
:root{color-scheme:dark}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0c1222;color:#e8edf8;
 font-family:"Segoe UI",Tahoma,system-ui,sans-serif;padding:24px}
.card{width:min(520px,100%);background:#141c31;border:1px solid #27324f;border-radius:22px;padding:26px;text-align:center}
h1{font-size:22px;margin:0 0 6px}p{color:#9fb0d0;margin:0 0 22px}
a.btn,button.btn{display:flex;align-items:center;gap:12px;justify-content:center;width:100%;margin:10px 0;padding:18px;
 border-radius:16px;border:0;background:#f0703e;color:#fff;font-size:18px;font-weight:700;text-decoration:none;cursor:pointer}
a.btn.ghost,button.btn.ghost{background:#1e2a47;color:#e8edf8}
small{color:#7e8db0;display:block;margin-top:16px;line-height:1.7}
</style></head><body><div class="card">
<h1>Alharthia OS — العرض اللاسلكي</h1><p>اختر شنو تريد تسوي</p>
<a class="btn" href="/view?k=KEY">👁️ شاهد شاشة الجهاز</a>
<button class="btn ghost" id="sendBtn">🖥️ شارك شاشتك مع الجهاز</button>
<script>
document.getElementById('sendBtn').onclick=function(){
  var u='/send?k=KEY';
  if(!window.isSecureContext && '%SENDURL%'.indexOf('https')===0) u='%SENDURL%';
  location.href=u;
};
</script>
<small>المشاهدة تشتغل على الآيفون والآيباد والأندرويد والكمبيوتر — بث مباشر ٣٠ إطار/ثانية.<br>مشاركة شاشتك مع الجهاز تحتاج متصفح كمبيوتر (Chrome / Edge).<br>آيفون / آيباد: تكدر تسوي «عكس الشاشة» (AirPlay) واختار Alharthia.</small>
</div></body></html>"""

PAGE_VIEW = """<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>شاشة Alharthia</title>
<style>html,body{margin:0;height:100%;background:#000;overflow:hidden}
video,img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:#000}
#msg{position:fixed;inset:auto 0 14px;text-align:center;color:#fff;font:15px system-ui;opacity:.85;
 text-shadow:0 1px 4px #000;padding:0 16px;line-height:1.7}
#tag{position:fixed;top:10px;left:10px;color:#fff;font:11px system-ui;opacity:.3}</style>
</head><body>
<img id="pic" alt="">
<video id="vid" autoplay muted playsinline webkit-playsinline hidden></video>
<div id="msg">جاري الاتصال…</div><div id="tag"></div>
<script>
/* الفكرة: نبدي فوراً بالصور المتتابعة حتى ما تطلع شاشة سودة أبداً،
   وبالخلفية نجرب البث المباشر، وما ننتقل إلا لمن تجي صورة حقيقية منه. */
const k=new URLSearchParams(location.search).get('k')||'';
const vid=document.getElementById('vid'), pic=document.getElementById('pic');
const msg=document.getElementById('msg'), tag=document.getElementById('tag');
const MIMES=['video/mp4; codecs="avc1.42E01E"','video/mp4; codecs="avc1.42001E"','video/mp4; codecs="avc1.4D401F"','video/mp4; codecs="avc1.640028"','video/mp4'];
const APPLE=/iPad|iPhone|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
const FORCE=new URLSearchParams(location.search).get('mode')||'';
let mode='', jpegIv=0, stopVideo=null, lastPic=0, lastVid=0, fails=0;

function note(t){ msg.textContent=t||''; msg.style.display=t?'':'none'; }
function showPic(){ pic.hidden=false; vid.hidden=true; tag.textContent='صور'; mode='jpg'; }
function showVid(m){ pic.hidden=true; vid.hidden=false; tag.textContent=m; mode=m; note(''); }

/* ---------- صور متتابعة: تشتغل دائماً وبأي متصفح ---------- */
function startJpeg(){
  if(jpegIv) return;
  showPic();
  let busy=false;
  jpegIv=setInterval(async()=>{
    if(busy||mode!=='jpg') return; busy=true;
    try{
      const r=await fetch('/frame.jpg?k='+k+'&ts='+Date.now(),{cache:'no-store'});
      if(!r.ok) throw new Error(r.status===503?'الجهاز ما يكدر يلتقط الشاشة':'خطأ '+r.status);
      const blob=await r.blob();
      if(!blob.size) throw new Error('صورة فارغة');
      const u=URL.createObjectURL(blob), old=pic.src;
      pic.src=u; setTimeout(()=>old&&old.startsWith('blob:')&&URL.revokeObjectURL(old),400);
      lastPic=Date.now(); fails=0; note('');
    }catch(e){
      if(++fails>2) note(String(e.message||e)+' — جاري إعادة المحاولة…');
    }
    busy=false;
  },250);
}
function stopJpeg(){ clearInterval(jpegIv); jpegIv=0; }

/* ---------- MSE: أقل تأخير (أندرويد / كروم / ويندوز) ---------- */
async function tryMSE(){
  const MS=window.MediaSource||window.ManagedMediaSource;
  if(!MS||!MS.isTypeSupported) return false;
  const MIME=MIMES.find(m=>{ try{ return MS.isTypeSupported(m); }catch(e){ return false; } });
  if(!MIME) return false;
  let res; try{ res=await fetch('/live.mp4?k='+k,{cache:'no-store'}); }catch(e){ return false; }
  if(!res.ok||!res.body) return false;
  const ms=new MS(); vid.disableRemotePlayback=true; vid.src=URL.createObjectURL(ms);
  await new Promise(r=>ms.addEventListener('sourceopen',r,{once:true}));
  let sb; try{ sb=ms.addSourceBuffer(MIME); }catch(e){ return false; }
  sb.mode='sequence';
  const q=[]; let busy=false;
  const pump=()=>{ if(busy||sb.updating||!q.length) return; busy=true;
    try{ sb.appendBuffer(q.shift()); }catch(e){ busy=false; q.length=0; } };
  sb.addEventListener('updateend',()=>{ busy=false;
    try{ if(vid.buffered.length&&vid.currentTime-vid.buffered.start(0)>6) sb.remove(0,vid.currentTime-3); }catch(e){}
    pump(); });
  const rd=res.body.getReader();
  stopVideo=()=>{ try{ rd.cancel(); }catch(e){} };
  (async()=>{ for(;;){ let r; try{ r=await rd.read(); }catch(e){ break; }
      if(r.done) break;
      q.push(r.value); pump();
      if(vid.paused) vid.play().catch(()=>{});
      if(vid.videoWidth>0&&vid.currentTime>0){ lastVid=Date.now(); if(mode!=='mse'){ showVid('mse'); stopJpeg(); } }
      try{ const n=vid.buffered.length; if(n&&vid.buffered.end(n-1)-vid.currentTime>1.6) vid.currentTime=vid.buffered.end(n-1)-0.4; }catch(e){}
    }
    if(mode==='mse'){ startJpeg(); }          // انقطع البث — نرجع للصور
  })();
  return true;
}

/* ---------- HLS: آيفون وآيباد ---------- */
function tryHLS(){
  if(!vid.canPlayType('application/vnd.apple.mpegurl')) return false;
  vid.src='/hls/live.m3u8?k='+k;
  vid.addEventListener('timeupdate',()=>{
    if(vid.videoWidth>0){ lastVid=Date.now(); if(mode!=='hls'){ showVid('hls'); stopJpeg(); } }
  });
  vid.play().catch(()=>{});
  stopVideo=()=>{ vid.removeAttribute('src'); vid.load(); };
  return true;
}

startJpeg();
if(FORCE!=='jpg') setTimeout(()=>{ (APPLE?tryHLS():tryMSE())||((APPLE?tryMSE():tryHLS())); },1200);

/* لو البث وقف، نرجع للصور بدل الشاشة السودة */
setInterval(()=>{
  if(mode!=='jpg'&&Date.now()-lastVid>6000){
    if(stopVideo){ try{ stopVideo(); }catch(e){} stopVideo=null; }
    startJpeg();
  }
},2000);

addEventListener('click',()=>{ vid.play().catch(()=>{});
  const el=document.documentElement; if(el.requestFullscreen) el.requestFullscreen().catch(()=>{});
  else if(vid.webkitEnterFullscreen) vid.webkitEnterFullscreen(); });
</script></body></html>"""

PAGE_SEND = """<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>شارك شاشتك</title>
<style>
:root{color-scheme:dark}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0c1222;color:#e8edf8;font-family:"Segoe UI",Tahoma,system-ui,sans-serif;padding:20px}
.card{width:min(560px,100%);background:#141c31;border:1px solid #27324f;border-radius:22px;padding:24px;text-align:center}
button{padding:16px 22px;border-radius:14px;border:0;background:#f0703e;color:#fff;font-size:17px;font-weight:700;cursor:pointer}
button.stop{background:#dc2626}
input{width:100%;padding:12px;border-radius:12px;border:1px solid #27324f;background:#0f172a;color:#fff;margin:10px 0 16px;font-size:16px}
video{width:100%;border-radius:14px;margin-top:16px;background:#000}
#st{color:#9fb0d0;margin-top:14px}
#why{margin-top:16px;padding:16px;border-radius:14px;background:#0f172a;border:1px solid #27324f;text-align:right;line-height:1.9}
#why .sub{color:#9fb0d0;font-size:15px}
a.lnk{display:block;padding:15px;border-radius:14px;background:#f0703e;color:#fff;font-weight:700;text-decoration:none;text-align:center}
</style></head><body><div class="card">
<h1 style="margin:0 0 14px;font-size:20px">شارك شاشتك مع Alharthia</h1>
<input id="nm" placeholder="اسمك (يطلع على شاشة الصف)" value="جهاز ضيف">
<button id="go">ابدأ المشاركة</button>
<div id="why" hidden></div>
<div id="st">اختار «شاشة كاملة» أو نافذة من المتصفح.</div>
<video id="pv" autoplay muted playsinline></video>
</div>
<script>
const k=new URLSearchParams(location.search).get('k')||'';
const go=document.getElementById('go'), st=document.getElementById('st'), pv=document.getElementById('pv');
const SENDURL='%SENDURL%';
const MOBILE=/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
let stream=null, timer=null;
const cv=document.createElement('canvas'), cx=cv.getContext('2d');
function why(){
  const box=document.getElementById('why');
  const off=()=>{ box.hidden=false; go.style.display='none'; st.style.display='none'; pv.style.display='none'; };
  if(MOBILE){
    box.innerHTML='<b>الهواتف ما تكدر تشارك شاشتها من المتصفح</b><br>'+
      '<span class="sub">• <b>آيفون / آيباد</b>: افتح «مركز التحكم» ← «عكس الشاشة» ← اختر <b>Alharthia</b>.<br>'+
      '• <b>أندرويد</b>: استخدم كمبيوتر، أو اعرض الملف نفسه على شاشة الصف.<br>'+
      '• من الهاتف تكدر <b>تشاهد</b> شاشة الصف بس — ارجع واضغط «شاهد شاشة الجهاز».</span>';
    off(); return true;
  }
  if(!window.isSecureContext){
    box.innerHTML='<b>لازم تفتح الرابط الآمن أولاً</b><br>'+
      '<span class="sub">المتصفح ما يسمح بمشاركة الشاشة إلا على https. اضغط الزر، وإذا طلعت صفحة تحذير اضغط '+
      '<b>Advanced</b> ثم <b>Proceed</b> (الشهادة محلية ومالت جهاز الصف).</span>'+
      '<div style="margin-top:14px"><a class="lnk" href="'+SENDURL+'">🔒 افتح الرابط الآمن</a></div>';
    off(); return true;
  }
  if(!navigator.mediaDevices||!navigator.mediaDevices.getDisplayMedia){
    box.innerHTML='<b>هذا المتصفح ما يدعم مشاركة الشاشة</b><br><span class="sub">استخدم Chrome أو Edge على كمبيوتر.</span>';
    off(); return true;
  }
  return false;
}
addEventListener('DOMContentLoaded',why); why();
async function start(){
  if(why()) return;
  try{ stream=await navigator.mediaDevices.getDisplayMedia({video:{frameRate:8},audio:false}); }
  catch(e){ st.textContent='تم إلغاء المشاركة'; return; }
  pv.srcObject=stream; go.textContent='إيقاف المشاركة'; go.className='stop'; st.textContent='المشاركة شغالة — شاشتك تطلع على شاشة الصف';
  stream.getVideoTracks()[0].addEventListener('ended',stop);
  timer=setInterval(send,320);
}
function stop(){ if(timer) clearInterval(timer); timer=null;
  if(stream){ stream.getTracks().forEach(t=>t.stop()); stream=null; }
  pv.srcObject=null; go.textContent='ابدأ المشاركة'; go.className=''; st.textContent='توقفت المشاركة';
}
async function send(){
  const v=pv; if(!v.videoWidth) return;
  const w=Math.min(1280,v.videoWidth), h=Math.round(v.videoHeight*w/v.videoWidth);
  cv.width=w; cv.height=h; cx.drawImage(v,0,0,w,h);
  const blob=await new Promise(r=>cv.toBlob(r,'image/jpeg',.6));
  if(!blob) return;
  fetch('/frame?k='+k+'&name='+encodeURIComponent(document.getElementById('nm').value||'جهاز'),{method:'POST',body:blob}).catch(()=>{});
}
go.onclick=()=>stream?stop():start();
</script></body></html>"""


class ShareHandler(BaseHTTPRequestHandler):
    server_version = "AlharthiaShare/1.0"

    def log_message(self, *a):
        if os.environ.get("ALH_DEBUG"):
            BaseHTTPRequestHandler.log_message(self, *a)

    def key_ok(self):
        """المفتاح الطويل من الرابط، أو رمز الـ PIN (٦ أرقام) اللي يكتبه التطبيق."""
        from urllib.parse import urlparse, parse_qs
        q = parse_qs(urlparse(self.path).query)
        if secrets.compare_digest((q.get("k") or [""])[0], STATE["key"]):
            return True
        pin = (q.get("pin") or [""])[0] or (self.headers.get("X-Alharthia-Pin") or "")
        return bool(STATE["pin"]) and secrets.compare_digest(pin, STATE["pin"])

    def html(self, page):
        send = f"https://{lan_ip()}:{HTTPS_PORT}/send?k={STATE['key']}" if TLS["srv"] else ""
        data = page.replace("%SENDURL%", send).replace("KEY", STATE["key"]).encode()
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def deny(self, code=403, msg="رابط غير صالح — افتح الرابط من شاشة الصف"):
        data = f"<meta charset=utf-8><body style='font:16px system-ui;padding:40px;text-align:center'>{html.escape(msg)}".encode()
        self.send_response(code)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        path = self.path.split("?")[0]
        if not STATE["on"]:
            return self.deny(503, "العرض اللاسلكي مطفأ")
        if not self.key_ok():
            return self.deny()
        if path in ("/", "/index.html"):
            return self.html(PAGE_HOME)
        if path == "/view":
            return self.html(PAGE_VIEW)
        if path == "/send":
            return self.html(PAGE_SEND)
        if path == "/live.mp4":
            return self.live_mp4()
        if path.startswith("/hls/"):
            return self.hls(path[5:])
        if path == "/frame.jpg":
            STATE["viewers"][self.client_address[0]] = time.time()
            data = capture()
            if not data:
                return self.deny(503, "تعذر التقاط الشاشة")
            self.send_response(200)
            self.send_header("Content-Type", "image/jpeg")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            try:
                self.wfile.write(data)
            except OSError:
                pass
            return
        return self.deny(404, "غير موجود")

    def live_mp4(self):
        """Fragmented MP4, streamed live (MSE in the viewer's browser)."""
        if not VIDEO["on"] and not video_start():
            return self.deny(503, "البث المباشر غير متاح — " + (VIDEO["err"] or "تحقق من الأدوات"))
        STATE["viewers"][self.client_address[0]] = time.time()
        init, waited = VIDEO["init"], 0.0
        while not init and waited < 6:
            time.sleep(0.2)
            waited += 0.2
            init = VIDEO["init"]
        if not init:
            return self.deny(503, "تعذر بدء البث")
        self.send_response(200)
        self.send_header("Content-Type", "video/mp4")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Connection", "close")
        self.end_headers()
        q = video_client()
        try:
            self.wfile.write(init)
            self.wfile.flush()
            while VIDEO["on"]:
                try:
                    frag = q.get(timeout=5)
                except queue.Empty:
                    continue
                self.wfile.write(frag)
                self.wfile.flush()
                STATE["viewers"][self.client_address[0]] = time.time()
        except (OSError, ValueError):
            pass
        finally:
            video_drop(q)

    def hls(self, name):
        """HLS playlist / segments — this is what iPhone and iPad play natively."""
        if not VIDEO["on"] and not video_start():
            return self.deny(503, "البث المباشر غير متاح")
        if "/" in name or "\\" in name or name.startswith("."):
            return self.deny(404, "غير موجود")
        full = os.path.join(HLS_DIR, name)
        for _ in range(30):
            if os.path.exists(full):
                break
            time.sleep(0.2)
        if not os.path.exists(full):
            return self.deny(404, "غير موجود")
        STATE["viewers"][self.client_address[0]] = time.time()
        try:
            data = open(full, "rb").read()
        except OSError:
            return self.deny(404, "غير موجود")
        if name.endswith(".m3u8"):
            out = []
            for line in data.decode("utf-8", "replace").splitlines():
                if line and not line.startswith("#"):
                    line = line + ("&" if "?" in line else "?") + "k=" + STATE["key"]
                out.append(line)
            data = ("\n".join(out) + "\n").encode()
            ctype = "application/vnd.apple.mpegurl"
        else:
            ctype = "video/mp2t"
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        try:
            self.wfile.write(data)
        except OSError:
            pass

    def do_POST(self):
        from urllib.parse import urlparse, parse_qs
        if not STATE["on"] or not self.key_ok():
            return self.deny()
        if self.path.split("?")[0] != "/frame":
            return self.deny(404, "غير موجود")
        n = int(self.headers.get("Content-Length") or 0)
        data = self.rfile.read(n) if 0 < n <= 8 * 1024 * 1024 else b""
        q = parse_qs(urlparse(self.path).query)
        if data:
            with STATE["lock"]:
                STATE["in_frame"], STATE["in_t"] = data, time.time()
                STATE["in_name"] = (q.get("name") or ["جهاز"])[0][:40]
        self.send_response(204)
        self.end_headers()


AIR = {"err": "", "asked": 0.0}


def airplay_log(lines=25):
    """آخر سطور سجل خدمة AirPlay — نبيّنها بالواجهة حتى يعرف المعلم سبب الفشل."""
    try:
        out = subprocess.run(["journalctl", "-u", "alharthia-airplay", "-n", str(lines),
                              "--no-pager", "-o", "cat"], capture_output=True, text=True, timeout=6).stdout
    except Exception:  # noqa
        return ""
    keep = []
    for ln in out.splitlines():
        ln = ln.strip()
        if not ln or ln.startswith(("»", "XDG_RUNTIME_DIR=")):
            continue
        keep.append(ln)
    return " · ".join(keep[-3:])[:300]


def airplay_status():
    """uxplay makes the Pi show up in the iPhone/iPad screen-mirroring list."""
    if not shutil.which("uxplay"):
        AIR["err"] = ""
        return "missing"
    try:
        out = subprocess.run(["systemctl", "is-active", "alharthia-airplay"],
                             capture_output=True, text=True, timeout=4).stdout.strip()
    except Exception:  # noqa
        return "unknown"
    if out == "active":
        AIR["err"] = ""
        return "on"
    # انطفأ بعد ما طلبناه؟ نجيب السبب من السجل
    if AIR["asked"] and time.time() - AIR["asked"] < 120:
        AIR["err"] = airplay_log()
    return "off"


def airplay(on):
    if not shutil.which("uxplay"):
        return "missing"
    AIR["asked"] = time.time() if on else 0.0
    AIR["err"] = ""
    cmd = ["systemctl", "start" if on else "stop", "alharthia-airplay"]
    subprocess.run(["sudo", "-n", "/usr/lib/alharthia/alharthia-helper", "airplay", "on" if on else "off"],
                   capture_output=True, timeout=15) if shutil.which("sudo") else subprocess.run(cmd, capture_output=True, timeout=15)
    return airplay_status()


def start():
    if STATE["on"]:
        return status()
    STATE["key"] = secrets.token_urlsafe(6)
    STATE["pin"] = f"{secrets.randbelow(900000) + 100000}"
    srv = ThreadingHTTPServer(("0.0.0.0", PORT), ShareHandler)
    srv.daemon_threads = True
    STATE["srv"] = srv
    STATE["on"] = True
    t = threading.Thread(target=srv.serve_forever, daemon=True)
    t.start()
    STATE["thread"] = t
    try:
        video_start()
    except Exception as e:  # noqa - البث المباشر إضافة، وإذا فشل نكمل بالصور المتتابعة
        VIDEO["err"] = str(e)
    try:
        start_tls()
    except Exception:  # noqa
        pass
    disco_start()
    return status()


def stop():
    video_stop()
    stop_tls()
    pull_stop()
    disco_stop()
    srv = STATE["srv"]
    STATE.update(on=False, srv=None, viewers={}, in_frame=b"", in_name="", frame=b"")
    if srv:
        threading.Thread(target=srv.shutdown, daemon=True).start()
    return status()


def incoming_frame():
    with STATE["lock"]:
        if STATE["in_frame"] and time.time() - STATE["in_t"] < IN_TIMEOUT:
            return STATE["in_frame"]
    return b""
