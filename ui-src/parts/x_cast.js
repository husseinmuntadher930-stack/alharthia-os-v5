
/* =====================================================================
   مشاركة الشاشة — استقبال شاشة جهاز ثاني على شاشة الصف.
   (اتجاه «عرض شاشة الصف على جهاز ثاني» انلغى بالإصدار 1.8)
   ===================================================================== */
ICONS.cast='<path d="M2 16.1A5 5 0 0 1 5.9 20M2 12.05A9 9 0 0 1 9.95 20M2 8V6a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-6"/><circle cx="2" cy="20" r="1" fill="currentColor"/>';
ICONS.screenIn='<rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 21h8M12 17v4"/><path d="M12 7v6M9 10l3 3 3-3"/>';
ICONS.phone='<rect x="6" y="2" width="12" height="20" rx="2"/><path d="M11 18h2"/>';
ICONS.qr='<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM19 14h2M14 19h3M19 18v3h2"/>';
ICONS.apple='<path d="M12 6c0-2 1.5-3.5 3.5-3.6C15.7 4.4 14.2 6 12 6Z"/><path d="M17.5 12.5c0-2 1.3-3 1.4-3.1-.8-1.1-2-1.3-2.5-1.3-1.1-.1-2.1.6-2.7.6-.6 0-1.4-.6-2.4-.6-1.8 0-3.7 1.5-3.7 4.3 0 1.7.6 3.5 1.5 4.7.7 1 1.4 1.8 2.4 1.8s1.3-.6 2.4-.6 1.4.6 2.4.6 1.7-.9 2.4-1.9c.5-.7.8-1.4 1-1.8-1.6-.7-2.2-2.2-2.2-2.7Z"/>';

