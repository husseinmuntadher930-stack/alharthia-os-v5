/* =====================================================================
   3.0 — أدوات السبورة الإضافية (زر «أدوات الصف» بشريط السبورة)
   ستارة الإخفاء والكشف، المكبّر، الملاحظة اللاصقة، مسطرة الأرقام والكسور،
   الرموز الرياضية، قص/نسخ/لصق، لصق صورة من الكاميرا، قسمة السبورة لطالبين.
   ===================================================================== */
ICONS.tools='<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4z"/>';
ICONS.curtain='<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 3h18v10H3z" fill="currentColor" fill-opacity=".25"/><path d="M10 16h4"/>';
ICONS.magnify='<circle cx="10.5" cy="10.5" r="6.5"/><path d="m20 20-4.8-4.8M8 10.5h5M10.5 8v5"/>';
ICONS.sticky='<path d="M4 4h16v10l-6 6H4z"/><path d="M14 20v-6h6"/>';
ICONS.numline='<path d="M2 12h20M5 9v6M9 10v4M13 10v4M17 10v4M20 9v6"/>';
ICONS.fraction='<circle cx="12" cy="12" r="9"/><path d="M12 3v18M12 12l7.8 4.5"/><path d="M12 12 12 3a9 9 0 0 1 7.8 13.5z" fill="currentColor" fill-opacity=".3"/>';
ICONS.sigma='<path d="M18 5H6l6 7-6 7h12"/>';
ICONS.scissors='<circle cx="6" cy="7" r="3"/><circle cx="6" cy="17" r="3"/><path d="M8.5 8.5 20 19M8.5 15.5 20 5"/>';
ICONS.clip='<rect x="8" y="3" width="8" height="4" rx="1"/><path d="M8 5H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/>';
ICONS.split2='<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 4v16" stroke-dasharray="2 2"/><circle cx="7.5" cy="9" r="1.5"/><circle cx="16.5" cy="9" r="1.5"/>';
const MATH_SYM=['√','∛','π','∞','±','×','÷','=','≠','≈','≤','≥','<','>','∑','∫','∆','θ','α','β','γ','λ','μ','°','½','⅓','¼','¾','x²','x³','xⁿ','∠','⊥','∥','△','∈','∉','⊂','∪','∩','∴','⇒','⇔','→','%','‰'];

/* الملاحظة اللاصقة = نص بخلفية ملوّنة (نفس التحرير والتحريك والتراجع) */
{
  const _dt=drawText;
  drawText=function(x,it,W){
    if(it.bgc){
      const cx=(it.bx+it.bw/2)*W, cy=(it.by+it.bh/2)*W, w=it.bw*W, h=it.bh*W, pad=it.fs*W*.45;
      x.save(); x.translate(cx,cy); if(it.rot) x.rotate(it.rot);
      x.shadowColor='rgba(0,0,0,.22)'; x.shadowBlur=14; x.shadowOffsetY=5; x.fillStyle=it.bgc;
      x.beginPath(); x.roundRect(-w/2-pad,-h/2-pad,w+pad*2,h+pad*2,Math.min(16,pad)); x.fill();
      x.shadowColor='transparent'; x.fillStyle='rgba(0,0,0,.06)'; x.fillRect(-w/2-pad,-h/2-pad,w+pad*2,Math.max(6,pad*.5));
      x.restore();
    }
    _dt(x,it,W);
  };
}

