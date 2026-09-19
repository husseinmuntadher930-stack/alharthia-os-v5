#!/bin/bash
# Update a running Alharthia OS without rebuilding the image.
# Usage on the Pi (needs internet for the new packages):  sudo bash tools/update-on-pi.sh
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
U="${SUDO_USER:-teacher}"
H="$(getent passwd "$U" | cut -d: -f6)"

echo "» تنزيل البرامج الجديدة (الكيبورد، مشغل الوسائط، أجهزة الصوت)…"
apt-get update || true
for p in git ca-certificates unzip openssl python3-dbus dbus-user-session grim wtype mpv pulseaudio-utils python3-gi gir1.2-gtk-3.0 gir1.2-gtklayershell-0.1 \
	gir1.2-webkit2-4.1 gir1.2-atspi-2.0 at-spi2-core lswt wlrctl fonts-noto-color-emoji \
	ffmpeg wf-recorder uxplay avahi-daemon gstreamer1.0-plugins-base gstreamer1.0-plugins-good \
	gstreamer1.0-plugins-bad gstreamer1.0-gl gstreamer1.0-wayland gstreamer1.0-libav; do
	apt-get install -y --no-install-recommends "$p" || echo "تحذير: ما نزل $p"
done

echo "» تحديث الواجهة…"
python3 "$ROOT/ui-src/build.py"
cp -a "$ROOT/shell/." /opt/alharthia/
rm -f /opt/alharthia/alharthia_kbd_button.py
chmod 755 /opt/alharthia/*.py
install -m 755 "$ROOT/shell/helper/alharthia-helper" /usr/lib/alharthia/alharthia-helper
install -m 755 "$ROOT/shell/helper/alharthia-airplay-run" /usr/lib/alharthia/alharthia-airplay-run
install -m 755 "$ROOT/stage-alharthia/01-shell/files/alharthia-session" /usr/bin/alharthia-session
install -m 755 "$ROOT/stage-alharthia/01-shell/files/alharthia-keyboard-setup" /usr/bin/alharthia-keyboard-setup
install -m 644 -o "$U" -g "$U" "$ROOT/stage-alharthia/02-session/files/rc.xml" "$H/.config/labwc/rc.xml"
install -m 755 -o "$U" -g "$U" "$ROOT/stage-alharthia/02-session/files/autostart" "$H/.config/labwc/autostart"
install -m 644 -o "$U" -g "$U" "$ROOT/stage-alharthia/02-session/files/environment" "$H/.config/labwc/environment"

# AirPlay receiver (آيفون / آيباد يعكسون شاشتهم على الجهاز) — يشتغل عند الطلب فقط
cat > /etc/systemd/system/alharthia-airplay.service <<UNIT
[Unit]
Description=Alharthia OS — AirPlay screen receiver (iPhone / iPad)
After=avahi-daemon.service network-online.target
Wants=avahi-daemon.service

[Service]
User=${U}
Environment=XDG_RUNTIME_DIR=/run/user/$(id -u "$U")
Environment=WAYLAND_DISPLAY=wayland-0
Environment=GST_GL_API=gles2
Environment=ALH_AIRPLAY_NAME=Alharthia
ExecStart=/usr/lib/alharthia/alharthia-airplay-run
Restart=no

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload || true
systemctl enable avahi-daemon 2>/dev/null || true
systemctl start avahi-daemon 2>/dev/null || true

bash "$ROOT/tools/fix-bluetooth.sh" || true
pkill -f squeekboard || true
pkill -f alharthia_server.py || true
pkill -f alharthia_host.py || true
echo "تم التحديث. أعد تشغيل الجهاز حتى يشتغل الكيبورد الجديد بكل البرامج:  sudo reboot"
