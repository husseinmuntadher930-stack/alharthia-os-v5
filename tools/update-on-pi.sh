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
	gstreamer1.0-plugins-bad gstreamer1.0-gl gstreamer1.0-wayland gstreamer1.0-libav python3-numpy python3-opencv python3-picamera2 rpicam-apps-lite python3-gi-cairo python3-cairo; do
	apt-get install -y --no-install-recommends "$p" || echo "تحذير: ما نزل $p"
done

echo "» تحديث الواجهة…"
python3 "$ROOT/ui-src/build.py"
cp -a "$ROOT/shell/." /opt/alharthia/
# 3.0: سكربت تجهيز ريموت المعلم — الـ Zero ينزله من الصبورة نفسها (http://IP:8770/setup.sh)
install -m 644 "$ROOT/tools/remote-zero-setup.sh" /opt/alharthia/remote-zero-setup.sh
rm -f /opt/alharthia/alharthia_kbd_button.py
chmod 755 /opt/alharthia/*.py
install -m 755 "$ROOT/shell/helper/alharthia-helper" /usr/lib/alharthia/alharthia-helper
install -m 755 "$ROOT/shell/helper/alharthia-airplay-run" /usr/lib/alharthia/alharthia-airplay-run
install -m 755 "$ROOT/stage-alharthia/01-shell/files/alharthia-session" /usr/bin/alharthia-session
install -m 755 "$ROOT/stage-alharthia/01-shell/files/alharthia-keyboard-setup" /usr/bin/alharthia-keyboard-setup
install -m 644 -o "$U" -g "$U" "$ROOT/stage-alharthia/02-session/files/rc.xml" "$H/.config/labwc/rc.xml"
install -m 755 -o "$U" -g "$U" "$ROOT/stage-alharthia/02-session/files/autostart" "$H/.config/labwc/autostart"
install -m 644 -o "$U" -g "$U" "$ROOT/stage-alharthia/02-session/files/environment" "$H/.config/labwc/environment"
# CamLink: الراسبيري 4 + كاميرا الشريط عن طريق USB-C (شبكة صغيرة 10.55.0.x)
install -d -m 700 /etc/NetworkManager/system-connections
install -m 600 "$ROOT/stage-alharthia/02-session/files/alharthia-camlink.nmconnection" /etc/NetworkManager/system-connections/alharthia-camlink.nmconnection
nmcli connection reload 2>/dev/null || true
# CamLink 2: الإنترنت من الراسبيري 4 عبر USB-C — نطبّق الإعداد الجديد إذا الكيبل موصول
nmcli -w 8 connection up alharthia-camlink >/dev/null 2>&1 || true

# ساعة DS1302 (RTC): الصبورة تعرف الوقت حتى لو طفت وماكو إنترنت
apt-get install -y --no-install-recommends python3-lgpio || echo "تحذير: ما نزل python3-lgpio"
cat > /etc/systemd/system/alharthia-rtc.service <<UNIT
[Unit]
Description=Alharthia OS — DS1302 clock module (keeps time without internet)
After=time-sync.target systemd-timesyncd.service

[Service]
ExecStart=/usr/bin/python3 /opt/alharthia/alharthia_rtc.py daemon
Restart=always
RestartSec=30

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload || true
systemctl enable alharthia-rtc 2>/dev/null || true

# الكلام إلى نص من الريموت (بدون إنترنت): whisper.cpp + ملف اللغة (مرة وحدة، ~5 دقائق أول مرة)
WH=/opt/whisper.cpp
if [ ! -x "$WH/build/bin/whisper-cli" ] && [ ! -x "$WH/build/bin/main" ]; then
  echo "» تنصيب تحويل الكلام إلى نص (whisper.cpp) — ياخذ كم دقيقة أول مرة…"
  apt-get install -y --no-install-recommends build-essential cmake git || true
  if [ ! -d "$WH/.git" ]; then rm -rf "$WH"; git clone --depth 1 https://github.com/ggml-org/whisper.cpp "$WH" || echo "تحذير: ما نزل whisper.cpp"; fi
  if [ -d "$WH" ]; then
    (cd "$WH" && cmake -B build -DCMAKE_BUILD_TYPE=Release -DWHISPER_BUILD_TESTS=OFF -DWHISPER_BUILD_EXAMPLES=ON >/dev/null \
      && cmake --build build -j4 --config Release >/dev/null) || echo "تحذير: بناء whisper.cpp فشل"
  fi
fi
if [ -d "$WH" ] && [ ! -s "$WH/models/ggml-small-q5_1.bin" ]; then
  echo "» تنزيل ملف اللغة (~190MB)…"
  mkdir -p "$WH/models"
  curl -fL --retry 3 -o "$WH/models/ggml-small-q5_1.bin.part" \
    https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small-q5_1.bin \
    && mv "$WH/models/ggml-small-q5_1.bin.part" "$WH/models/ggml-small-q5_1.bin" \
    || echo "تحذير: ما نزل ملف اللغة — ميزة الكلام إلى نص ما تشتغل لين تحدّث والإنترنت شغال"
fi

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
