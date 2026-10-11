#!/bin/bash
# =====================================================================
# Alharthia OS — CamLink 2: يحوّل الراسبيري 4 + كاميرا الشريط (Camera Module 3 / NoIR)
# إلى كاميرا للراسبيري 5 (640×480 · 120 صورة/ثانية) عن طريق كيبل USB-C أو Ethernet.
#
# جديد بـ CamLink 2: واجهة لمس تطلع لمن توصل الراسبيري 4 بشاشة (مثل صبورة الصف):
#   معاينة الكاميرا · الواي فاي · زر «البث» (يعطي الإنترنت والصورة للراسبيري 5)
#
# يشتغل على الراسبيري 4 (Raspberry Pi OS 64-bit — Bookworm أو أحدث):
#     sudo bash camlink-pi4-setup.sh
# هذا الملف يتولد من ui-src/build.py — لا تعدله يدوياً (عدّل ui-src/camlink/setup.tmpl.sh).
# =====================================================================
set -e
[ "$(id -u)" = 0 ] || { echo "شغّله بـ sudo"; exit 1; }
U="${SUDO_USER:-}"; [ -n "$U" ] && [ "$U" != root ] || U="$(getent passwd 1000 | cut -d: -f1)"
H="$(getent passwd "$U" | cut -d: -f6)"
[ -d "$H" ] || { echo "ما لگيت المستخدم — شغّله بـ sudo من حسابك العادي"; exit 1; }

echo "» 1/6 البرامج (الكاميرا + متصفح الواجهة + خط عربي)…"
apt-get update || true
apt-get install -y --no-install-recommends python3-picamera2 python3-simplejpeg || apt-get install -y python3-picamera2
apt-get install -y --no-install-recommends network-manager dnsmasq-base iptables cage fonts-noto-core fonts-dejavu-core curl || true
BROWSER=""
apt-get install -y --no-install-recommends chromium-browser 2>/dev/null || apt-get install -y --no-install-recommends chromium 2>/dev/null || true
command -v chromium >/dev/null && BROWSER="chromium"
command -v chromium-browser >/dev/null && BROWSER="chromium-browser"
if [ -z "$BROWSER" ]; then
  apt-get install -y --no-install-recommends cog 2>/dev/null || true
  command -v cog >/dev/null && BROWSER="cog"
fi
[ -n "$BROWSER" ] && echo "   المتصفح: $BROWSER" || echo "تحذير: ما نزل متصفح — الكاميرا تشتغل بس الواجهة ما تطلع (تأكد من الإنترنت وعيد)"

echo "» 2/6 الواي فاي (العراق)…"
command -v raspi-config >/dev/null && raspi-config nonint do_wifi_country IQ 2>/dev/null || true
rfkill unblock wifi 2>/dev/null || true
systemctl enable --now NetworkManager 2>/dev/null || true

echo "» 3/6 برنامج البث والواجهة…"
install -d /opt/alharthia-camlink /var/lib/alharthia-camlink
cat > /opt/alharthia-camlink/alharthia_camlink.py <<'PYEOF'
__CAMLINK_PY__
PYEOF
cat > /opt/alharthia-camlink/pi4.html <<'HTMLEOF'
__PI4_HTML__
HTMLEOF
chmod 755 /opt/alharthia-camlink/alharthia_camlink.py

cat > /etc/systemd/system/alharthia-camlink.service <<'UNIT'
[Unit]
Description=Alharthia CamLink 2 — camera + touch page for the classroom Raspberry Pi 5
After=network.target NetworkManager.service
Wants=NetworkManager.service

[Service]
ExecStart=/usr/bin/python3 /opt/alharthia-camlink/alharthia_camlink.py
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable alharthia-camlink

echo "» 4/6 منفذ USB-C يصير شبكة صغيرة ويا الراسبيري 5…"
BOOT=/boot/firmware; [ -f $BOOT/config.txt ] || BOOT=/boot
if ! grep -q "alharthia camlink" $BOOT/config.txt; then
  printf '\n[all]\n# alharthia camlink: USB-C as a network device for the Raspberry Pi 5\ndtoverlay=dwc2,dr_mode=peripheral\n' >> $BOOT/config.txt