const BoardX={
  clip:null,
  init(){
    window.BoardX=this;
    // زر «أدوات الصف» بشريط السبورة
    const before=$('#boardDock [data-act=undo]');
    if(before&&!$('#dExtra')){
      const b=document.createElement('button'); b.className='dbtn'; b.id='dExtra'; b.dataset.pop='extra';
      b.innerHTML=`${icon('tools')}<span class="lb">أدوات الصف</span><i class="car"></i>`;
      const sep=document.createElement('span'); sep.className='dsep';
      before.parentNode.insertBefore(b,before.previousElementSibling); before.parentNode.insertBefore(sep,b.nextSibling);
    }
    const ph=Board.popHTML;
    Board.popHTML=function(n){ return n==='extra'?BoardX.popHTML():ph.call(this,n); };
    $('#bPop').addEventListener('click',e=>{ const b=e.target.closest('[data-xt]'); if(!b) return; Board.closePop(); this.act(b.dataset.xt,b.dataset.v); });
    // قص / نسخ بقائمة التحديد
    const sm=$('#selMenu');
    if(sm&&!sm.querySelector('[data-selx]')){
      sm.insertAdjacentHTML('afterbegin',`<button data-selx="cut">${icon('scissors')}قص</button><button data-selx="copy">${icon('copy')}نسخ</button>`);
      sm.addEventListener('click',e=>{ const b=e.target.closest('[data-selx]'); if(!b) return; e.stopPropagation(); b.dataset.selx==='cut'?this.cut():this.copy(); });
    }
    addEventListener('keydown',e=>{
      if(!isShown('board')||!(e.ctrlKey||e.metaKey)||e.target.closest('input,textarea,[contenteditable]')) return;
      const k=e.key.toLowerCase();
      if(k==='c'&&Board.sel.length){ e.preventDefault(); this.copy(); }
      if(k==='x'&&Board.sel.length){ e.preventDefault(); this.cut(); }
      if(k==='v'&&this.clip){ e.preventDefault(); this.paste(); }
    });
  },
  on(f){ return !window.Features||Features.on(f); },
  popHTML(){
    const T=[['sticky','sticky','ملاحظة لاصقة'],['curtain','curtain','ستارة (إخفاء وكشف)'],['magnify','magnify','مكبّر'],['numline','numline','مسطرة الأرقام'],
      ['fraction','fraction','دوائر الكسور'],['symbols','sigma','رموز رياضية'],['camera','camera','صورة من الكاميرا'],['split','split2','سبورة لطالبين'],
      ['paste','clip','لصق'+(this.clip?` (${nf(this.clip.length)})`:'')]];
    const feat={sticky:'sticky',curtain:'curtain',magnify:'magnify',numline:'numline',fraction:'numline',symbols:'symbols',camera:'campaste',split:'split2',paste:'cutpaste'};
    return `<h5>${icon('tools')}أدوات الصف</h5><div class="opt-grid" style="width:min(560px,92vw)">${T.filter(([k])=>this.on(feat[k])).map(([k,i,t])=>`<button class="opt" data-xt="${k}" ${k==='paste'&&!this.clip?'disabled':''}>${icon(i)}${t}</button>`).join('')}</div>`;
  },
  act(a,v){
    if(window.Usage) Usage.hit('board:'+a);
    if(a==='sticky') this.sticky();
    if(a==='curtain') Curtain.toggle();
    if(a==='magnify') Magnifier.toggle();
    if(a==='numline') this.numLineModal();
    if(a==='fraction') this.fractionModal();
    if(a==='symbols') this.symbolsModal();
    if(a==='camera') this.cameraModal();
    if(a==='split') DuoBoard.toggle();
    if(a==='paste') this.paste();
  },
  center(){ const B=Board; return [.5, B.H/B.W/2]; },
  addItems(items,select=true){ Board.commitAdd(items); if(select){ Board.setTool('select'); Board.setSel(items.map(i=>i.id)); } Board.changed(); },
  /* ---------- ملاحظة لاصقة ---------- */
  sticky(){
    const B=Board, [cx,cy]=this.center(), fs=34/REF, bw=300/REF, bh=fs*1.35*2;
    const cols=['#fde68a','#bbf7d0','#bfdbfe','#fbcfe8','#fed7aa'];
    const it={id:uid(),t:'text',text:'ملاحظة',c:'#1f2937',fs,dir:'rtl',bx:cx-bw/2+(Math.random()-.5)*.08,by:cy-bh/2+(Math.random()-.5)*.05,bw,bh,rot:(Math.random()-.5)*.06,bgc:cols[(this.nc=(this.nc|0)+1)%cols.length]};
    this.addItems([it]); toast('ملاحظة لاصقة — حتى تكتب بيها: أداة «نص» والمس الملاحظة. وتسحبها بأداة «تحديد»');
  },
  /* ---------- قص / نسخ / لصق ---------- */
  copy(){ const items=Board.selItems(); if(!items.length) return; this.clip=items.map(cloneItem); toast(`تم نسخ ${nf(items.length)} عنصر — تكدر تلصقها بأي صفحة`); },
  cut(){
    const B=Board, items=B.selItems(); if(!items.length) return; this.clip=items.map(cloneItem);
    const entries=[]; B.page.items.forEach((it,idx)=>{ if(B.sel.includes(it.id)) entries.push({it,idx}); });
    B.page.items=B.page.items.filter(i=>!B.sel.includes(i.id)); B.record({type:'remove',entries}); B.setSel([]); B.redraw();
    toast(`تم قص ${nf(items.length)} عنصر — روح لأي صفحة واضغط «لصق»`);
  },
  paste(){
    if(!this.clip||!this.clip.length) return; if(!isShown('board')) go('board');
    const off=(this.pasteN=(this.pasteN|0)+1)%5*.012;
    const items=this.clip.map(it=>{ const c=cloneItem(it); c.id=uid(); if(off) xformItem(c,(x,y)=>[x+off,y+off]); return c; });
    this.addItems(items); toast('تم اللصق');
  },
  /* ---------- مسطرة الأرقام ---------- */
  async numLineModal(){
    const v=await modal({title:'مسطرة الأرقام',iconName:'numline',body:`<div class="opt-grid" style="grid-template-columns:repeat(2,1fr)">
        <button class="opt" data-nl="0,10,1">من ٠ إلى ١٠</button><button class="opt" data-nl="-10,10,1">من −١٠ إلى ١٠</button>
        <button class="opt" data-nl="0,20,1">من ٠ إلى ٢٠</button><button class="opt" data-nl="0,100,10">من ٠ إلى ١٠٠ (بالعشرات)</button>
        <button class="opt" data-nl="0,1,0.25">من ٠ إلى ١ (أرباع)</button><button class="opt" data-nl="0,2,0.5">من ٠ إلى ٢ (أنصاف)</button></div>`,
      actions:[{label:'إلغاء',val:null,cls:'ghost'}],onOpen:(ov,done)=>ov.querySelector('.mb').addEventListener('click',e=>{ const b=e.target.closest('[data-nl]'); if(b) done(b.dataset.nl); })});
    if(!v) return; const [a,b,st]=v.split(',').map(Number); this.numLine(a,b,st);
  },
  label(v,st){
    if(st<1&&Math.abs(v-Math.round(v))>1e-9){ const den=Math.round(1/st), num=Math.round(v*den); const g=(x,y)=>y?g(y,x%y):x, k=g(Math.abs(num),den); return nf(num/k)+'/'+nf(den/k); }
    return (v<0?'−':'')+nf(Math.abs(Math.round(v*100)/100));
  },
  numLine(a,b,st){
    const B=Board, [cx,cy]=this.center(), L=.8, x0=cx-L/2, n=Math.round((b-a)/st), c=B.color==='#ffffff'||bgIsDark(B.page.bg)?'#ffffff':'#111827', w=4/REF;
    const items=[{id:uid(),t:'shape',k:'darrow',c,w,a:[x0-.02,cy],b:[x0+L+.02,cy]}];
    for(let i=0;i<=n;i++){ const x=x0+L*i/n, v=a+i*st, major=Math.abs(v-Math.round(v))<1e-9||st>=1;
      items.push({id:uid(),t:'shape',k:'line',c,w:w*(major?1:.7),a:[x,cy-(major?.014:.009)],b:[x,cy+(major?.014:.009)]});
      const fs=(n>20?18:24)/REF, txt=this.label(v,st);
      items.push({id:uid(),t:'text',text:txt,c,fs,dir:'ltr',bx:x-.03,by:cy+.02,bw:.06,bh:fs*1.35,rot:0}); }
    this.addItems(items); toast('مسطرة الأرقام — تكدر تحركها أو تكبّرها');
  },
  /* ---------- دوائر الكسور ---------- */
  async fractionModal(){
    let num=1, den=4;
    const draw=ov=>{ $('#frV',ov).textContent=nf(num)+' / '+nf(den); const cv=$('#frCv',ov), x=cv.getContext('2d'); x.clearRect(0,0,160,160); this.drawFrac(x,80,80,70,num,den); };
    const ok=await modal({title:'دوائر الكسور',iconName:'fraction',body:`<div style="display:flex;align-items:center;gap:20px;justify-content:center">
        <canvas id="frCv" width="160" height="160"></canvas><div style="text-align:center"><div id="frV" style="font-size:34px;font-weight:800;margin-bottom:10px"></div>
        <div class="btns" style="justify-content:center"><span class="hint">البسط</span><button class="btn sm" data-f="n-">−</button><button class="btn sm" data-f="n+">+</button></div>
        <div class="btns" style="justify-content:center;margin-top:6px"><span class="hint">المقام</span><button class="btn sm" data-f="d-">−</button><button class="btn sm" data-f="d+">+</button></div></div></div>`,
      actions:[{label:'إلغاء',val:false,cls:'ghost'},{label:'إضافة للسبورة',val:true,cls:'primary'}],
      onOpen:ov=>{ draw(ov); ov.querySelector('.mb').addEventListener('click',e=>{ const b=e.target.closest('[data-f]'); if(!b) return; const f=b.dataset.f;
        if(f==='n+') num=Math.min(den,num+1); if(f==='n-') num=Math.max(0,num-1); if(f==='d+') den=Math.min(12,den+1); if(f==='d-'){ den=Math.max(2,den-1); num=Math.min(num,den); } draw(ov); }); }});
    if(ok) this.fraction(num,den);
  },
  drawFrac(x,cx,cy,r,num,den){
    x.lineWidth=2; for(let i=0;i<den;i++){ const a0=-Math.PI/2+i*2*Math.PI/den, a1=a0+2*Math.PI/den;
      x.beginPath(); x.moveTo(cx,cy); x.arc(cx,cy,r,a0,a1); x.closePath(); x.fillStyle=i<num?'#f0703e':'#ffffff'; x.fill(); x.strokeStyle='#1f2937'; x.stroke(); }
  },
  fraction(num,den){
    const [cx,cy]=this.center(), r=.11, c='#1f2937', w=3/REF, items=[];
    for(let i=0;i<den;i++){ const a0=-Math.PI/2+i*2*Math.PI/den, a1=a0+2*Math.PI/den, pts=[[cx,cy]];
      for(let k=0;k<=24;k++){ const a=a0+(a1-a0)*k/24; pts.push([cx+Math.cos(a)*r,cy+Math.sin(a)*r]); }
      items.push({id:uid(),t:'shape',k:'poly',c:i<num?'#f0703e':c,w,pts,closed:true,fill:i<num}); }
    const fs=40/REF; items.push({id:uid(),t:'text',text:nf(num)+'/'+nf(den),c,fs,dir:'ltr',bx:cx-.05,by:cy+r+.012,bw:.1,bh:fs*1.35,rot:0});
    this.addItems(items);
  },
  /* ---------- رموز رياضية ---------- */
  async symbolsModal(){
    const v=await modal({title:'رموز رياضية',iconName:'sigma',body:`<div class="sym-grid">${MATH_SYM.map(s=>`<button class="opt" data-sym="${esc(s)}">${esc(s)}</button>`).join('')}</div><p class="hint">الرمز ينضاف بنص السبورة — اسحبه لمكانه أو كبّره.</p>`,
      actions:[{label:'إغلاق',val:null,cls:'ghost'}],wide:true,onOpen:(ov,done)=>ov.querySelector('.mb').addEventListener('click',e=>{ const b=e.target.closest('[data-sym]'); if(b) done(b.dataset.sym); })});
    if(!v) return; const [cx,cy]=this.center(), fs=72/REF, B=Board;
    const c=bgIsDark(B.page.bg)&&B.color==='#111827'?'#ffffff':B.color;
    this.addItems([{id:uid(),t:'text',text:v,c,fs,dir:'ltr',bx:cx-.04,by:cy-fs*.7,bw:Math.max(.05,fs*.7*v.length),bh:fs*1.35,rot:0}]);
  },
  /* ---------- صورة من الكاميرا ---------- */
  async cameraModal(){
    if(!(window.Native&&Native.on)){ toast('الكاميرا تشتغل على جهاز الصف نفسه',false); return; }
    let iv=0;
    const ok=await modal({title:'صورة من الكاميرا',iconName:'camera',wide:true,
      body:`<div class="campaste"><img id="cpImg" alt=""><div class="cam-note" id="cpErr" hidden></div></div><p class="hint">وجّه الكاميرا على الكتاب أو الدفتر واضغط «التقاط ولصق».</p>`,
      actions:[{label:'إلغاء',val:false,cls:'ghost'},{label:icon('camera')+'التقاط ولصق',val:true,cls:'primary'}],
      onOpen:ov=>{ const im=$('#cpImg',ov); const t=()=>{ const n=new Image(); n.onload=()=>{ im.src=n.src; $('#cpErr',ov).hidden=true; }; n.onerror=()=>{ const er=$('#cpErr',ov); er.hidden=false; er.textContent='ماكو صورة من الكاميرا — تأكد إنها مختارة من الإعدادات ← الكاميرا'; };
        n.src='/api/cam/snap.jpg?t='+encodeURIComponent(API.tok||'')+'&r='+Date.now(); }; t(); iv=setInterval(t,350); }});
    clearInterval(iv); if(!ok) return;
    try{ const r=await fetch('/api/cam/snap.jpg?t='+encodeURIComponent(API.tok||'')+'&r='+Date.now()); if(!r.ok) throw new Error('ماكو صورة');
      const url=await readAsDataURL(await r.blob()); if(!isShown('board')) go('board'); await Board.insertImage(url); }
    catch(e){ toast('تعذر التقاط الصورة: '+errMsg(e),false); }
  }
};

