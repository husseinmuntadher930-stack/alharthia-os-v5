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
    "in_frame": b"", "in_t": 0.0, "in_name": "", "in_count": 0, "in_err": "", "hits": [],
}


# ------------------------------------------------------------------ live H.264 video


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


PNG_MAGIC = b"\x89PNG"


CAP = {"env": ""}          # يستخدمها زر «لقطة شاشة» بالواجهة


def wl_env():
    """بيئة Wayland — نلگي اسم جلسة العرض لوحدنا إذا ما كانت موجودة بالبيئة."""
    env = dict(os.environ)
    rt = env.get("XDG_RUNTIME_DIR") or "/run/user/%d" % os.getuid()
    env["XDG_RUNTIME_DIR"] = rt
    if not env.get("WAYLAND_DISPLAY"):
        try:
            for f in sorted(os.listdir(rt)):
                if f.startswith("wayland-") and not f.endswith(".lock"):
                    env["WAYLAND_DISPLAY"] = f
                    break
        except OSError:
            pass
    CAP["env"] = "WAYLAND_DISPLAY=%s XDG_RUNTIME_DIR=%s" % (env.get("WAYLAND_DISPLAY", "-"), rt)
    return env


def status():
    now = time.time()
    viewers = {k: v for k, v in STATE["viewers"].items() if now - v < VIEWER_TIMEOUT}
    STATE["viewers"] = viewers
    return {
        "on": STATE["on"], "pin": STATE["pin"], "key": STATE["key"],
        "url": f"http://{lan_ip()}:{PORT}/?k={STATE['key']}" if STATE["on"] else "",
        "ip": lan_ip(), "port": PORT,
        "incoming": bool(STATE["in_frame"]) and now - STATE["in_t"] < IN_TIMEOUT,
        "from": STATE["in_name"],
        "frames": STATE["in_count"], "ago": round(now - STATE["in_t"], 1) if STATE["in_t"] else None,
        "https": bool(TLS["srv"]), "httpsPort": HTTPS_PORT,
        "sendUrl": f"https://{lan_ip()}:{HTTPS_PORT}/send?k={STATE['key']}" if (STATE["on"] and TLS["srv"]) else "",
        "airplay": airplay_status(), "airplayErr": AIR["err"],
        "hits": [dict(x, ago=round(now - x["t"], 1)) for x in STATE["hits"][-6:]][::-1],
    }


PAGE_HOME = """<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Alharthia — مشاركة الشاشة</title>
<style>
:root{color-scheme:dark}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0c1222;color:#e8edf8;
 font-family:"Segoe UI",Tahoma,system-ui,sans-serif;padding:24px}
.card{width:min(520px,100%);background:#141c31;border:1px solid #27324f;border-radius:22px;padding:26px;text-align:center}
h1{font-size:22px;margin:0 0 6px}p{color:#9fb0d0;margin:0 0 22px;line-height:1.8}
button.btn{display:flex;align-items:center;gap:12px;justify-content:center;width:100%;margin:10px 0;padding:18px;
 border-radius:16px;border:0;background:#f0703e;color:#fff;font-size:18px;font-weight:700;cursor:pointer}
small{color:#7e8db0;display:block;margin-top:18px;line-height:1.9}
</style></head><body><div class="card">
<h1>Alharthia OS</h1><p>اعرض شاشة جهازك على شاشة الصف</p>
<button class="btn" id="sendBtn">🖥️ شارك شاشتك مع شاشة الصف</button>
<div id="warn" hidden style="margin-top:14px;padding:14px;border-radius:14px;background:#3b1111;border:1px solid #7f1d1d;color:#fca5a5;line-height:1.8"></div>
<small>مشاركة الشاشة تحتاج متصفح <b>كمبيوتر</b> (Chrome أو Firefox أو Edge).<br>
الهواتف ما تكدر تشارك شاشتها من المتصفح — الآيفون يستخدم AirPlay، والأندرويد يستخدم تطبيق «بث الحارثية».</small>
</div>
<script>
var SU='%SENDURL%';
if(!window.isSecureContext && SU.indexOf('https')!==0){
  var w=document.getElementById('warn'); w.hidden=false;
  w.innerHTML='<b>الرابط الآمن مو جاهز</b><br>نفّذ على جهاز الصف: <code dir="ltr">sudo apt install -y openssl</code> وبعدها أطفي المشاركة وشغّلها من جديد.';
}
document.getElementById('sendBtn').onclick=function(){
  location.href=(!window.isSecureContext && SU.indexOf('https')===0) ? SU : '/send?k=KEY';
};
</script>
</body></html>"""


