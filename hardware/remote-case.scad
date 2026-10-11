// =====================================================================
//  AlharthiaOS 3.0 — صندوق ريموت المعلم + ستاند الشحن اللاسلكي
//  Raspberry Pi Zero 2 W + Waveshare 5inch HDMI LCD + بطارية LiPo + مستقبل Qi
//
//  افتحه بـ OpenSCAD (مجاني) ← غيّر الأرقام تحت حسب قياس قطعك بالمسطرة
//  ← F6 ← Export STL. اطبع كل قطعة لحالها (part = "front" / "back" / "stand").
//  الطباعة: PLA أو PETG، طبقة 0.2 مم، تعبئة 20٪، بدون دعامات للواجهة والظهر.
// =====================================================================
part = "all";            // "front" | "back" | "stand" | "all"

// ---------- الشاشة (قيس شاشتك!) ----------
scr_w = 121.0;           // عرض لوحة الشاشة (مم)
scr_h = 77.2;            // ارتفاع لوحة الشاشة
scr_t = 6.5;             // سمك الشاشة مع البورد
view_w = 110.0;          // المنطقة الي تبين (العرض)
view_h = 64.0;           // المنطقة الي تبين (الارتفاع)
view_dx = 0;             // إزاحة المنطقة الظاهرة أفقياً (إذا مو بالنص)
view_dy = 0;

// ---------- القطع الداخلية ----------
zero_w = 65; zero_h = 30; zero_hole_dx = 58; zero_hole_dy = 23;   // Pi Zero 2 W (براغي M2.5)
bat_w = 60; bat_h = 50; bat_t = 8.5;      // بطارية LiPo 3.7V ‏2000–3000mAh
qi_d = 46; qi_t = 2.5;                    // ملف استقبال Qi (لاصق بالظهر من جوه)
chg_w = 26; chg_h = 18;                   // بورد الشحن والرفع لـ 5V (مثل MH-CD42 / IP5306)

// ---------- الصندوق ----------
wall = 2.2;
gap = 0.4;               // سماحية حتى القطع تدخل
depth = 22;              // عمق الظهر من جوه (الـ Zero + الكيبلات + البطارية)
r = 6;                   // تدوير الزوايا
in_w = scr_w + 2*gap; in_h = scr_h + 2*gap;
out_w = in_w + 2*wall; out_h = in_h + 2*wall;
$fn = 48;

module rbox(w, h, t, rr = r) {
  hull() for (x = [rr, w - rr], y = [rr, h - rr]) translate([x, y, 0]) cylinder(r = rr, h = t);
}

// ---------- الواجهة: إطار بفتحة الشاشة ----------
module front() {
  difference() {
    union() {
      rbox(out_w, out_h, 2);                                                  // الوجه
      translate([0, 0, 2]) difference() { rbox(out_w, out_h, scr_t); translate([wall, wall, -1]) rbox(in_w, in_h, scr_t + 2, r - wall); }
    }
    translate([(out_w - view_w) / 2 + view_dx, (out_h - view_h) / 2 + view_dy, -1]) rbox(view_w, view_h, 5, 2);   // فتحة الشاشة
    // شعار صغير محفور تحت الشاشة
    translate([out_w / 2, 4.2, 1.4]) linear_extrude(1) text("AlharthiaOS", size = 3.6, halign = "center", font = "DejaVu Sans:style=Bold");
  }
  // مشابك تمسك الظهر
  for (x = [out_w * 0.25, out_w * 0.75]) for (y = [wall - 0.2, out_h - wall - 1.4]) translate([x - 5, y, 2 + scr_t - 3]) cube([10, 1.6, 3]);
}

// ---------- الظهر: الـ Zero والبطارية والشحن ----------
module back() {
  difference() {
    union() {
      difference() {
        rbox(out_w, out_h, depth + wall);
        translate([wall, wall, wall]) rbox(in_w, in_h, depth + 1, r - wall);
      }
      // أعمدة براغي الـ Zero (M2.5)
      zx = wall + 10; zy = (out_h - zero_h) / 2;
      for (dx = [0, zero_hole_dx], dy = [0, zero_hole_dy])
        translate([zx + 3.5 + dx, zy + 3.5 + dy, wall]) difference() { cylinder(d = 5.5, h = 4); cylinder(d = 2.3, h = 5); }
      // حاجز البطارية
      bx = out_w - wall - bat_w - 4; by = (out_h - bat_h) / 2;
      translate([bx - 1.6, by - 1.6, wall]) difference() { cube([bat_w + 3.2, bat_h + 3.2, 4]); translate([1.6, 1.6, -1]) cube([bat_w, bat_h, 6]); }
      // جيب ملف الـ Qi (مركز الظهر)
      translate([out_w / 2, out_h / 2, wall]) difference() { cylinder(d = qi_d + 3, h = qi_t); translate([0, 0, -1]) cylinder(d = qi_d + 0.6, h = qi_t + 2); }
    }
    // فتحة شحن USB-C (لبورد الشحن) + زر التشغيل
    translate([out_w - wall - 1, out_h / 2 - 15, wall + 3]) cube([wall + 2, 10, 4.5]);
    translate([out_w - wall - 1, out_h / 2 + 6, wall + 3]) cube([wall + 2, 9.5, 4.5]);     // سويج انزلاقي
    // فتحة USB للـ Zero (فلاشة/كيبورد عند الحاجة)
    translate([-1, out_h / 2 - 5, wall + 4]) cube([wall + 2, 12, 7]);
    // فتحات تهوية
    for (i = [0:7]) translate([wall + 14 + i * 5, out_h - wall - 1, wall + depth * 0.45]) cube([2.4, wall + 2, depth * 0.35]);
    // جيب للأصابع بالظهر حتى يمسكه المعلم بسهولة
    translate([out_w / 2, -8, -1]) scale([2.4, 1, 1]) cylinder(r = 12, h = 1.6);
  }
}

// ---------- الستاند: يوكف الريموت بزاوية 65° وجواه شاحن Qi ----------
qi_pad_d = 72; qi_pad_t = 9;    // قيس شاحن الـ Qi مالتك (أغلبها 70×8 مم)
module stand() {
  ang = 65; base_d = 70; th = out_h * 0.62;
  difference() {
    union() {
      rbox(out_w + 10, base_d, qi_pad_t + 6, 8);                                   // القاعدة
      translate([5, 16, 0]) rotate([90 - ang, 0, 0]) translate([0, 0, 0]) cube([out_w, 6, th]);   // الظهر المائل
      translate([5, 6, qi_pad_t + 6]) cube([out_w, 10, 6]);                        // الحافة الي يكعد عليها الريموت
    }
    // جيب شاحن الـ Qi تحت مكان ظهر الريموت + ممر الكيبل
    translate([(out_w + 10) / 2, 34, -1]) cylinder(d = qi_pad_d + 1, h = qi_pad_t + 1);
    translate([(out_w + 10) / 2 - 5, 34, -1]) cube([10, base_d, 5]);
    translate([(out_w + 10) / 2, 12, qi_pad_t + 9]) linear_extrude(4) text("AlharthiaOS", size = 6, halign = "center", font = "DejaVu Sans:style=Bold");
  }
}

if (part == "front") front();
else if (part == "back") back();
else if (part == "stand") stand();
else { front(); translate([0, out_h + 12, 0]) back(); translate([0, -100, 0]) stand(); }