/* ---------- الستارة: تغطي الشاشة وتنسحب لتحت حتى تكشف جزء جزء ---------- */
const Curtain={
  on:false, h:1,
  toggle(){ this.on?this.close():this.open(); },
  open(){
    let el=$('#curtain'); if(!el){ el=document.createElement('div'); el.id='curtain';
      el.innerHTML=`<div class="ct-body"><div class="ct-logo">Alharthia<b>OS</b></div><span class="ct-hint">اسحب الحافة لتحت حتى تكشف</span></div><div class="ct-handle"><i></i></div><button class="ct-x" title="إغلاق الستارة">${icon('x')}</button>`;
      document.body.appendChild(el);
      const hd=el.querySelector('.ct-handle'); let drag=null;
      const mv=e=>{ if(!drag) return; this.set((innerHeight-e.clientY)/innerHeight); };
      hd.addEventListener('pointerdown',e=>{ drag=e.pointerId; hd.setPointerCapture(e.pointerId); e.preventDefault(); });
      hd.addEventListener('pointermove',mv); hd.addEventListener('pointerup',()=>{ drag=null; if(this.h<.04) this.close(); }); hd.addEventListener('pointercancel',()=>drag=null);
      el.querySelector('.ct-x').onclick=()=>this.close(); }
    el.hidden=false; this.on=true; this.set(1); window.RemoteBridge&&RemoteBridge.push();
  },
  set(f){ this.h=clamp(f,0,1); const el=$('#curtain'); if(el) el.style.height=(this.h*100)+'%'; },
  close(){ const el=$('#curtain'); if(el) el.hidden=true; this.on=false; window.RemoteBridge&&RemoteBridge.push(); }
};
window.Curtain=Curtain;