PAGE_SEND = """<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>شارك شاشتك</title>
<style>
:root{color-scheme:dark}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0c1222;color:#e8edf8;font-family:"Segoe UI",Tahoma,system-ui,sans-serif;padding:20px}
.card{width:min(580px,100%);background:#141c31;border:1px solid #27324f;border-radius:22px;padding:24px;text-align:center}
button{padding:16px 22px;border-radius:14px;border:0;background:#f0703e;color:#fff;font-size:17px;font-weight:700;cursor:pointer}
button.stop{background:#dc2626}
input{width:100%;padding:12px;border-radius:12px;border:1px solid #27324f;background:#0f172a;color:#fff;margin:10px 0 16px;font-size:16px}
video{width:100%;border-radius:14px;margin-top:16px;background:#000}
#st{color:#9fb0d0;margin-top:14px;line-height:1.8}
#why{margin-top:16px;padding:16px;border-radius:14px;background:#0f172a;border:1px solid #27324f;text-align:right;line-height:1.9}
#why .sub{color:#9fb0d0;font-size:15px}
#err{margin-top:14px;padding:14px;border-radius:14px;background:#3b1111;border:1px solid #7f1d1d;color:#fca5a5;text-align:right;line-height:1.8;display:none}
#stat{margin-top:12px;color:#7e8db0;font-size:14px;font-variant-numeric:tabular-nums}
a.lnk{display:block;padding:15px;border-radius:14px;background:#f0703e;color:#fff;font-weight:700;text-decoration:none;text-align:center}
</style></head><body><div class="card">
<h1 style="margin:0 0 14px;font-size:20px">شارك شاشتك مع شاشة الصف</h1>
<input id="nm" placeholder="اسمك (يطلع على شاشة الصف)" value="جهاز ضيف">
<button id="go">ابدأ المشاركة</button>
<div id="why" hidden></div>
<div id="st">اختار «شاشة كاملة» أو نافذة من المتصفح.</div>
<div id="err"></div>
<div id="stat"></div>
<video id="pv" autoplay muted playsinline></video>
</div>
<script>
const k=new URLSearchParams(location.search).get('k')||'';
const go=document.getElementById('go'), st=document.getElementById('st'), pv=document.getElementById('pv');
const errBox=document.getElementById('err'), stat=document.getElementById('stat');
const SENDURL='%SENDURL%';
const MOBILE=/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
let stream=null, timer=null, sent=0, failed=0, lastErr='', busy=false;
const cv=document.createElement('canvas'), cx=cv.getContext('2d');

function why(){
  const box=document.getElementById('why');
  const off=()=>{ box.hidden=false; go.style.display='none'; st.style.display='none'; pv.style.display='none'; };
  if(MOBILE){
    box.innerHTML='<b>الهواتف ما تكدر تشارك شاشتها من المتصفح</b><br>'+
      '<span class="sub">• <b>آيفون / آيباد</b>: مركز التحكم ← «عكس الشاشة» ← اختر <b>Alharthia</b>.<br>'+
      '• <b>أندرويد</b>: استخدم تطبيق «بث الحارثية»، أو شارك من كمبيوتر.</span>';
    off(); return true;
  }
  if(!window.isSecureContext){
    if(SENDURL.indexOf('https')!==0){
      box.innerHTML='<b>الرابط الآمن مو جاهز على جهاز الصف</b><br>'+
        '<span class="sub">المتصفحات ما تسمح بمشاركة الشاشة إلا على https. نفّذ على جهاز الصف:<br>'+
        '<code style="display:block;background:#0c1222;padding:10px;border-radius:8px;margin-top:8px" dir="ltr">sudo apt install -y openssl</code>'+
        'وبعدها أطفي المشاركة وشغّلها من جديد.</span>';
    }else{
      box.innerHTML='<b>لازم تفتح الرابط الآمن أولاً</b><br>'+
        '<span class="sub">المتصفح ما يسمح بمشاركة الشاشة إلا على https. اضغط الزر، وإذا طلعت صفحة تحذير اضغط '+
        '<b>Advanced</b> (أو «متقدم») ثم <b>Proceed / Accept the Risk</b> — الشهادة محلية ومالت جهاز الصف.</span>'+
        '<div style="margin-top:14px"><a class="lnk" href="'+SENDURL+'">🔒 افتح الرابط الآمن</a></div>'+
        '<p class="sub" style="margin-top:12px">أو انسخ هذا العنوان للمتصفح:<br><b dir="ltr" style="word-break:break-all">'+SENDURL+'</b></p>';
    }
    off(); return true;
  }
  if(!navigator.mediaDevices||!navigator.mediaDevices.getDisplayMedia){
    box.innerHTML='<b>هذا المتصفح ما يدعم مشاركة الشاشة</b><br><span class="sub">استخدم Chrome أو Edge على كمبيوتر.</span>';
    off(); return true;
  }
  return false;
}
addEventListener('DOMContentLoaded',why); why();

function showErr(t){
  lastErr=t||'';
  errBox.style.display=t?'':'none';
  errBox.innerHTML=t?('<b>الصورة ما توصل لشاشة الصف</b><br><span style="font-size:14px">'+t+'</span>'):'';
}
function showStat(){
  stat.textContent=stream?('أُرسل '+sent+' إطار'+(failed?(' · فشل '+failed):'')):'';
}

async function start(){
  if(why()) return;
  try{ stream=await navigator.mediaDevices.getDisplayMedia({video:{frameRate:10},audio:false}); }
  catch(e){ st.textContent='تم إلغاء المشاركة'; return; }
  pv.srcObject=stream; go.textContent='إيقاف المشاركة'; go.className='stop';
  st.textContent='المشاركة شغالة — شاشتك تطلع على شاشة الصف';
  sent=failed=0; showErr(''); showStat();
  stream.getVideoTracks()[0].addEventListener('ended',stop);
  timer=setInterval(send,300);
}
function stop(){
  if(timer) clearInterval(timer); timer=null;
  if(stream){ stream.getTracks().forEach(t=>t.stop()); stream=null; }
  pv.srcObject=null; go.textContent='ابدأ المشاركة'; go.className='';
  st.textContent='توقفت المشاركة'; showStat();
}

async function send(){
  if(busy) return;
  const v=pv; if(!v.videoWidth) return;
  busy=true;
  try{
    const w=Math.min(1280,v.videoWidth), h=Math.round(v.videoHeight*w/v.videoWidth);
    cv.width=w; cv.height=h; cx.drawImage(v,0,0,w,h);
    const blob=await new Promise(r=>cv.toBlob(r,'image/jpeg',.6));
    if(!blob){ busy=false; return; }
    const r=await fetch('/frame?k='+k+'&name='+encodeURIComponent(document.getElementById('nm').value||'جهاز'),
                        {method:'POST',body:blob,headers:{'Content-Type':'image/jpeg'}});
    if(!r.ok){
      failed++;
      let t=''; try{ t=(await r.text()).replace(/<[^>]*>/g,'').trim().slice(0,120); }catch(e){}
      showErr(r.status===403?'الرمز مو صحيح — ارجع للصفحة الرئيسية وافتح الرابط من جديد'
            : r.status===503?'العرض اللاسلكي انطفأ على جهاز الصف'
            : ('الجهاز رد بالرمز '+r.status+(t?' — '+t:'')));
    }else{
      sent++; if(lastErr) showErr('');
    }
  }catch(e){
    failed++;
    showErr('انقطع الاتصال بجهاز الصف — تأكد إنك على نفس شبكة الواي فاي ('+(e.message||e)+')');
  }
  showStat();
  busy=false;
}
go.onclick=()=>stream?stop():start();
</script></body></html>"""