const Cast={
  st:null, iv:0, full:false, fullIv:0, qrUrl:'', sig:'',
  async poll(){
    if(!(window.Native&&Native.on)){ this.st={on:false,demo:true}; this.render(); return; }
    try{ this.st=await API.get('/api/share'); }catch(e){ this.st={on:false,err:errMsg(e)}; }
    this.render();
  },
  async toggle(on){
    if(!(window.Native&&Native.on)){ toast('يشتغل على الجهاز الحقيقي فقط',false); return; }
    try{ this.st=await API.post('/api/share',{on}); this.render(true); toast(on?'مشاركة الشاشة شغالة':'تم الإيقاف'); }
    catch(e){ toast(errMsg(e),false); }
  },
  async airplay(on){
    if(!(window.Native&&Native.on)){ toast('يشتغل على الجهاز الحقيقي فقط',false); return; }
    try{ this.st=await API.post('/api/share',{airplay:on}); this.render(true);
      toast(on?'صار الجهاز يظهر باسم Alharthia بقائمة «عكس الشاشة»':'تم الإيقاف'); }
    catch(e){ toast(errMsg(e),false); }
  },
  drawQR(url){
    const cv=$('#castQR'); if(!cv||!url) return;
    try{ QR.draw(cv,url,6,3); this.qrUrl=url; }catch(e){ cv.remove(); }
  },
  render(force){
    const m=$('#castMain'); if(!m) return;
    const s=this.st||{};
    const sig=JSON.stringify([s.on,s.url,s.incoming,s.from,s.frames,s.airplay,s.airplayErr,s.https,s.pin]);
    if(!force&&sig===this.sig){ if(s.incoming) this.tickImg($('#castImg')); return; }
    this.sig=sig;
    const on=!!s.on, url=s.url||'', ap=s.airplay||'missing';
    m.innerHTML=`<div class="app-head"><h1 class="h1">مشاركة الشاشة</h1><span class="grow"></span>
        ${on?`<span class="cast-live">${icon('cast')}<span>شغّال</span></span>`:''}</div>

      <div class="card"><h3>${icon('screenIn')}اعرض شاشة جهاز ثاني على شاشة الصف</h3>
        <div class="row"><label for="castOn">تشغيل المشاركة<span class="hint">يشتغل بس وقت ما تشغّله، والرمز يتغير كل مرة</span></label>
          <label class="sw"><input type="checkbox" id="castOn" ${on?'checked':''}><span></span></label></div>
        ${on?`<div class="cast-url"><span class="hint">افتح هذا العنوان بمتصفح الكمبيوتر:</span><b dir="ltr">${esc(url)}</b>
            <div class="cast-qr"><canvas id="castQR"></canvas>
              <div class="qr-tip">${icon('qr')} صوّب كاميرا الهاتف على الرمز، أو اكتب العنوان بالمتصفح.</div></div>
            <div class="btns" style="margin-top:12px"><button class="btn sm" data-cast="copy">${icon('copy')}نسخ العنوان</button></div></div>

          <ol class="cast-steps"><li>افتح العنوان بمتصفح <b>كمبيوتر</b> (Chrome أو Edge).</li>
            <li>اضغط «شارك شاشتك مع شاشة الصف» — راح ينقلك لرابط آمن https.</li>
            <li>إذا طلع تحذير اضغط <b dir="ltr">Advanced</b> ثم <b dir="ltr">Proceed</b> (الشهادة محلية مالت جهاز الصف).</li>
            <li>اختار الشاشة أو النافذة.</li></ol>
          ${s.https===false?`<p class="hint" style="color:var(--warn)">${icon('info')} الرابط الآمن ما اشتغل — نفّذ: sudo apt install openssl</p>`:''}

          <div class="cast-state ${s.incoming?'ok':s.frames?'warn':''}">
            ${s.incoming?`${icon('check')} تستقبل الآن من <b>${esc(s.from||'جهاز')}</b> · ${nf(s.frames||0)} إطار`
              :s.frames?`${icon('info')} وصلت ${nf(s.frames)} إطار وبعدين توقفت${s.ago!=null?` (آخر إطار قبل ${nf(Math.round(s.ago))} ثانية)`:''}`
              :`${icon('info')} ما وصل ولا إطار بعد — افتح العنوان بالكمبيوتر واضغط «شارك شاشتك»`}</div>`
          :`<p class="hint">شغّله ويطلع لك عنوان ورمز QR تفتحه بالكمبيوتر.</p>`}
        ${s.incoming?`<div class="cast-in"><img id="castImg" alt="">
            <div class="btns" style="margin-top:10px"><button class="btn primary" data-cast="full">${icon('fit')}ملء الشاشة</button></div></div>`:''}
      </div>

      <div class="card"><h3>${icon('apple')}استقبال من آيفون / آيباد (AirPlay)</h3>
        <div class="row"><label for="castAir">تشغيل AirPlay
          <span class="hint">من تشغّله: مركز التحكم بالآيفون ← «عكس الشاشة» ← اختر <b dir="ltr">Alharthia</b></span></label>
          <label class="sw"><input type="checkbox" id="castAir" ${ap==='on'?'checked':''} ${ap==='missing'?'disabled':''}><span></span></label></div>
        ${ap==='missing'?`<p class="hint" style="color:var(--warn)">${icon('info')} غير مثبت — نفّذ: sudo apt install uxplay avahi-daemon</p>`:''}
        ${ap==='off'&&s.airplayErr?`<div class="cast-err">${icon('info')}<div><b>AirPlay انطفأ — هذا السبب:</b><div dir="ltr">${esc(s.airplayErr)}</div>
            <div class="hint" style="margin-top:8px">أغلب الأحيان حزم GStreamer ناقصة:<br><code dir="ltr">sudo apt install gstreamer1.0-plugins-base gstreamer1.0-plugins-good gstreamer1.0-plugins-bad gstreamer1.0-gl gstreamer1.0-wayland</code></div></div></div>`:''}
      </div>

      <div class="card"><h3>${icon('phone')}من هاتف أندرويد — تطبيق Alharthia Cast</h3>
        ${on?`<div class="cast-pin"><span class="hint">افتح التطبيق بالهاتف، يلگي الجهاز لوحده، وبعدها اكتب هذا الرمز:</span>
            <b dir="ltr">${esc(s.pin||'—')}</b><span class="hint">الرمز يتغير كل مرة تشغّل المشاركة.</span></div>`
          :`<p class="hint">شغّل المشاركة فوك ويطلع لك رمز الدخول.</p>`}
      </div>
      ${(window.Native&&Native.on)?'':'<div class="card"><p class="hint">هذي معاينة — المشاركة تشتغل على الراسبيري.</p></div>'}`;
    const t=$('#castOn'); if(t) t.onchange=()=>this.toggle(t.checked);
    const a=$('#castAir'); if(a) a.onchange=()=>this.airplay(a.checked);
    if(on&&url) this.drawQR(url);
    if(s.incoming) this.tickImg($('#castImg'));
  },
  imgUrl(){ return '/api/share/incoming.jpg?t='+encodeURIComponent(API.tok||'')+'&ts='+Date.now(); },
  tickImg(img){ if(!img) return; img.src=this.imgUrl(); },
  openFull(){
    this.full=true;
    const el=$('#castFull'); el.hidden=false;
    el.innerHTML=`<img alt=""><div class="cast-wait">${icon('info')} ما وصلت صورة بعد</div>
      <button class="btn ghost" data-cast="exitFull">${icon('x')}خروج</button>`;
    const img=el.querySelector('img');
    img.onload=()=>el.querySelector('.cast-wait')?.setAttribute('hidden','');
    img.onerror=()=>el.querySelector('.cast-wait')?.removeAttribute('hidden');
    clearInterval(this.fullIv);
    this.fullIv=setInterval(()=>{ img.src=this.imgUrl(); },250);
  },
  closeFull(){ this.full=false; clearInterval(this.fullIv); $('#castFull').hidden=true; },
  init(){
    document.addEventListener('click',async e=>{
      const b=e.target.closest('[data-cast]'); if(!b) return;
      const a=b.dataset.cast;
      if(a==='copy'){ try{ await navigator.clipboard.writeText(this.st.url); toast('تم نسخ العنوان'); }catch(er){ toast('انسخه يدوياً',false); } }
      if(a==='full') this.openFull();
      if(a==='exitFull') this.closeFull();
    });
  }
};
onShow.cast=()=>{ Cast.sig=''; Cast.poll(); clearInterval(Cast.iv); Cast.iv=setInterval(()=>{ if(current==='cast') Cast.poll(); },2000); };
onHide.cast=()=>{ clearInterval(Cast.iv); };