fi
printf 'dwc2\ng_ether\n' > /etc/modules-load.d/alharthia-camlink.conf
echo 'options g_ether host_addr=02:a1:7a:00:00:01 dev_addr=02:a1:7a:00:00:02' > /etc/modprobe.d/alharthia-camlink.conf
install -d -m 700 /etc/NetworkManager/system-connections
cat > /etc/NetworkManager/system-connections/alharthia-camlink.nmconnection <<'NM'
[connection]
id=alharthia-camlink
type=ethernet
autoconnect=true

[ethernet]
mac-address=02:A1:7A:00:00:02

[ipv4]
method=manual
address1=10.55.0.2/24
never-default=true

[ipv6]
method=disabled
NM
chmod 600 /etc/NetworkManager/system-connections/alharthia-camlink.nmconnection
nmcli connection reload 2>/dev/null || true
# ملاحظة: زر «البث» بالواجهة يحوّلها لـ shared (إنترنت للراسبيري 5) ويشغّل مشاركة الـ Ethernet (10.42.0.1)

echo "» 5/6 الشاشة: 1080p (حتى لو الصبورة 4K) …"
CMD=$BOOT/cmdline.txt
grep -q "video=HDMI-A-1" "$CMD" || sed -i '1 s/$/ video=HDMI-A-1:1920x1080@60 video=HDMI-A-2:1920x1080@60/' "$CMD"

echo "» 6/6 الواجهة تفتح وحدها لمن توصل شاشة…"
if [ -n "$BROWSER" ]; then
  if [ "$(systemctl get-default)" = "graphical.target" ]; then
    echo "   الجهاز كان يفتح سطح مكتب — نخليه يفتح واجهة CamLink بداله"
    systemctl set-default multi-user.target
  fi
  mkdir -p /etc/systemd/system/getty@tty1.service.d
  cat > /etc/systemd/system/getty@tty1.service.d/autologin.conf <<AL
[Service]
ExecStart=
ExecStart=-/sbin/agetty --autologin $U --noclear %I \$TERM
AL
  cat > "$H/.alharthia-camlink-ui.sh" <<RUN
#!/bin/bash
# واجهة CamLink — تشتغل بس لمن تنربط شاشة HDMI، وتنطفي لمن تنفصل (حتى ما تاكل من المعالج)
PAGE="http://127.0.0.1:8767/"
hdmi(){ grep -qs '^connected' /sys/class/drm/card*-HDMI-A-*/status; }
while true; do
  if hdmi; then
    if [ "$BROWSER" = "cog" ]; then
      cage -s -- cog --platform=wl "\$PAGE" &
    else
      cage -s -- $BROWSER --kiosk --noerrdialogs --disable-infobars --no-first-run --touch-events=enabled \\
        --ozone-platform=wayland --password-store=basic --overscroll-history-navigation=0 --disable-pinch \\
        --check-for-update-interval=31536000 --user-data-dir="\$HOME/.alh-camlink-browser" "\$PAGE" &
    fi
    P=\$!
    while kill -0 \$P 2>/dev/null; do sleep 3; hdmi || { kill \$P 2>/dev/null; break; }; done
    wait \$P 2>/dev/null
    sleep 2
  else
    sleep 3
  fi
done
RUN
  chmod 755 "$H/.alharthia-camlink-ui.sh"; chown "$U:$U" "$H/.alharthia-camlink-ui.sh"
  PROFILE="$H/.bash_profile"
  grep -q alharthia-camlink-ui "$PROFILE" 2>/dev/null || cat >> "$PROFILE" <<'PR'
# Alharthia CamLink — الواجهة تفتح بس على الشاشة (tty1)، مو بالـ SSH
if [ "$(tty)" = "/dev/tty1" ]; then exec "$HOME/.alharthia-camlink-ui.sh"; fi
PR
  chown "$U:$U" "$PROFILE"
  usermod -aG video,input,render "$U" 2>/dev/null || true
fi

echo
echo "✓ خلص. هسه:"
echo "  1) طفّي الراسبيري 4."
echo "  2) وصّله بالراسبيري 5: كيبل USB-C (بأي منفذ USB-A بالراسبيري 5)، أو كيبل Ethernet ويا شاحنه."
echo "  3) حتى تشوف الواجهة: وصّل HDMI واللمس (USB) مال الصبورة بالراسبيري 4 مؤقتاً."
echo "  4) بالراسبيري 5: الإعدادات ← الكاميرا ← «كاميرا الراسبيري 4»."
read -r -p "إعادة تشغيل هسه؟ [Y/n] " a; [ "${a:-Y}" = n ] || reboot
