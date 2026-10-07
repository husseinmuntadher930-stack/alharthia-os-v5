
/* =====================================================================
   فحص اللمس + كاميرا مساعدة للمس (تجريبية)
   - فحص اللمس: يقيس كم نقطة لمس توصل بالثانية من الشاشة التفاعلية
   - الكاميرا: كاميرا USB فوك الصبورة تتابع الإصبع/القلم وترسم «ذيل» مؤقت للخط
     لحد ما توصل نقاط الشاشة. الخط المحفوظ دائماً من نقاط الشاشة نفسها.
   ===================================================================== */
ICONS.target='<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4M1 12h4M19 12h4"/>';
const TouchTest={
  render(){
    const c=$('#touchTest'); if(!c) return;
    c.innerHTML=`<h3>${icon('cursor')}فحص سرعة اللمس</h3>
      <p class="hint">ارسم بإصبعك أو القلم داخل المربع — يطلعلك كم نقطة توصل من الشاشة بالثانية. كلما أكثر، الخط أنعم وأسرع.</p>
      <div class="tt-pad" id="ttPad"><canvas></canvas><div class="tt-hint">ارسم هنا</div></div>
      <div class="tt-stats"><div><b id="ttHz">—</b><span>نقطة بالثانية</span></div><div><b id="ttGap">—</b><span>أطول فجوة (ms)</span></div><div><b id="ttType">—</b><span>نوع الإدخال</span></div><div><b id="ttVerdict">—</b><span>التقييم</span></div></div>
      <div class="row"><label>توقّع حركة القلم<span class="hint">يرسم الخط شوية قدّام الإصبع حتى يحس أسرع (مؤقت، ما ينحفظ)</span></label><label class="sw"><input type="checkbox" id="sPredict" ${S.predict!==false?'checked':''}><span></span></label></div>`;
    paintIcons(c);
    $('#sPredict').onchange=e=>{ S.predict=e.target.checked; save(); };
    const pad=$('#ttPad'), cv=$('canvas',pad), x=cv.getContext('2d');
    const size=()=>{ const r=pad.getBoundingClientRect(), d=devicePixelRatio||1; cv.width=r.width*d; cv.height=r.height*d; x.setTransform(d,0,0,d,0,0); };
    size();
    let pts=0, t0=0, last=0, gap=0, prev=null, live=0;
    const show=(final)=>{ const dt=(performance.now()-t0)/1000; if(dt<.15) return; const hz=Math.round(pts/dt);
      $('#ttHz').textContent=nf(hz); $('#ttGap').textContent=nf(Math.round(gap));
      $('#ttVerdict').textContent=hz>=90?'ممتاز':hz>=55?'جيد':hz>=30?'مقبول':'بطيء'; };
    pad.onpointerdown=e=>{ e.preventDefault(); try{pad.setPointerCapture(e.pointerId);}catch(_){} size(); pad.classList.add('on');
      pts=0; gap=0; t0=last=performance.now(); prev=[e.offsetX,e.offsetY]; live=e.pointerId;
      $('#ttType').textContent={touch:'لمس',pen:'قلم',mouse:'ماوس'}[e.pointerType]||e.pointerType; };
    pad.onpointermove=e=>{ if(e.pointerId!==live) return; const now=performance.now(); gap=Math.max(gap,now-last); last=now;
      const evs=(e.getCoalescedEvents&&e.getCoalescedEvents().length)?e.getCoalescedEvents():[e];
      x.strokeStyle=getComputedStyle(document.documentElement).getPropertyValue('--acc')||'#f0703e'; x.lineWidth=3; x.lineCap='round';
      const r=pad.getBoundingClientRect();
      for(const ev of evs){ const p=[ev.clientX-r.left,ev.clientY-r.top]; pts++; x.beginPath(); x.moveTo(prev[0],prev[1]); x.lineTo(p[0],p[1]); x.stroke();
        x.fillStyle='#111'; x.fillRect(p[0]-1.5,p[1]-1.5,3,3); prev=p; }
      if(pts%6===0) show(); };
    pad.onpointerup=pad.onpointercancel=e=>{ if(e.pointerId!==live) return; live=0; show(true); pad.classList.remove('on'); };
  }
};

