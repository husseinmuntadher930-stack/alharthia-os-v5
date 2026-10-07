/* =====================================================================
   SPLIT SCREEN — تقسيم الشاشة
   • أي تطبيقين من تطبيقات الواجهة (سبورة، PDF، ملفات، جدول، متصفح، إعدادات…) جنب بعض، وكل واحد يشتغل بالكامل.
   • اضغط على أي نصف حتى يصير هو الفعّال؛ أي تطبيق تفتحه (من قائمة التطبيقات أو الأزرار) ينفتح بالنصف الفعّال.
   • البرامج الخارجية (Chromium، LibreOffice، …) تنثبّت بنص الشاشة والواجهة بالنص الثاني (عن طريق labwc).
   ===================================================================== */
const Split={
  nat:null,           // 'left' | 'right' إذا كان برنامج خارجي ثابت بنص الشاشة
  init(){
    const sc=$('#screens'), dv=$('#spDiv');
    sc.addEventListener('pointerdown',e=>{
      if(!SPL.on||e.target.closest('#spDiv')) return;
      const p=e.target.closest('.screen.sp-r,.screen.sp-l'); if(p) this.focus(p.classList.contains('sp-r')?'a':'b');
    },true);
    dv.addEventListener('pointerdown',e=>{ if(!e.target.closest('[data-sp]')) this.drag(e); });
    dv.addEventListener('click',e=>{ const b=e.target.closest('[data-sp]'); if(!b) return; if(b.dataset.sp==='swap') this.swap(); else this.exit(); });
    addEventListener('resize',()=>{ if(SPL.on) this.apply(); });
  },
  other(s){ return s==='a'?'b':'a'; },
  toggle(){
    if(this.nat){ this.restoreNative(); return; }
    if(SPL.on) this.menu(); else this.enter();
  },
  enter(){
    if(current==='home'){ toast('افتح تطبيق أول، بعدين اضغط «تقسيم الشاشة»'); return; }
    if(current==='gen'){ toast('هذا التطبيق ما يدعم التقسيم',false); return; }
    SPL.on=true;
    if(current==='apps'){ SPL.a='apps'; SPL.b='board'; SPL.act='a'; }
    else { SPL.a=current; SPL.b='apps'; SPL.act='b'; }
    current=SPL[SPL.act]; this.apply();
    onShow.apps&&onShow.apps();
    toast(SPL.act==='b'?'اختر التطبيق الثاني من القائمة':'اختر التطبيق من القائمة');
  },
  async menu(){
    const v=await modal({title:'تقسيم الشاشة',iconName:'split',body:`<p>اضغط أي نصف حتى يصير فعّال، وأي تطبيق تفتحه ينفتح بيه. اسحب الخط الأوسط لتغيير العرض.</p>`,
      actions:[{label:'إلغاء',val:null,cls:'ghost'},{label:'تبديل الجهتين',val:'swap',cls:'ghost'},{label:'إبقاء اليمين فقط',val:'a',cls:''},{label:'إبقاء اليسار فقط',val:'b',cls:''},{label:'إنهاء التقسيم',val:'x',cls:'primary'}]});
    if(v==='swap') this.swap(); else if(v==='a'||v==='b') this.exit(v); else if(v==='x') this.exit();
  },
  /* التنقل أثناء التقسيم — يستبدل التطبيق بالنصف الفعّال */
  go(id,arg){
    if(id==='home'){ this.exit(); return go('home'); }
    const me=SPL.act, ot=this.other(me);
    if(SPL[ot]===id&&SPL[me]!==id){ this.focus(ot); onShow[id]&&onShow[id](arg); return; }
    const old=SPL[me];
    if(old!==id&&old){ onHide[old]&&onHide[old](); }
    SPL[me]=id; current=id; this.apply(); onShow[id]&&onShow[id](arg);
  },
  focus(side){
    if(SPL.act===side&&current===SPL[side]) return;
    SPL.act=side; current=SPL[side]; this.apply();
  },
  swap(){ [SPL.a,SPL.b]=[SPL.b,SPL.a]; SPL.act=this.other(SPL.act); this.apply(); },
  exit(keep){
    if(!SPL.on) return;
    const side=keep||SPL.act, k=SPL[side], drop=SPL[this.other(side)];
    SPL.on=false; $('#screens').classList.remove('split'); $('#spDiv').hidden=true;
    $$('.screen').forEach(s=>s.classList.remove('sp-r','sp-l','sp-act'));
    current=drop; go(k);
    window.Side&&Side.open&&Side.show(Side.side);
  },
  apply(){
    const sc=$('#screens'); sc.classList.add('split');
    const W=sc.clientWidth||innerWidth, mn=Math.max(.22,Math.min(.45,330/W));
    S.splitRatio=clamp(S.splitRatio||.5,mn,1-mn);
    sc.style.setProperty('--sp',S.splitRatio);
    $$('.screen').forEach(s=>{
      const on=s.id===SPL.a||s.id===SPL.b;
      s.classList.toggle('on',on); s.classList.toggle('sp-r',on&&s.id===SPL.a); s.classList.toggle('sp-l',on&&s.id===SPL.b);
      s.classList.toggle('sp-act',on&&s.id===current);
    });
    $('#spDiv').hidden=false;
    $('#tbHome').hidden=false; $('#tbApps').hidden=current==='apps'; $('#tbMark').hidden=true; $('#tbTitle').hidden=false;
    $('#tbTitle').textContent=TITLES[current]||'';
    $('#os').classList.toggle('immersive',[SPL.a,SPL.b].every(id=>$('#'+id).hasAttribute('data-immersive')));
    requestAnimationFrame(()=>window.dispatchEvent(new Event('alh-split')));
  },
  drag(e){
    e.preventDefault(); const sc=$('#screens'), r=sc.getBoundingClientRect(), dv=$('#spDiv'); dv.classList.add('drag');
    const mv=ev=>{ const W=r.width, mn=Math.max(.22,Math.min(.45,330/W)); S.splitRatio=clamp((r.right-ev.clientX)/W,mn,1-mn); sc.style.setProperty('--sp',S.splitRatio); };
    const up=()=>{ removeEventListener('pointermove',mv); removeEventListener('pointerup',up); dv.classList.remove('drag'); save(); this.apply(); };
    addEventListener('pointermove',mv); addEventListener('pointerup',up);
  },

  /* ---------- البرامج الخارجية (Chromium / LibreOffice / …) ---------- */
  real(){ return !!(window.ALH_HOST||(window.Native&&Native.on)); },
  /* يُستدعى قبل فتح برنامج خارجي: إذا كان التقسيم شغّال نخلي البانل الي نبقيه، والبرنامج ياخذ النص الثاني. يرجّع true إذا انثبّت. */
  nativeOn(){
    if(!SPL.on||!this.real()) return false;
    const act=SPL[SPL.act], keepSide=act==='apps'?this.other(SPL.act):SPL.act;
    this.nat=keepSide==='a'?'left':'right';          // الواجهة تبقى بجهة اليمين إذا بقى البانل a
    this.exit(keepSide);
    if(window.ALH_HOST) console.log('ALHCMD:'+JSON.stringify({cmd:'unfull'}));
    API.post('/api/split/snap',{side:this.nat}).catch(e=>toast(errMsg(e),false));
    if(window.Side&&Side.open) Side.show(Side.side);
    toast('البرنامج راح ينفتح بنص الشاشة');
    return true;
  },
  restoreNative(){
    this.nat=null;
    API.post('/api/split/restore',{}).catch(()=>{});
    setTimeout(()=>{ if(window.ALH_HOST) console.log('ALHCMD:'+JSON.stringify({cmd:'full'})); },900);
    if(window.Side&&Side.open) Side.show(Side.side);
    toast('رجعت الواجهة لملء الشاشة');
  }
};
