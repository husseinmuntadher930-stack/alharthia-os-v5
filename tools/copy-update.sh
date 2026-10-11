#!/bin/bash
# =====================================================================
#  AlharthiaOS — نسخ ملف التحديث (zip) فوق فولدر المشروع على لينكس
#
#  الاستعمال:
#     bash copy-update.sh alharthia-os-v5-3.0.0.zip                 ← ينسخ لـ ~/alharthia-os-v2
#     bash copy-update.sh alharthia-os-v5-3.0.0.zip ~/my-folder     ← فولدر ثاني
#
#  إذا شغّلته على الـ Pi 5 (الصبورة)، يسألك بالآخر تحدّث النظام هسه لو لا.
# =====================================================================
set -e
ZIP="${1:-}"
DEST="${2:-$HOME/alharthia-os-v2}"

if [ -z "$ZIP" ]; then
  ZIP="$(ls -t alharthia-os*.zip 2>/dev/null | head -1 || true)"
  [ -n "$ZIP" ] || { echo "اكتب اسم ملف التحديث:  bash copy-update.sh alharthia-os-v5-3.0.0.zip"; exit 1; }
fi
[ -f "$ZIP" ] || { echo "ما لگيت الملف: $ZIP"; exit 1; }
command -v unzip >/dev/null || { echo "» تنزيل unzip…"; sudo apt-get install -y unzip; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
echo "» فك الضغط: $ZIP"
unzip -q "$ZIP" -d "$TMP"

# الملفات داخل فولدر alharthia-os-v2 (أو مباشرة بجذر الـ zip)
SRC="$TMP/alharthia-os-v2"
[ -d "$SRC" ] || SRC="$(dirname "$(find "$TMP" -maxdepth 3 -path '*/tools/update-on-pi.sh' | head -1)")/.."
[ -f "$SRC/tools/update-on-pi.sh" ] || { echo "هذا مو ملف تحديث AlharthiaOS"; exit 1; }

mkdir -p "$DEST"
N="$(find "$SRC" -type f | wc -l)"
echo "» نسخ $N ملف إلى: $DEST"
# ينسخ فوق القديم (استبدال)، وما يمسح أي ملف ثاني، وما يمس فولدر .git
( cd "$SRC" && find . -type f ! -path './.git/*' -print0 | while IFS= read -r -d '' f; do
    mkdir -p "$DEST/$(dirname "$f")"
    cp -f "$f" "$DEST/$f"
  done )
chmod +x "$DEST"/tools/*.sh 2>/dev/null || true
echo "✓ تم النسخ"

if [ -d "$DEST/.git" ] && command -v git >/dev/null; then
  echo
  echo "» الملفات الي تغيّرت:"
  git -C "$DEST" status --short | head -30
fi

# على الصبورة (Pi 5): نحدّث النظام مباشرة
if grep -qs "Raspberry Pi 5" /proc/device-tree/model; then
  echo
  read -r -p "هذا الجهاز هو الصبورة. تحدّث النظام هسه؟ [Y/n] " a
  if [ "${a:-Y}" != n ] && [ "${a:-Y}" != N ]; then
    sudo bash "$DEST/tools/update-on-pi.sh"
    read -r -p "إعادة تشغيل هسه؟ [Y/n] " b
    [ "${b:-Y}" = n ] || [ "${b:-Y}" = N ] || sudo reboot
  fi
  echo
  echo "ملاحظة: إذا بعدين حدّثت بـ git pull وطلع خطأ «local changes»، اكتب:"
  echo "  cd $DEST && git checkout -- . && git pull"
fi