const CamAssist={
  st:null, es:null, cur:null, lastPost:0, previewT:0, busy:false,
  async init(){
    for(let i=0;i<40&&!(window.Native&&Native.on);i++) await new Promise(r=>setTimeout(r,250));
    if(!(window.Native&&Native.on)) return;
    this.hook();
    await this.refresh();
    setInterval(()=>{ if(current==='settings'&&$('#camCard')&&!$('#camCard').closest('[hidden]')) this.refresh(true); },4000);
  },
  async refresh(quiet){
    try{ this.st=await API.get('/api/cam'); }catch(e){ this.st=null; }
    this.sync(); if(!quiet||!this.busy) this.renderCard();
  },
  live(){ const s=this.st; return !!(s&&s.enabled&&s.calibrated&&s.running); },
  sync(){
    const on=this.live();
    if(on&&!this.es){
      this.es=new EventSource('/api/cam/events?t='+encodeURIComponent(API.tok||''));
      this.es.onmessage=m=>{ try{ this.onEst(JSON.parse(m.data)); }catch(_){} };
    } else if(!on&&this.es){ this.es.close(); this.es=null; }
  },
  /* ربط السبورة: نخبر الكاميرا وين بدأ الإصبع ووين وصل (كل ٤٠ms) */
  hook(){
    const B=Board, d=B.down.bind(B), mv=B.move.bind(B), up=B.up.bind(B);
    B.down=e=>{ d(e); if(!this.live()) return; const st=B.act.get(e.pointerId); if(st&&st.kind==='ink'){ this.cur=st; this.post('down',e); } };
    B.move=e=>{ mv(e); const st=B.act.get(e.pointerId); if(st&&st===this.cur){ st.cam=null; if(performance.now()-this.lastPost>40) this.post('move',e); } };
    B.up=(e,c)=>{ const st=B.act.get(e.pointerId); up(e,c); if(st&&st===this.cur){ this.cur=null; this.post('up',e); } };
  },
  post(p,e){
    this.lastPost=performance.now();
    API.post('/api/cam/touch',{p,x:e.clientX/innerWidth,y:e.clientY/innerHeight}).catch(()=>{});
  },
  onEst(ev){
    const st=this.cur; if(!st||ev.up||ev.x==null||!st.raw) return;
    const q=Board.pt({clientX:ev.x*innerWidth,clientY:ev.y*innerHeight}), W=Board.W;
    if(Math.hypot(q[0]-st.raw[0],q[1]-st.raw[1])*W>120) return;      // بعيد كلش = غلط بالمتابعة، نتجاهله
    st.cam=[q]; Board.sched();
  },
  /* ---------- بطاقة الإعدادات ---------- */
  renderCard(){
    const c=$('#camCard'); if(!c) return;
    const head=`<h3>${icon('camera')}كاميرا مساعدة للمس <span class="badge-exp">تجريبي</span></h3>
      <p class="hint">ركّب كاميرا USB فوك الصبورة وموجّهة لتحت على الشاشة. الكاميرا تتابع الإصبع والقلم وتخلي الخط يلحك إيدك أسرع لما اللمس يتأخر. النظام يشتغل عادي بدونها.</p>`;
    if(!(window.Native&&Native.on)){ c.innerHTML=head+`<div class="cam-note">${icon('info')}هذي الميزة تشتغل على جهاز الصف نفسه.</div>`; paintIcons(c); return; }
    const s=this.st;
    if(!s){ c.innerHTML=head+`<div class="cam-note">${icon('info')}تعذر الاتصال بخدمة الكاميرا.</div>`; paintIcons(c); return; }
    const opts=[`<option value="">بدون كاميرا</option>`].concat(s.cams.map(k=>`<option value="${esc(k.id)}" ${k.id===s.id?'selected':''}>${esc(k.name)}</option>`));
    if(s.id&&!s.connected) opts.push(`<option value="${esc(s.id)}" selected>الكاميرا المختارة (مفصولة)</option>`);
    const stTxt=!s.cv?'لازم تنزيل OpenCV':!s.id?'ما مختار كاميرا':!s.connected?'الكاميرا مفصولة':s.error?s.error:
      s.running?`شغالة — ${nf(Math.round(s.fps||0))} صورة/ثانية`:'متوقفة';
    c.innerHTML=head+`
      <div class="row"><label>الكاميرا<span class="hint">${s.cams.length?'نتعرف على كل كاميرات USB الموصولة':'ماكو كاميرا USB موصولة هسه'}</span></label>
        <select class="field" data-cam="sel">${opts.join('')}</select><button class="btn sm ghost" data-cam="scan" title="تحديث">${icon('restart')}</button></div>
      <div class="row"><label>تشغيل مساعدة الكاميرا<span class="hint">${s.calibrated?'معايرة جاهزة':'تحتاج معايرة أول مرة'}</span></label><label class="sw"><input type="checkbox" data-cam="on" ${s.enabled?'checked':''} ${s.id&&s.cv?'':'disabled'}><span></span></label></div>
      <div class="row"><label>المعايرة<span class="hint">تطلع نقاط بيضاء على الشاشة والكاميرا تتعلم مكانها — لا توقف قدام الشاشة</span></label><button class="btn sm${s.calibrated?'':' primary'}" data-cam="calib" ${s.id&&s.cv&&s.connected?'':'disabled'}>${icon('target')}${s.calibrated?'إعادة المعايرة':'معايرة'}</button></div>
      <div class="row"><span class="lbl">الحالة</span><b class="cam-st${s.running&&!s.error?' ok':''}">${esc(stTxt)}</b></div>
      ${!s.cv?`<div class="cam-note">${icon('info')}<span>المتابعة تحتاج مكتبة OpenCV. تنزل وحدها مع التحديث، أو بالطرفية: <code dir="ltr">sudo apt install python3-opencv</code></span></div>`:''}
      ${s.id&&s.connected&&s.cv?`<div class="cam-pv"><img id="camPv" alt=""><span>معاينة الكاميرا</span></div>`:''}`;
    paintIcons(c);
    $('[data-cam=sel]',c).onchange=async e=>{ await this.cfg({id:e.target.value||'',enabled:e.target.value?s.enabled:false}); };
    $('[data-cam=scan]',c).onclick=()=>this.refresh();
    const on=$('[data-cam=on]',c); if(on) on.onchange=async e=>{ if(e.target.checked&&!s.calibrated){ e.target.checked=false; toast('سوّي المعايرة أول',false); return; } await this.cfg({enabled:e.target.checked}); toast(e.target.checked?'مساعدة الكاميرا تشتغل':'مساعدة الكاميرا مطفية'); };
    const cb=$('[data-cam=calib]',c); if(cb) cb.onclick=()=>this.calibrate();
    this.preview();
  },
  async cfg(b){ try{ this.st=await API.post('/api/cam',b); }catch(e){ toast(errMsg(e),false); } this.sync(); this.renderCard(); },
  preview(){
    clearTimeout(this.previewT); const img=$('#camPv'); if(!img||current!=='settings'||img.closest('[hidden]')) return;
    const n=new Image(); n.onload=()=>{ if(img.isConnected){ img.src=n.src; this.previewT=setTimeout(()=>this.preview(),300); } };
    n.onerror=()=>{ this.previewT=setTimeout(()=>this.preview(),1500); };
    n.src='/api/cam/snap.jpg?t='+encodeURIComponent(API.tok||'')+'&r='+Date.now();
  },
  /* ---------- المعايرة: ٩ نقاط وحدة وحدة على شاشة سودة ---------- */
  async calibrate(){
    if(this.busy) return; this.busy=true;
    const ov=document.createElement('div'); ov.id='camCalib';
    ov.innerHTML=`<div class="cc-txt"><b>معايرة الكاميرا</b><span>لا توقف بين الكاميرا والشاشة لحد ما تخلص النقاط</span></div><i class="cc-dot" hidden></i><button class="cc-x" aria-label="إلغاء">${icon('x')}</button>`;
    document.body.appendChild(ov); paintIcons(ov);
    let stop=false; $('.cc-x',ov).onclick=()=>{ stop=true; };
    const dot=$('.cc-dot',ov), wait=ms=>new Promise(r=>setTimeout(r,ms));
    const done=async(msg,ok)=>{ ov.remove(); this.busy=false; if(msg) toast(msg,ok); await this.refresh(); };
    try{
      await wait(900); if(stop) throw 0;
      await API.post('/api/cam/calib',{step:'begin'});
      const P=[]; for(const y of [.12,.5,.88]) for(const x of [.08,.5,.92]) P.push([x,y]);
      let found=0;
      for(const [x,y] of P){
        if(stop) throw 0;
        Object.assign(dot.style,{left:x*100+'%',top:y*100+'%'}); dot.hidden=false; await wait(380);
        const r=await API.post('/api/cam/calib',{step:'point',x,y}); dot.hidden=true; if(r.found) found++;
        await wait(260);
      }
      if(found<4){ await API.post('/api/cam/calib',{step:'cancel'}).catch(()=>{}); return done('الكاميرا شافت '+nf(found)+' نقاط بس — وجّهها على الشاشة كلها وعيد',false); }
      const r=await API.post('/api/cam/calib',{step:'finish'});
      await this.cfg({enabled:true});
      return done('تمت المعايرة ('+nf(r.used)+' من '+nf(found)+' نقاط) — مساعدة الكاميرا تشتغل',true);
    }catch(e){
      await API.post('/api/cam/calib',{step:'cancel'}).catch(()=>{});
      return done(e===0?'انلغت المعايرة':errMsg(e),false);
    }
  }
};

