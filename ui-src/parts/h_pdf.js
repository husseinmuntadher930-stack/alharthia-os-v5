/* =====================================================================
   قارئ PDF — سكرول متواصل مثل Acrobat + تكبير وتصغير بإصبعين (٢٥٪ – ١٠٠٠٪)
   - إصبع واحد: سحب مع انزلاق (kinetic)
   - إصبعين: تكبير/تصغير حول نقطة بين الإصبعين، مع سحب بنفس الوقت
   - نقرتين: تكبير ٢٥٠٪ مكان النقر، ونقرتين ثانية ترجع
   - التكبير العالي يرسم بس الجزء الظاهر بدقة كاملة، فيبقى واضح بـ١٠٠٠٪ بدون ما ياكل الذاكرة
   ===================================================================== */
const PDF_ZMIN=.25, PDF_ZMAX=10, PDF_GAP=14, PDF_PAD=18, PDF_BASE_MAXPX=12e6, PDF_KEEP=4;
const pdfDpr=()=>Math.min(devicePixelRatio||1,2);

const Pdf={
  doc:null, n:0, i:0, zoom:1, fit:'page', name:'',
  sizes:[], lay:[], boxes:[], strokes:[], tasks:new Map(), gen:new Map(),
  annot:false, tool:'pen', color:'#dc2626', ci:2,
  pv:null,              // معاينة الإيماءة: {s,tx,ty}
  /* ---------------- تهيئة ---------------- */
  init(){
    this.view=$('#pdfView'); this.stage=$('#pdfStage'); this.pages=$('#pages'); this.inkCv=$('#pdfInkLayer'); this.inkX=this.inkCv.getContext('2d');
    this.hud=$('#pZoomHud');
    $('#pdfFile').onchange=async e=>{const f=e.target.files[0]; if(f) this.open(await f.arrayBuffer(),f.name); e.target.value='';};
    document.addEventListener('click',e=>{ if(e.target.closest('[data-act=pdfDevice]')) $('#pdfFile').click(); });
    const v=this.view;
    v.addEventListener('dragover',e=>{e.preventDefault();$('#pdfEmpty').classList.add('drop');});
    v.addEventListener('dragleave',()=>$('#pdfEmpty').classList.remove('drop'));
    v.addEventListener('drop',async e=>{e.preventDefault();$('#pdfEmpty').classList.remove('drop');const f=[...e.dataTransfer.files].find(f=>/pdf$/i.test(f.name)); if(f) this.open(await f.arrayBuffer(),f.name);});
    $('#pPrev').onclick=()=>this.goto(this.i-1);
    $('#pNext').onclick=()=>this.goto(this.i+1);
    $('#pNum').onchange=e=>{const v=parseInt(String(e.target.value).replace(/[٠-٩]/g,d=>AR_D.indexOf(d)),10); if(v) this.goto(v-1); else this.ui();};
    $('#pZin').onclick=()=>this.zoomAtCenter(this.zoom*1.25);
    $('#pZout').onclick=()=>this.zoomAtCenter(this.zoom/1.25);
    $('#pFit').onclick=()=>{ this.fit=this.fit==='page'?'width':'page'; toast(this.fit==='page'?'عرض الصفحة كاملة':'ملء عرض الشاشة'); this.zoomAtCenter(1,true); };
    $('#pThumbsBtn').onclick=()=>{const t=$('#thumbs'); t.hidden=!t.hidden; $('#pThumbsBtn').classList.toggle('on',!t.hidden);};
    $('#pFull').onclick=()=>{ toggleFullscreen(); };
    $('#pPen').onclick=()=>this.setAnnot(!this.annot);
    $('#pHl').onclick=()=>{this.tool=this.tool==='hl'?'pen':'hl';this.inkUi();};
    $('#pEraser').onclick=()=>{this.tool=this.tool==='eraser'?'pen':'eraser';this.inkUi();};
    $('#pUndo').onclick=()=>this.ink.undo();
    $('#pClear').onclick=()=>this.ink.clear();
    $('#pColors').addEventListener('click',e=>{const c=e.target.closest('[data-ci]'); if(!c) return; this.ci=+c.dataset.ci; this.color=QUICK_LIGHT[this.ci]; if(this.tool==='eraser') this.tool='pen'; this.inkUi();});
    // واجهة متوافقة مع باقي النظام (Ctrl+Z وغيره)
    this.ink={ undo:()=>{ const p=this.strokes[this.inkPage??this.i]; if(p&&p.length){ p.pop(); this.drawInk(); } },
               clear:()=>{ const k=this.inkPage??this.i; if(this.strokes[k]) this.strokes[k]=[]; this.drawInk(); } };
    this.bindGestures();
    this.stage.addEventListener('scroll',()=>{ this.onScroll(); },{passive:true});
    this.stage.addEventListener('wheel',e=>{ if(!this.doc||!e.ctrlKey) return; e.preventDefault();
      const r=this.stage.getBoundingClientRect(); this.zoomAt(this.zoom*Math.exp(-e.deltaY*.0025),e.clientX-r.left,e.clientY-r.top); },{passive:false});
    new ResizeObserver(()=>{ this.sizeInk(); if(this.doc&&current==='pdf') this.relayout(true); }).observe(this.view);
    let hideT=0; $('#pdf').addEventListener('pointermove',e=>{ if(!$('#pdf').classList.contains('full')) return; const bar=$('#pdfBar'); if(innerHeight-e.clientY<120){bar.classList.add('show');clearTimeout(hideT);} else {clearTimeout(hideT);hideT=setTimeout(()=>bar.classList.remove('show'),1200);} });
    this.sizeInk(); this.inkUi(); this.ui();
  },

  /* ---------------- فتح ملف ---------------- */
  async open(buf,name){
    go('pdf'); $('#pdfLoading').hidden=false;
    try{ const L=await pdfjs(); if(this.doc){try{this.doc.destroy();}catch(_){}} this.doc=await L.getDocument({data:new Uint8Array(buf.slice?buf.slice(0):buf)}).promise; }
    catch(err){ $('#pdfLoading').hidden=true; toast(pdfjsP?'تعذر فتح الملف':'تعذر تحميل محرك PDF — هاي المعاينة تحتاج إنترنت (النظام الحقيقي ما يحتاج)',false); return; }
    this.cancelAll();
    this.n=this.doc.numPages; this.i=0; this.zoom=1; this.name=name; this.inkPage=null;
    $('#pdfName').textContent=name.replace(/\.pdf$/i,''); setTitle(name);
    // كل الصفحات بحجم الأولى لحد ما ينعرف حجمها الحقيقي (مثل Acrobat)
    const p1=await this.doc.getPage(1), v1=p1.getViewport({scale:1});
    this.sizes=Array.from({length:this.n},()=>[v1.width,v1.height]); this.known=new Set([0]);
    this.strokes=Array.from({length:this.n},()=>[]);
    this.pages.innerHTML=''; this.boxes=[];
    for(let k=0;k<this.n;k++){ const b=document.createElement('div'); b.className='ppage'; this.pages.appendChild(b); b.dataset.k=k; b.innerHTML='<canvas class="pbase"></canvas>'; b._rs=0; this.boxes.push(b); }
    $('#pdfEmpty').hidden=true;
    this.buildThumbs(); if(innerWidth>900){$('#thumbs').hidden=false;$('#pThumbsBtn').classList.add('on');}
    this.relayout(false); this.stage.scrollTop=0; this.stage.scrollLeft=Math.max(0,(this.pages.offsetWidth-this.stage.clientWidth)/2);
    this.schedule(); $('#pdfLoading').hidden=true; this.ui();
    // نعرف أحجام باقي الصفحات بالخلفية ونصحّح التخطيط
    this.learnSizes();
  },
  async learnSizes(){
    const doc=this.doc;
    for(let k=1;k<this.n;k++){ if(doc!==this.doc) return;
      try{ const p=await doc.getPage(k+1), v=p.getViewport({scale:1}); const [w,h]=this.sizes[k];
        this.known.add(k);
        if(Math.abs(v.width-w)>.5||Math.abs(v.height-h)>.5){ this.sizes[k]=[v.width,v.height]; this.dirtySizes=true; } }catch(_){}
      if(k%20===0&&this.dirtySizes){ this.dirtySizes=false; this.relayout(true); }
      if(k%8===0) await new Promise(r=>setTimeout(r,0));
    }
    if(this.dirtySizes){ this.dirtySizes=false; this.relayout(true); }
  },

  /* ---------------- التخطيط ---------------- */
  fitScale(){ const [w,h]=this.sizes[0]||[612,792]; const sw=Math.max(100,this.stage.clientWidth-2*PDF_PAD), sh=Math.max(100,this.stage.clientHeight-2*PDF_PAD);
    return this.fit==='page'?Math.min(sw/w,sh/h):sw/w; },
  cs(){ return this.fitScale()*this.zoom; },       // بكسل CSS لكل نقطة PDF
  relayout(keepAnchor){
    if(!this.doc) return;
    const anchor=keepAnchor?this.anchorAt(this.stage.clientWidth/2,this.stage.clientHeight*.35):null;
    const cs=this.cs(); let y=PDF_PAD, maxW=0;
    this.lay=this.sizes.map(([w,h])=>{ const r={w:w*cs,h:h*cs,y}; y+=r.h+PDF_GAP; maxW=Math.max(maxW,r.w); return r; });
    const W=Math.max(this.stage.clientWidth,maxW+2*PDF_PAD), H=y-PDF_GAP+PDF_PAD;
    this.pages.style.width=W+'px'; this.pages.style.height=H+'px';
    this.lay.forEach((r,k)=>{ r.x=(W-r.w)/2; const b=this.boxes[k].style; b.left=r.x+'px'; b.top=r.y+'px'; b.width=r.w+'px'; b.height=r.h+'px'; });
    if(anchor) this.restoreAnchor(anchor,this.stage.clientWidth/2,this.stage.clientHeight*.35);
    this.dropDetails(); this.schedule(); this.drawInk(); this.ui();
  },
  // نقطة الشاشة (نسبةً للمسرح) ← موقع بالمستند: صفحة + نسبة داخلها
  anchorAt(sx,sy){
    const cx=this.stage.scrollLeft+sx, cy=this.stage.scrollTop+sy;
    let k=this.pageAtY(cy); const r=this.lay[k]; if(!r) return null;
    return {k,u:(cx-r.x)/r.w,v:(cy-r.y)/r.h};
  },
  restoreAnchor(a,sx,sy){
    if(!a) return; const r=this.lay[a.k]; if(!r) return;
    this.stage.scrollLeft=r.x+a.u*r.w-sx; this.stage.scrollTop=r.y+a.v*r.h-sy;
  },
  pageAtY(cy){ // بحث ثنائي
    const L=this.lay; let lo=0, hi=L.length-1;
    while(lo<hi){ const m=(lo+hi+1)>>1; if(L[m].y<=cy) lo=m; else hi=m-1; }
    return lo;
  },
  visibleRange(margin=0){
    const t=this.stage.scrollTop-margin, b=this.stage.scrollTop+this.stage.clientHeight+margin;
    let a=this.pageAtY(t), z=this.pageAtY(b);
    if(this.lay[a]&&this.lay[a].y+this.lay[a].h<t&&a<this.n-1) a++;
    return [a,z];
  },

  /* ---------------- التكبير ---------------- */
  zoomAt(z,sx,sy,force){
    if(!this.doc) return; z=clamp(z,PDF_ZMIN,PDF_ZMAX); if(!force&&Math.abs(z-this.zoom)<1e-4) return;
    const a=this.anchorAt(sx,sy); this.zoom=z; this.relayoutNoAnchor(); this.restoreAnchor(a,sx,sy);
    this.dropDetails(); this.schedule(); this.drawInk(); this.ui(); this.showHud();
  },
  zoomAtCenter(z,force){ this.zoomAt(z,this.stage.clientWidth/2,this.stage.clientHeight/2,force); },
  relayoutNoAnchor(){ const k=this.zoom; this.relayout(false); },
  setZoom(z){ this.zoomAtCenter(z); },
  showHud(){ this.hud.textContent=nf(Math.round(this.zoom*100))+'٪'; this.hud.hidden=false; clearTimeout(this.hudT); this.hudT=setTimeout(()=>this.hud.hidden=true,900); },

  /* ---------------- الإيماءات ---------------- */
  bindGestures(){
    const st=this.stage, P=new Map(); let mode='none', g=null, last=[], fling=0, tap=null, stroke=null;
    const rect=()=>st.getBoundingClientRect();
    const stopFling=()=>{ cancelAnimationFrame(fling); fling=0; };
    const pts=()=>[...P.values()];
    const startPinch=()=>{
      const [a,b]=pts(), r=rect();
      const mx=(a.x+b.x)/2-r.left, my=(a.y+b.y)/2-r.top;
      g={d0:Math.max(20,Math.hypot(a.x-b.x,a.y-b.y)), mx0:mx, my0:my, z0:this.zoom, sl:st.scrollLeft, st:st.scrollTop, anchor:this.anchorAt(mx,my), s:1, mx, my};
      mode='pinch';
    };
    const previewPinch=()=>{
      const [a,b]=pts(), r=rect(); const d=Math.hypot(a.x-b.x,a.y-b.y);
      let s=d/g.d0; s=clamp(g.z0*s,PDF_ZMIN,PDF_ZMAX)/g.z0;
      const mx=(a.x+b.x)/2-r.left, my=(a.y+b.y)/2-r.top;
      // المحتوى تحت نقطة البداية يتبع نقطة المنتصف الحالية
      const ax=g.sl+g.mx0, ay=g.st+g.my0;               // إحداثيات المحتوى للمرساة
      const tx=(mx+g.sl)-s*ax, ty=(my+g.st)-s*ay;
      this.pv={s,tx,ty}; this.pages.style.transform=`translate(${tx}px,${ty}px) scale(${s})`;
      g.s=s; g.mx=mx; g.my=my;
      this.hud.textContent=nf(Math.round(g.z0*s*100))+'٪'; this.hud.hidden=false; clearTimeout(this.hudT);
      this.drawInk();
    };
    const endPinch=()=>{
      const z=clamp(g.z0*g.s,PDF_ZMIN,PDF_ZMAX);
      this.pages.style.transform=''; this.pv=null;
      this.zoom=z; this.relayout(false); this.restoreAnchor(g.anchor,g.mx,g.my);
      this.dropDetails(); this.schedule(); this.drawInk(); this.ui(); this.showHud(); g=null;
    };
    const flingStart=()=>{
      if(last.length<2) return; const a=last[0], b=last[last.length-1], dt=Math.max(8,b.t-a.t);
      let vx=(b.x-a.x)/dt, vy=(b.y-a.y)/dt; if(Math.hypot(vx,vy)<.25) return;
      let t0=performance.now();
      const step=now=>{ const dt=now-t0; t0=now; st.scrollLeft-=vx*dt; st.scrollTop-=vy*dt; const f=Math.pow(.955,dt/16); vx*=f; vy*=f;
        if(Math.hypot(vx,vy)>.03) fling=requestAnimationFrame(step); else fling=0; };
      fling=requestAnimationFrame(step);
    };
    const pageHit=(cx,cy)=>{ const r=rect(), x=st.scrollLeft+cx-r.left, y=st.scrollTop+cy-r.top, k=this.pageAtY(y), L=this.lay[k];
      if(!L||x<L.x||x>L.x+L.w||y<L.y||y>L.y+L.h) return null; return {k,L,x,y}; };

    st.addEventListener('pointerdown',e=>{
      if(!this.doc) return;
      if(e.pointerType==='mouse'&&e.button!==0) return;          // الماوس: سحب بالزر الأيسر مثل يد Acrobat، والعجلة سكرول عادي
      if(e.target!==st&&!st.contains(e.target)) return;
      e.preventDefault(); stopFling();
      try{ st.setPointerCapture(e.pointerId); }catch(_){}
      P.set(e.pointerId,{x:e.clientX,y:e.clientY,type:e.pointerType});
      if(P.size===1){
        if(this.annot){
          if(e.pointerType==='touch'&&S.palm&&(e.width>55||e.height>55)){ mode='none'; return; }
          const h=pageHit(e.clientX,e.clientY); if(!h){ mode='pan'; last=[{x:e.clientX,y:e.clientY,t:e.timeStamp}]; return; }
          const k=h.k, w=h.L.w, px=this.tool==='hl'?22:this.tool==='eraser'?34:4;
          stroke={k,s:{id:uid(),t:'ink',k:this.tool,c:this.color,w:px/w,p:[[(h.x-h.L.x)/w,(h.y-h.L.y)/w,1]]},sm:[(h.x-h.L.x)/w,(h.y-h.L.y)/w]};
          this.inkPage=k; mode='draw'; this.drawInk(); return;
        }
        mode='pan'; last=[{x:e.clientX,y:e.clientY,t:e.timeStamp}];
        tap={x:e.clientX,y:e.clientY,t:e.timeStamp,moved:false};
      } else if(P.size===2){
        if(mode==='draw'){ stroke=null; this.drawInk(); }     // الإصبع الثاني يلغي الخط ويصير تكبير
        tap=null; startPinch();
      }
    });
    st.addEventListener('pointermove',e=>{
      const p=P.get(e.pointerId); if(!p) return;
      const evs=(e.getCoalescedEvents&&e.getCoalescedEvents().length)?e.getCoalescedEvents():[e];
      if(mode==='draw'&&stroke){
        const L=this.lay[stroke.k], r=rect();
        for(const ev of evs){ const x=(st.scrollLeft+ev.clientX-r.left-L.x)/L.w, y=(st.scrollTop+ev.clientY-r.top-L.y)/L.w, k=S.smooth;
          stroke.sm[0]+=(x-stroke.sm[0])*(1-k); stroke.sm[1]+=(y-stroke.sm[1])*(1-k);
          const l=stroke.s.p[stroke.s.p.length-1]; if(Math.hypot(stroke.sm[0]-l[0],stroke.sm[1]-l[1])*L.w>.7) stroke.s.p.push([stroke.sm[0],stroke.sm[1],1]); }
        p.x=e.clientX; p.y=e.clientY; this.schedInk(stroke); return;
      }
      const dx=e.clientX-p.x, dy=e.clientY-p.y; p.x=e.clientX; p.y=e.clientY;
      if(mode==='pan'&&P.size===1){
        st.scrollLeft-=dx; st.scrollTop-=dy;
        last.push({x:e.clientX,y:e.clientY,t:e.timeStamp}); while(last.length>1&&e.timeStamp-last[0].t>90) last.shift();
        if(tap&&Math.hypot(e.clientX-tap.x,e.clientY-tap.y)>12) tap.moved=true;
      } else if(mode==='pinch'&&P.size>=2) previewPinch();
    });
    const up=e=>{
      if(!P.has(e.pointerId)) return; P.delete(e.pointerId);
      if(mode==='draw'){ if(stroke&&P.size===0){ this.strokes[stroke.k].push(stroke.s); stroke=null; this.drawInk(); } if(P.size===0) mode='none'; return; }
      if(mode==='pinch'&&P.size<2){ endPinch();
        if(P.size===1){ const q=pts()[0]; mode='pan'; last=[{x:q.x,y:q.y,t:e.timeStamp}]; } else mode='none'; return; }
      if(mode==='pan'&&P.size===0){
        mode='none';
        if(e.type!=='pointercancel') flingStart();
        // نقرتين = تكبير/رجوع مكان النقر
        if(tap&&!tap.moved&&e.timeStamp-tap.t<260){
          const r=rect(), now=e.timeStamp;
          if(this.lastTap&&now-this.lastTap.t<330&&Math.hypot(tap.x-this.lastTap.x,tap.y-this.lastTap.y)<40){
            stopFling(); this.zoomAt(this.zoom>1.4?1:2.5,tap.x-r.left,tap.y-r.top); this.lastTap=null;
          } else this.lastTap={x:tap.x,y:tap.y,t:now};
        }
        tap=null;
      }
    };
    st.addEventListener('pointerup',up); st.addEventListener('pointercancel',up);
    this._stroke=()=>stroke;
  },

  /* ---------------- الرسم ---------------- */
  onScroll(){
    if(this.scrollRaf) return;
    this.scrollRaf=requestAnimationFrame(()=>{ this.scrollRaf=0; this.drawInk(); this.updateCurrent(); this.schedule(); });
    this.idleDetails();
  },
  updateCurrent(){
    if(!this.doc) return; const k=this.pageAtY(this.stage.scrollTop+this.stage.clientHeight*.35);
    if(k!==this.i){ this.i=k; this.ui(); }
  },
  schedule(){ if(this.schedRaf) return; this.schedRaf=requestAnimationFrame(()=>{ this.schedRaf=0; this.pump(); }); },
  pump(){
    if(!this.doc) return;
    const [a,z]=this.visibleRange(this.stage.clientHeight*.6), cs=this.cs(), d=pdfDpr();
    // الأقرب لوسط الشاشة أولاً
    const mid=this.pageAtY(this.stage.scrollTop+this.stage.clientHeight/2);
    const want=[]; for(let k=a;k<=z;k++) want.push(k); want.sort((x,y)=>Math.abs(x-mid)-Math.abs(y-mid));
    for(const k of want){ const target=this.baseScale(k,cs,d), b=this.boxes[k];
      if(Math.abs((b._rs||0)-target)/target>.02&&!this.tasks.has(k)) this.renderBase(k,target); }
    // نحرر الصفحات البعيدة حتى ما تمتلي الذاكرة
    this.boxes.forEach((b,k)=>{ if(b._rs&&(k<a-PDF_KEEP||k>z+PDF_KEEP)){ const c=b.querySelector('.pbase'); c.width=c.height=0; b._rs=0; const dc=b.querySelector('.pdetail'); dc&&dc.remove(); } });
  },
  baseScale(k,cs,d){ const [w,h]=this.sizes[k]; return Math.min(cs*d,Math.sqrt(PDF_BASE_MAXPX/(w*h))); },
  async renderBase(k,rs){
    const g=(this.gen.get(k)||0)+1; this.gen.set(k,g); const doc=this.doc;
    try{
      const page=await doc.getPage(k+1); if(doc!==this.doc||this.gen.get(k)!==g) return;
      const vp=page.getViewport({scale:rs});
      const cv=document.createElement('canvas'); cv.width=Math.max(1,Math.floor(vp.width)); cv.height=Math.max(1,Math.floor(vp.height));
      const task=page.render({canvasContext:cv.getContext('2d',{alpha:false}),canvas:cv,viewport:vp});
      this.tasks.set(k,task); await task.promise;
      if(doc!==this.doc||this.gen.get(k)!==g) return;
      cv.className='pbase'; const b=this.boxes[k]; b.querySelector('.pbase').replaceWith(cv); b._rs=rs;
      b._capped=rs<this.cs()*pdfDpr()*.97;
      if(b._capped) this.idleDetails();
    }catch(_){}
    finally{ if(this.gen.get(k)===g) this.tasks.delete(k); this.schedule(); }
  },
  // الجزء الظاهر بدقة كاملة — هذا الي يخلي ١٠٠٠٪ واضحة
  async renderDetails(){
    if(!this.doc||this.pv) return;
    const [a,z]=this.visibleRange(0), cs=this.cs(), d=pdfDpr(), st=this.stage, doc=this.doc, myZ=this.zoom;
    for(let k=a;k<=z;k++){
      const b=this.boxes[k], L=this.lay[k]; if(!b||!L) continue;
      if(!(this.baseScale(k,cs,d)<cs*d*.97)){ const dc=b.querySelector('.pdetail'); dc&&dc.remove(); continue; }
      const m=60, vx0=st.scrollLeft-m, vy0=st.scrollTop-m, vx1=st.scrollLeft+st.clientWidth+m, vy1=st.scrollTop+st.clientHeight+m;
      const rx0=Math.max(L.x,vx0)-L.x, ry0=Math.max(L.y,vy0)-L.y, rx1=Math.min(L.x+L.w,vx1)-L.x, ry1=Math.min(L.y+L.h,vy1)-L.y;
      if(rx1<=rx0||ry1<=ry0) continue;
      try{
        const page=await doc.getPage(k+1); if(doc!==this.doc||myZ!==this.zoom) return;
        const vp=page.getViewport({scale:cs*d});
        const cv=document.createElement('canvas'); cv.width=Math.ceil((rx1-rx0)*d); cv.height=Math.ceil((ry1-ry0)*d);
        const task=page.render({canvasContext:cv.getContext('2d',{alpha:false}),canvas:cv,viewport:vp,transform:[1,0,0,1,-rx0*d,-ry0*d]});
        await task.promise; if(doc!==this.doc||myZ!==this.zoom) return;
        cv.className='pdetail'; Object.assign(cv.style,{left:rx0+'px',top:ry0+'px',width:(rx1-rx0)+'px',height:(ry1-ry0)+'px'});
        const old=b.querySelector('.pdetail'); old?old.replaceWith(cv):b.appendChild(cv);
      }catch(_){}
    }
  },
  dropDetails(){ $$('#pages .pdetail').forEach(c=>c.remove()); this.idleDetails(); },
  idleDetails(){ clearTimeout(this.idleT); this.idleT=setTimeout(()=>this.renderDetails(),140); },
  cancelAll(){ for(const t of this.tasks.values()){ try{t.cancel();}catch(_){} } this.tasks.clear(); this.gen.clear(); },

  /* ---------------- طبقة الكتابة (وحدة فوق الشاشة كلها — حادّة بأي تكبير) ---------------- */
  sizeInk(){ const d=pdfDpr(), w=this.view.clientWidth, h=this.view.clientHeight; this.inkCv.width=Math.round(w*d); this.inkCv.height=Math.round(h*d); this.drawInk(); },
  schedInk(){ if(this.inkRaf) return; this.inkRaf=requestAnimationFrame(()=>{ this.inkRaf=0; this.drawInk(); }); },
  drawInk(){
    const x=this.inkX, d=pdfDpr(); if(!x) return;
    x.setTransform(1,0,0,1,0,0); x.clearRect(0,0,this.inkCv.width,this.inkCv.height);
    if(!this.doc) return;
    const st=this.stage, s=this.pv?this.pv.s:1, tx=this.pv?this.pv.tx:0, ty=this.pv?this.pv.ty:0;
    const [a,z]=this.visibleRange(this.pv?this.stage.clientHeight*3:0), live=this._stroke&&this._stroke();
    for(let k=a;k<=z;k++){
      const L=this.lay[k]; if(!L) continue; const list=this.strokes[k]||[]; if(!list.length&&!(live&&live.k===k)) continue;
      // موقع الصفحة على الشاشة (مع معاينة التكبير إن وجدت)
      const left=(L.x*s+tx)-st.scrollLeft, top=(L.y*s+ty)-st.scrollTop, w=L.w*s, h=L.h*s;
      x.save(); x.setTransform(d,0,0,d,0,0); x.beginPath(); x.rect(left,top,w,h); x.clip(); x.translate(left,top);
      for(const sk of list) drawInk(x,sk,w);
      if(live&&live.k===k) drawInk(x,live.s,w);
      x.restore();
    }
  },

  /* ---------------- واجهة ---------------- */
  goto(j){ if(!this.doc) return; j=clamp(j,0,this.n-1); const L=this.lay[j]; if(!L) return;
    this.stage.scrollTo({top:L.y-PDF_PAD/2,behavior:'smooth'}); this.i=j; this.ui(); },
  render(){ if(this.doc){ this.sizeInk(); this.relayout(true); } },
  setAnnot(on){
    if(on&&!this.doc){toast('افتح ملف أولاً',false);return;}
    this.annot=on; this.view.classList.toggle('annot',on); $('#pPen').classList.toggle('on',on); $('#pInkTools').hidden=!on;
    if(on){this.tool='pen';toast('اكتب بإصبع واحد — وكبّر بإصبعين');} this.inkUi();
  },
  inkUi(){
    $('#pColors').innerHTML=QUICK_LIGHT.slice(0,5).map((c,i)=>`<button class="swc${i===this.ci&&this.tool!=='eraser'?' on':''}" data-ci="${i}" style="--c:${c}" aria-label="لون"></button>`).join('');
    $('#pHl').classList.toggle('on',this.tool==='hl'); $('#pEraser').classList.toggle('on',this.tool==='eraser');
  },
  ui(){
    $('#pNum').value=nf(this.doc?this.i+1:0); $('#pTot').textContent='/ '+nf(this.n);
    $('#pPrev').disabled=!this.doc||this.i===0; $('#pNext').disabled=!this.doc||this.i>=this.n-1;
    for(const id of ['pZin','pZout','pFit']) $('#'+id).disabled=!this.doc;
    $('#pZin').disabled=!this.doc||this.zoom>=PDF_ZMAX-1e-3; $('#pZout').disabled=!this.doc||this.zoom<=PDF_ZMIN+1e-3;
    const zl=$('#pZlbl'); if(zl) zl.textContent=this.doc?nf(Math.round(this.zoom*100))+'٪':'';
    $$('#thumbs .thumb').forEach((t,k)=>t.classList.toggle('on',k===this.i));
    const on=$('#thumbs .thumb.on'); on&&on.scrollIntoView({block:'nearest'});
  },
  buildThumbs(){
    const box=$('#thumbs'); box.innerHTML=''; this.obs&&this.obs.disconnect();
    const q=[]; let run=false; const doc=this.doc;
    const pump=async()=>{ if(run) return; run=true; while(q.length){ const [k,cv]=q.shift(); try{ const p=await doc.getPage(k+1); const v0=p.getViewport({scale:1}); const vp=p.getViewport({scale:280/v0.width});
      cv.width=vp.width; cv.height=vp.height; await p.render({canvasContext:cv.getContext('2d'),canvas:cv,viewport:vp}).promise; }catch(_){} } run=false; };
    this.obs=new IntersectionObserver(es=>{ for(const e of es) if(e.isIntersecting&&!e.target.dataset.done){ e.target.dataset.done=1; q.push([+e.target.dataset.k,e.target.querySelector('canvas')]); pump(); } },{root:box,rootMargin:'300px'});
    for(let k=0;k<this.n;k++){ const b=document.createElement('button'); b.className='thumb'; b.dataset.k=k; b.innerHTML=`<canvas width="140" height="100"></canvas><span>${nf(k+1)}</span>`; b.onclick=()=>this.goto(k); box.appendChild(b); this.obs.observe(b); }
  }
};
onShow.pdf=()=>{ if(Pdf.doc){ setTitle(Pdf.name); requestAnimationFrame(()=>Pdf.render()); } };