def note_hit(ip, what, code, tls=False):
    """نسجّل كل طلب يوصل الجهاز حتى نعرف وين تنقطع السلسلة."""
    with STATE["lock"]:
        h = STATE["hits"]
        h.append({"ip": ip, "what": what, "code": code, "tls": tls, "t": time.time()})
        del h[:-12]


class ShareHandler(BaseHTTPRequestHandler):
    server_version = "AlharthiaShare/1.0"

    def is_tls(self):
        return getattr(self.connection, "context", None) is not None

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
        note_hit(self.client_address[0], self.command + " " + self.path.split("?")[0], code, self.is_tls())
        data = f"<meta charset=utf-8><body style='font:16px system-ui;padding:40px;text-align:center'>{html.escape(msg)}".encode()
        self.send_response(code)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        path = self.path.split("?")[0]
        if not STATE["on"]:
            return self.deny(503, "مشاركة الشاشة مطفأة على جهاز الصف")
        if not self.key_ok():
            return self.deny()
        note_hit(self.client_address[0], "GET " + path, 200, self.is_tls())
        if path in ("/", "/index.html"):
            return self.html(PAGE_HOME)
        if path in ("/send", "/view"):          # /view القديم يروح لصفحة المشاركة
            return self.html(PAGE_SEND)
        return self.deny(404, "غير موجود")

    def do_POST(self):
        from urllib.parse import urlparse, parse_qs
        if not STATE["on"]:
            return self.deny(503, "مشاركة الشاشة مطفأة على جهاز الصف")
        if not self.key_ok():
            return self.deny(403, "الرمز مو صحيح")
        if self.path.split("?")[0] != "/frame":
            return self.deny(404, "غير موجود")
        n = int(self.headers.get("Content-Length") or 0)
        if n <= 0 or n > 8 * 1024 * 1024:
            return self.deny(400, "حجم الصورة غير مقبول")
        data = self.rfile.read(n)
        q = parse_qs(urlparse(self.path).query)
        if data:
            with STATE["lock"]:
                STATE["in_frame"], STATE["in_t"] = data, time.time()
                STATE["in_name"] = (q.get("name") or ["جهاز"])[0][:40]
                STATE["in_count"] += 1
        note_hit(self.client_address[0], "POST /frame", 204, self.is_tls())
        self.send_response(204)
        self.send_header("Content-Length", "0")
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
    STATE["in_count"] = 0
    STATE["hits"] = []
    try:
        start_tls()
    except Exception:  # noqa
        pass
    disco_start()
    return status()


def stop():
    stop_tls()
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
