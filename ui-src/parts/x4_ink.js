/* =====================================================================
   FAST INK — الكتابة السريعة
   برنامج صغير على الجهاز (alharthia_ink.py) يقرأ اللمس من الكيرنل مباشرة ويرسم
   «الحبر الطري» فوق الشاشة. الواجهة هنا تخبره: وين مسموح يرسم، اللون والسُمك،
   ومتى يوقف. وتسوي معايرة تلقائية: تقارن مكان اللمسة عندها ويا مكانها عنده.
   كل الإحداثيات نسبة من الشاشة (0..1).
   ===================================================================== */
const FastInk={
  last:'', cancel:0, pairs:[], bad:0, status:null, t:0,
  async init(){
    for(let i=0;i<40&&!(window.Native&&Native.on);i++) await new Promise(r=>setTimeout(r,250));
    if(!(window.Native&&Native.on)) return;
    if(S.fastInk===undefined) S.fastInk=true;
    Board.cLive.addEventListener('pointerdown',e=>this.onDown(e),true);
    this.t=setInterval(()=>this.sync(),150);
    this.poll();
  },
  async poll(){
    try{ this.status=await API.get('/api/ink'); }catch(e){ this.status=null; }
    if(isShown('settings')&&$('#inkCard')&&!$('#inkCard').closest('[hidden]')) this.renderCard();
    setTimeout(()=>this.poll(),8000);
  },
  cal(){ return S.inkCal&&S.inkCal.ok?S.inkCal:{ok:false}; },
  /* متى نرسم؟ بس بالسبورة/الكتابة فوق الشاشة، بالقلم، وبدون نوافذ فوقها */
  active(){
    const B=Board;
    if(!S.fastInk||(window.Split&&Split.nat)) return false;
    if(!(isShown('board')||(window.Annot&&Annot.on))) return false;
    if(B.tool!=='ink'||!['pen','fountain','callig'].includes(B.pen)) return false;
    if(B.inst.length||B.eyedrop||B.popName) return false;
    if($('#modalHost').children.length||document.documentElement.classList.contains('gated')) return false;
    const lk=$('#lock'); if(lk&&!lk.hidden) return false;
    if($('#camCalib')) return false;
    return true;
  },
  vis(el){
    if(!el||el.hidden) return null;
    const r=el.getBoundingClientRect(); if(r.width<2||r.height<2) return null;
    const cs=getComputedStyle(el); if(cs.visibility==='hidden'||cs.display==='none'||+cs.opacity<0.05) return null;
    return r;
  },
  nr(r){ const W=innerWidth, H=innerHeight, c=v=>Math.max(0,Math.min(1,v)); return [c(r.left/W),c(r.top/H),c(r.right/W),c(r.bottom/H)].map(v=>+v.toFixed(5)); },
  state(){
    const cal=this.cal();
    if(!this.active()) return {on:false,cal};
    const B=Board, live=this.vis(B.cLive); if(!live) return {on:false,cal};
    const deny=[];
    const add=el=>{ const r=this.vis(el); if(r) deny.push(this.nr(r)); };
    $$('#board > :not(#boardArea)').forEach(add);
    $$('#boardArea > :not(canvas):not(#instLayer)').forEach(add);
    $$('#instLayer > *').forEach(add);
    $$('#sideWrap > *, #spDiv, #osk, #topbar, #toast.on').forEach(add);
    const w=(B.sizes.ink/REF*B.W)/innerWidth;
    return {on:true,rect:this.nr(live),deny,color:B.color,width:+w.toFixed(5),tail:S.inkTail||110,cancel:this.cancel,cal};
  },
  sync(force){
    const st=this.state(), j=JSON.stringify(st);
    if(!force&&j===this.last) return;
    this.last=j; API.post('/api/ink',st).catch(()=>{});
  },
  /* لمسة على السبورة: نتأكد إنها كتابة فعلاً، ونجمع نقاط للمعايرة */
  onDown(e){
    if(e.pointerType!=='touch'||!S.fastInk) return;
    const B=Board;
    if((S.palm&&(e.width>55||e.height>55))||S.penOnly){ this.cancel++; this.sync(true); return; }
    const p={sx:e.clientX/innerWidth,sy:e.clientY/innerHeight,t:Date.now()/1000};
    setTimeout(async()=>{
      let r; try{ r=await API.get('/api/ink/last'); }catch(_){ return; }
      const ds=(r.downs||[]).filter(d=>d[2]<=p.t+0.05&&p.t-d[2]<0.8);
      if(!ds.length) return;
      const d=ds[ds.length-1];
      this.pairs=[...this.pairs,{nx:d[0],ny:d[1],sx:p.sx,sy:p.sy}].slice(-8);
      this.solve();
    },260);
  },
  err(c,p){ let u=p.nx, v=p.ny; if(c.swap) [u,v]=[v,u]; return Math.hypot(u*c.ax+c.bx-p.sx, v*c.ay+c.by-p.sy); },
  fit(us,ss){
    const n=us.length, mu=us.reduce((a,b)=>a+b,0)/n, ms=ss.reduce((a,b)=>a+b,0)/n;
    let cov=0, vu=0; for(let i=0;i<n;i++){ cov+=(us[i]-mu)*(ss[i]-ms); vu+=(us[i]-mu)**2; }
    if(Math.max(...us)-Math.min(...us)<0.15||vu<1e-6) return null;
    const a=cov/vu; return {a,b:ms-a*mu};
  },
  solve(){
    const P=this.pairs, cur=this.cal();
    if(cur.ok){
      if(this.err(cur,P[P.length-1])>0.03){ if(++this.bad>=2){ S.inkCal={ok:false}; this.bad=0; save(); this.sync(true); this.renderCard(); } }
      else this.bad=0;
      return;
    }
    const id={ok:true,swap:false,ax:1,bx:0,ay:1,by:0};
    if(P.length>=2&&P.slice(-2).every(p=>this.err(id,p)<0.012)){ this.setCal(id); return; }
    if(P.length<3) return;                 // نقطتين تنطبق على أي معادلة — نحتاج ثلاث حتى نعرف الاتجاه
    const res=[];
    for(const swap of [false,true]){
      const us=P.map(p=>swap?p.ny:p.nx), vs=P.map(p=>swap?p.nx:p.ny);
      const fx=this.fit(us,P.map(p=>p.sx)), fy=this.fit(vs,P.map(p=>p.sy)); if(!fx||!fy) continue;
      const c={ok:true,swap,ax:fx.a,bx:fx.b,ay:fy.a,by:fy.b}; res.push({c,m:Math.max(...P.map(p=>this.err(c,p)))});
    }
    res.sort((a,b)=>a.m-b.m);
    const best=res[0], other=res[1];
    if(best&&best.m<0.012&&(!other||other.m>Math.max(0.03,best.m*3))) this.setCal(best.c);
  },
  setCal(c){
    S.inkCal={...c,ax:+c.ax.toFixed(5),bx:+c.bx.toFixed(5),ay:+c.ay.toFixed(5),by:+c.by.toFixed(5)}; this.bad=0; save();
    this.sync(true); this.renderCard(); toast('الكتابة السريعة جاهزة ✓');
  },
  /* ---------- بطاقة الإعدادات (السبورة) ---------- */
  renderCard(){
    const c=$('#inkCard'); if(!c) return;
    const head=`<h3>${icon('pen')}الكتابة السريعة <span class="badge-exp">تجريبي</span></h3>
      <p class="hint">برنامج صغير يقرأ اللمس من الصبورة مباشرة ويرسم آخر قطعة من الخط تحت إصبعك فوراً — حتى تحس الخط لازق بالإصبع. يشتغل بالسبورة والكتابة فوق الشاشة.</p>`;
    if(!(window.Native&&Native.on)){ c.innerHTML=head+`<div class="cam-note">${icon('info')}تشتغل على جهاز الصف نفسه.</div>`; paintIcons(c); return; }
    const s=this.status, cal=this.cal();
    const run=s&&s.running;
    const stTxt=!run?'البرنامج مو شغال':`شغال${s.devices&&s.devices.length?' — '+s.devices.join('، '):' (ما لگى شاشة لمس)'}`;
    c.innerHTML=head+`
      <div class="row"><label>تشغيل الكتابة السريعة</label><label class="sw"><input type="checkbox" data-fi="on" ${S.fastInk?'checked':''}><span></span></label></div>
      <div class="row"><span class="lbl">الحالة</span><b class="cam-st${run?' ok':''}">${esc(stTxt)}</b></div>
      <div class="row"><label>المعايرة<span class="hint">${cal.ok?'جاهزة — الحبر بمكانه الصحيح':'تلقائية: ارسم ٣–٤ خطوط بالسبورة بأماكن متباعدة (فوك يمين، جوه يسار، وبالنص)'}</span></label>
        <b class="cam-st${cal.ok?' ok':''}">${cal.ok?'✓ جاهزة':'تنتظر خطوط'}</b><button class="btn sm ghost" data-fi="recal">${icon('restart')}إعادة</button></div>
      <div class="row"><label>طول الحبر الطري<span class="hint">إذا تشوف الخط يتأخر ورا الحبر الطري زيده، وإذا تشوف خطين قلّله</span></label>
        <input type="range" min="60" max="220" step="10" value="${S.inkTail||110}" data-fi="tail"><b data-fi="tailv" style="min-width:64px;text-align:center">${nf(S.inkTail||110)} ms</b></div>
      ${!run?`<div class="cam-note">${icon('info')}<span>البرنامج يشتغل وحده بعد إعادة تشغيل الجهاز (بعد التحديث). إذا بقى مو شغال: <code dir="ltr">cat ~/.local/share/alharthia-ink.log</code></span></div>`:''}`;
    paintIcons(c); $$('input[type=range]',c).forEach(setRangeFill);
    $('[data-fi=on]',c).onchange=e=>{ S.fastInk=e.target.checked; save(); this.sync(true); };
    $('[data-fi=recal]',c).onclick=()=>{ S.inkCal={ok:false}; this.pairs=[]; save(); this.sync(true); this.renderCard(); toast('ارسم ٣–٤ خطوط بالسبورة بأماكن متباعدة'); };
    const tr=$('[data-fi=tail]',c); tr.oninput=()=>{ S.inkTail=+tr.value; setRangeFill(tr); $('[data-fi=tailv]',c).textContent=nf(S.inkTail)+' ms'; save(); };
  }
};
