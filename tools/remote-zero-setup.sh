#!/bin/bash
# =====================================================================
#  AlharthiaOS 3.0 — تجهيز ريموت المعلم (مرة وحدة)
#  الجهاز: Raspberry Pi Zero 2 W + شاشة Waveshare 5 إنج (HDMI + USB للمس)
#  النظام: Raspberry Pi OS Lite (64-bit)
#
#  الاستعمال (على الـ Zero):
#     sudo bash remote-zero-setup.sh http://<IP الصبورة>:8770/ [اسم الشبكة] [كلمة مرور الشبكة]
#  مثال بالشبكة الخاصة مال الصبورة:
#     sudo bash remote-zero-setup.sh http://10.56.0.1:8770/ AlharthiaOS-Remote abcd1234ef
# =====================================================================
set -e
URL="${1:-}"; SSID="${2:-}"; PSK="${3:-}"
[ "$(id -u)" = "0" ] || { echo "شغّله بـ sudo"; exit 1; }
[ -n "$URL" ] || { echo "اكتب عنوان الريموت من إعدادات الصبورة ← الريموت (مثل http://192.168.1.20:8770/)"; exit 1; }
URL="${URL%/}/"
U="${SUDO_USER:-teacher}"; H="$(getent passwd "$U" | cut -d: -f6)"
[ -d "$H" ] || { echo "ما لگيت المستخدم $U"; exit 1; }

echo "» 1/6 الشبكة"
if [ -n "$SSID" ]; then
  nmcli radio wifi on || true
  nmcli device wifi rescan 2>/dev/null || true; sleep 3
  nmcli device wifi connect "$SSID" password "$PSK" name alharthia-remote || echo "تحذير: ما گدرت أتصل بـ $SSID — تأكد من الاسم وكلمة المرور"
  nmcli connection modify alharthia-remote connection.autoconnect yes connection.autoconnect-priority 50 2>/dev/null || true
fi

echo "» 2/6 البرامج (متصفح خفيف + خط عربي)"
apt-get update || true
apt-get install -y --no-install-recommends cage fonts-noto-core fonts-dejavu-core curl python3 || true
BROWSER=""
if apt-get install -y --no-install-recommends cog >/dev/null 2>&1 || command -v cog >/dev/null; then BROWSER="cog"; fi
if [ -z "$BROWSER" ]; then
  apt-get install -y --no-install-recommends chromium-browser 2>/dev/null || apt-get install -y --no-install-recommends chromium || true
  command -v chromium-browser >/dev/null && BROWSER="chromium-browser"
  command -v chromium >/dev/null && BROWSER="chromium"
fi
[ -n "$BROWSER" ] || { echo "ما گدرت أنصب متصفح — تأكد من الإنترنت وعيد"; exit 1; }
echo "   المتصفح: $BROWSER"

echo "» 3/6 الربط ويا الصبورة"
TOKFILE="$H/.alharthia-remote-token"
TOKEN="$(cat "$TOKFILE" 2>/dev/null || true)"
if [ -n "$TOKEN" ] && curl -fs -H "X-Remote-Token: $TOKEN" "${URL}api/tasks" >/dev/null; then
  echo "   مربوط من قبل ✓"
else
  for try in 1 2 3; do
    echo "   على الصبورة: الإعدادات ← الريموت ← «ربط ريموت جديد»"
    read -r -p "   اكتب الرمز (٦ أرقام) الي طلع على الصبورة: " PIN
    PIN="$(echo "$PIN" | tr '٠١٢٣٤٥٦٧٨٩' '0123456789' | tr -cd '0-9')"
    R="$(curl -s -X POST -H 'Content-Type: application/json' -d "{\"pin\":\"$PIN\",\"name\":\"ريموت المعلم\"}" "${URL}api/pair" || true)"
    TOKEN="$(printf '%s' "$R" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("token",""))' 2>/dev/null || true)"
    [ -n "$TOKEN" ] && break
    echo "   ما انربط: $(printf '%s' "$R" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("error","الصبورة ما ترد"))' 2>/dev/null || echo 'الصبورة ما ترد — تأكد إنكم على نفس الشبكة')"
  done
  [ -n "$TOKEN" ] || { echo "فشل الربط — عيد تشغيل السكربت"; exit 1; }
  printf '%s' "$TOKEN" > "$TOKFILE"; chown "$U:$U" "$TOKFILE"; chmod 600 "$TOKFILE"
  echo "   انربط ✓"
fi

echo "» 4/6 الشاشة (Waveshare 5 إنج)"
CFG=/boot/firmware/config.txt; [ -f "$CFG" ] || CFG=/boot/config.txt
grep -q "Alharthia remote" "$CFG" || cat >> "$CFG" <<'CFGEOF'

# --- Alharthia remote: Waveshare 5inch HDMI LCD ---
hdmi_force_hotplug=1
max_usb_current=1
CFGEOF
CMD=/boot/firmware/cmdline.txt; [ -f "$CMD" ] || CMD=/boot/cmdline.txt
grep -q "video=HDMI-A-1" "$CMD" || sed -i '1 s/$/ video=HDMI-A-1:800x480M@60 consoleblank=0/' "$CMD"

echo "» 5/6 التشغيل التلقائي (الريموت يفتح وحده عند التشغيل)"
mkdir -p /etc/systemd/system/getty@tty1.service.d
cat > /etc/systemd/system/getty@tty1.service.d/autologin.conf <<AL
[Service]
ExecStart=
ExecStart=-/sbin/agetty --autologin $U --noclear %I \$TERM
AL
cat > "$H/.alharthia-remote.sh" <<RUN
#!/bin/bash
# يشغّل صفحة الريموت بكل الشاشة، وإذا انغلقت ترجع تفتح
TOKEN="\$(cat "\$HOME/.alharthia-remote-token" 2>/dev/null)"
PAGE="${URL}?k=\$TOKEN"
while true; do
  if [ "$BROWSER" = "cog" ]; then
    cage -s -- cog --platform=wl "\$PAGE"
  else
    cage -s -- $BROWSER --kiosk --noerrdialogs --disable-infobars --no-first-run --touch-events=enabled \
      --ozone-platform=wayland --user-data-dir="\$HOME/.alh-remote-browser" "\$PAGE"
  fi
  sleep 2
done
RUN
chmod 755 "$H/.alharthia-remote.sh"; chown "$U:$U" "$H/.alharthia-remote.sh"
PROFILE="$H/.bash_profile"
grep -q alharthia-remote "$PROFILE" 2>/dev/null || cat >> "$PROFILE" <<'PR'
# Alharthia remote — يفتح بس على الشاشة (tty1)، مو بالـ SSH
if [ "$(tty)" = "/dev/tty1" ]; then exec "$HOME/.alharthia-remote.sh"; fi
PR
chown "$U:$U" "$PROFILE"
usermod -aG video,input,render "$U" 2>/dev/null || true

echo "» 6/6 توفير البطارية"
# نطفي البلوتوث (ما نحتاجه) — الـ Wi-Fi يبقى
grep -q "dtoverlay=disable-bt" "$CFG" || echo "dtoverlay=disable-bt" >> "$CFG"
systemctl disable --now hciuart 2>/dev/null || true

echo
echo "تم ✓ — الريموت جاهز. أعد التشغيل:  sudo reboot"
echo "بعد الإقلاع تطلع صفحة الريموت وحدها (العنوان: $URL)"