/* ---------- المكبّر: عدسة دائرية تكبّر جزء من السبورة ---------- */
const Magnifier={
  on:false, x:.5, y:.3, z:2.4, R:150,
  toggle(){ this.on?this.close():this.open(); },
  open(){
    if(!isShown('board')) go('board');
    let el=$('#magLens'); if(!el){ el=document.createElement('div'); el.id='magLens'; el.innerHTML=`<canvas></canvas><button class="mg-x">${icon('x')}</button><div class="mg-z"><button data-z="-">−</button><b></b><button data-z="+">+</button></div>`;
      $('#boardArea').appendChild(el);
      let drag=null;
      el.addEventListener('pointerdown',e=>{ if(e.target.closest('button')) return; drag={id:e.pointerId,dx:e.clientX-el.offsetLeft,dy:e.clientY-el.offsetTop}; el.setPointerCapture(e.pointerId); e.preventDefault(); });
      el.addEventListener('pointermove',e=>{ if(!drag) return; const a=$('#boardArea'); this.x=(e.clientX-drag.dx+this.R)/a.clientWidth; this.y=(e.clientY-drag.dy+this.R)/a.clientHeight; this.render(); });
      el.addEventListener('pointerup',()=>drag=null);
      el.querySelector('.mg-x').onclick=()=>this.close();
      el.querySelector('.mg-z').onclick=e=>{ const b=e.target.closest('[data-z]'); if(!b) return; this.z=clamp(this.z+(b.dataset.z==='+'?.5:-.5),1.5,5); this.render(); };
    }
    el.hidden=false; this.on=true; this.render();
    clearInterval(this.iv); this.iv=setInterval(()=>{ if(this.on&&isShown('board')) this.render(); },120);
  },
  render(){
    const el=$('#magLens'), a=$('#boardArea'); if(!el||!a) return; const B=Board, R=this.R, d=B.d;
    this.x=clamp(this.x,0,1); this.y=clamp(this.y,0,1);
    const px=this.x*a.clientWidth, py=this.y*a.clientHeight;
    el.style.left=(px-R)+'px'; el.style.top=(py-R)+'px'; el.querySelector('b').textContent='×'+nf(this.z);
    const cv=el.querySelector('canvas'); if(cv.width!==R*2*d){ cv.width=cv.height=R*2*d; }
    const x=cv.getContext('2d'), sw=R*2/this.z;
    x.save(); x.setTransform(1,0,0,1,0,0); x.clearRect(0,0,cv.width,cv.height);
    for(const src of [B.cBg,B.cBase,B.cLive]) x.drawImage(src,(px-sw/2)*d,(py-sw/2)*d,sw*d,sw*d,0,0,cv.width,cv.height);
    x.restore();
  },
  close(){ const el=$('#magLens'); if(el) el.hidden=true; this.on=false; clearInterval(this.iv); }
};