/* =====================================================================
   شاشة الكاميرا بالإعدادات — بث مباشر من كاميرا USB (مثل PS3 Eye)
   ===================================================================== */
const CamView={
  st:null, poll:0, sig:'', mirror:false, ph:'',
  el(){ return $('#setMain .sec[data-sec=camera]'); },
  stop(){ clearInterval(this.poll); this.poll=0; const im=$('#cvImg'); if(im){ im.removeAttribute('src'); } },
  async render(){
    const el=this.el(); if(!el) return; this.mirror=!!S.camMirror;
    const head=`<h1 class="h1">الكاميرا</h1><p class="sub">اربط كاميرا USB أو كاميرا الراسبيري بالشريط وشوف الصورة مباشرة.</p>`;
    if(!(window.Native&&Native.on)){ el.innerHTML=head+`<div class="card"><div class="cam-note">${icon('info')}<span>الكاميرا تشتغل على جهاز الصف نفسه (مو بمعاينة المتصفح).</span></div></div>`; paintIcons(el); return; }
    el.innerHTML=head+`<div class="card"><div class="empty"><div class="spin"></div>جاري البحث عن الكاميرا…</div></div>`;
    await this.load(true);
    clearInterval(this.poll); this.poll=setInterval(()=>{ if(isShown('settings')&&this.el()&&!this.el().hidden) this.load(false); else this.stop(); },3000);
  },
  async load(first){
    let s; try{ s=await API.get('/api/cam'); }catch(e){ s=null; }
    this.st=s;
    // كاميرا وحدة موصولة وما مختارة؟ نختارها لوحدنا
    if(s&&s.cv&&!s.id&&s.cams.length===1){ try{ this.st=s=await API.post('/api/cam',{id:s.cams[0].id}); }catch(e){} }
    const sig=s?JSON.stringify([s.cams.map(c=>c.id),s.id,s.connected,s.cv]):'x';
    if(first||sig!==this.sig){ this.sig=sig; this.draw(); } else this.status();
  },
  status(){
    const s=this.st, b=$('#cvStat'); if(!b||!s) return;
    const txt=s.error?s.error:s.running?`شغالة — ${nf(Math.round(s.fps||0))} صورة/ثانية${s.size&&s.size[0]?` · ${nf(s.size[0])}×${nf(s.size[1])}`:''}`:'متوقفة';
    b.textContent=txt; b.classList.toggle('ok',!!(s.running&&!s.error));
  },
  draw(){
    const el=this.el(); if(!el) return; const s=this.st;
    const head=`<h1 class="h1">الكاميرا</h1><p class="sub">اربط كاميرا USB أو كاميرا الراسبيري بالشريط وشوف الصورة مباشرة.</p>`;
    if(!s){ el.innerHTML=head+`<div class="card"><div class="cam-note">${icon('info')}تعذر الاتصال بخدمة الكاميرا.</div><div class="btns" style="margin-top:12px"><button class="btn" data-cv="reload">${icon('restart')}إعادة المحاولة</button></div></div>`; paintIcons(el); this.bind(); return; }
    const cur=s.cams.find(c=>c.id===s.id);
    const opts=[`<option value="">— اختر كاميرا —</option>`].concat(s.cams.map(k=>`<option value="${esc(k.id)}" ${k.id===s.id?'selected':''}>${esc(k.name)}</option>`));
    const live=!!(s.cv&&cur);
    const note=!s.cv?`<div class="cam-note">${icon('info')}<span>عرض الكاميرا يحتاج مكتبة OpenCV. تنزل وحدها مع التحديث، أو بالطرفية: <code dir="ltr">sudo apt install python3-opencv</code></span></div>`
      :!s.cams.length?`<div class="cam-note">${icon('info')}<span>ماكو كاميرا موصولة. وصّل كاميرا USB أو كاميرا الشريط (والجهاز مطفي) وراح تطلع هنا لحالها.</span></div>`
      :!cur?`<div class="cam-note">${icon('info')}<span>اختر الكاميرا من القائمة حتى تبدي الصورة.</span></div>`:'';
    const csi=cur&&cur.vidpid==='csi'?`<div class="cam-note">${icon('info')}<span>كاميرا الشريط (CSI): إذا ركّبتها فوك الصبورة وطلعت الصورة مقلوبة اضغط «تدوير».${/noir/i.test(cur.name)?' كاميرا NoIR ألوانها تطلع وردية شوية — هذا طبيعي.':''}</span></div>`:'';
    const eye=cur&&/PlayStation Eye/i.test(cur.name)?`<div class="cam-note">${icon('info')}<span>PS3 Eye: على العدسة حلقة بنقطتين — خلي النقطة <b>الزرقاء</b> (زاوية واسعة) حتى تشوف الشاشة كلها.</span></div>`:'';
    el.innerHTML=head+`<div class="card">
      <div class="row"><label>الكاميرا<span class="hint">${s.cams.length?'كل الكاميرات الموصولة (USB أو الشريط)':'ماكو كاميرا موصولة'}</span></label>
        <select class="field" data-cv="sel">${opts.join('')}</select><button class="btn sm ghost" data-cv="scan" title="تحديث">${icon('restart')}</button></div>
      ${note}${eye}${csi}
      ${live?`<div class="cv-box${this.mirror?' mir':''}${S.camRot?' rot':''}" id="cvBox"><img id="cvImg" alt=""><div class="cv-err" id="cvErr" hidden></div>
        <div class="cv-bar"><b class="cam-st" id="cvStat">…</b><span class="grow"></span>
          <button class="btn sm" data-cv="mir">${icon('swap')}قلب الصورة</button>
          <button class="btn sm" data-cv="rot">${icon('restart')}تدوير</button>
          <button class="btn sm" data-cv="snap">${icon('camera')}التقاط صورة</button>
          <button class="btn sm" data-cv="full">${icon('fit')}ملء الشاشة</button></div></div>`:''}
    </div>`;
    paintIcons(el); this.bind(); this.status();
    if(live) this.play(); 
  },
  play(){
    const im=$('#cvImg'); if(!im) return; const err=$('#cvErr');
    im.onload=()=>{ err.hidden=true; const bx=$('#cvBox'); if(bx&&im.naturalWidth) bx.style.aspectRatio=im.naturalWidth+'/'+im.naturalHeight; };
    im.onerror=()=>{ err.hidden=false; err.innerHTML=`${icon('info')}<span>${esc((this.st&&this.st.error)||'ما وصلت صورة من الكاميرا')}</span><button class="btn sm" data-cv="retry">إعادة المحاولة</button>`; paintIcons(err); };
    im.src='/api/cam/stream?t='+encodeURIComponent(API.tok||'')+'&r='+Date.now();
  },
  bind(){
    const el=this.el(); if(!el||el._cvb) return; el._cvb=true;
    el.addEventListener('change',async e=>{ const sel=e.target.closest('[data-cv=sel]'); if(!sel) return;
      try{ await API.post('/api/cam',{id:sel.value||''}); }catch(err){ toast(errMsg(err),false); } this.load(true); });
    el.addEventListener('click',async e=>{ const b=e.target.closest('[data-cv]'); if(!b) return; const a=b.dataset.cv;
      if(a==='scan'||a==='reload'){ this.load(true); }
      if(a==='retry'){ this.play(); }
      if(a==='mir'){ this.mirror=!this.mirror; S.camMirror=this.mirror; save(); const bx=$('#cvBox'); bx&&bx.classList.toggle('mir',this.mirror); }
      if(a==='rot'){ S.camRot=!S.camRot; save(); const bx=$('#cvBox'); bx&&bx.classList.toggle('rot',!!S.camRot); }
      if(a==='full'){ const bx=$('#cvBox'); try{ if(document.fullscreenElement) await document.exitFullscreen(); else await bx.requestFullscreen(); }catch(err){ toast('تعذر ملء الشاشة',false); } }
      if(a==='snap'){ try{ const r=await API.post('/api/cam/save',{}); toast('انحفظت الصورة: '+r.name); }catch(err){ toast(errMsg(err),false); } }
    });
  }
};
{ const h=onHide.settings; onHide.settings=()=>{ h&&h(); CamView.stop(); }; }