/* ---------- سبورة لطالبين: الشاشة تنقسم نصّين، لكل طالب اسمه ومسح نصّه ونقاطه ---------- */
const DuoBoard={
  on:false, names:['الطالب الأول','الطالب الثاني'], score:[0,0],
  toggle(){ this.on?this.close():this.open(); },
  open(){
    if(!isShown('board')) go('board');
    let el=$('#duo'); if(!el){ el=document.createElement('div'); el.id='duo'; $('#boardArea').appendChild(el);
      el.addEventListener('click',async e=>{ const b=e.target.closest('[data-duo]'); if(!b) return; const [a,i]=b.dataset.duo.split(':'), k=+i;
        if(a==='name'){ const n=await this.pickName(k); if(n){ this.names[k]=n; this.render(); } }
        if(a==='pick'){ const n=this.randomName(k); if(n){ this.names[k]=n; this.render(); } }
        if(a==='clear') this.clearHalf(k);
        if(a==='plus'){ this.score[k]++; this.render(); beep(1,990); }
        if(a==='minus'){ this.score[k]=Math.max(0,this.score[k]-1); this.render(); }
        if(a==='close') this.close(); }); }
    el.hidden=false; this.on=true; this.score=[0,0]; this.render(); toast('السبورة انقسمت لطالبين — كل واحد يكتب بنصّه');
  },
  render(){
    const el=$('#duo'); if(!el) return;
    el.innerHTML=`<div class="duo-line"></div>${[0,1].map(k=>`<div class="duo-head" style="${k?'left':'right'}:12px">
      <button data-duo="name:${k}" class="duo-nm">${esc(this.names[k])}</button><button data-duo="pick:${k}" title="اسم عشوائي">${icon('dice')}</button>
      <span class="duo-sc"><button data-duo="minus:${k}">−</button><b>${nf(this.score[k])}</b><button data-duo="plus:${k}">+</button></span>
      <button data-duo="clear:${k}" title="مسح هذا النص">${icon('eraser')}</button></div>`).join('')}<button class="duo-x" data-duo="close:0">${icon('x')}إنهاء</button>`;
  },
  randomName(k){ const C=Attend.cls, r=C.records[dkey(tzNow())]||{}; let pool=C.students.filter(s=>r[s.id]!=='a'&&r[s.id]!=='e'&&!this.names.includes(s.name)); if(!pool.length){ toast('ضيف أسماء الطلاب أول',false); return null; } return pool[Math.floor(Math.random()*pool.length)].name; },
  async pickName(k){ return promptBox('اسم الطالب',this.names[k]); },
  /* نمسح العناصر الي مركزها بالنص المطلوب (اليمين = الأول بالعربي) */
  clearHalf(k){
    const B=Board, mid=.5, entries=[];
    B.page.items.forEach((it,idx)=>{ if(it.t==='clear') return; const b=itemBBox(it), cx=(b[0]+b[2])/2; const right=cx>=mid; if((k===0&&right)||(k===1&&!right)) entries.push({it,idx}); });
    if(!entries.length) return; const ids=new Set(entries.map(e=>e.it.id));
    B.page.items=B.page.items.filter(i=>!ids.has(i.id)); B.record({type:'remove',entries}); B.redraw(); toast('انمسح نص '+this.names[k]);
  },
  close(){ const el=$('#duo'); if(el) el.hidden=true; this.on=false; }
};
