/* =====================================================================
   3.0 — الصف الذكي
   * الصبورة تعرف الحصة من الجدول: شريط عدّ تنازلي، تنبيه قبل النهاية للريموت،
     وأول الحصة تعرض «كمّل من الحصة الأخيرة» و«ملفات الدرس».
   * ترتيب الدور، لوحة الواجبات، وبطاقات RFID للحضور.
   ===================================================================== */
ICONS.queue='<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="4" cy="6" r="1.4" fill="currentColor"/><circle cx="4" cy="12" r="1.4" fill="currentColor"/><circle cx="4" cy="18" r="1.4" fill="currentColor"/>';
ICONS.homework='<path d="M4 4h12a4 4 0 0 1 4 4v12H8a4 4 0 0 1-4-4z"/><path d="M8 9h8M8 13h6"/>';
ICONS.card='<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 15h4M15 9a3 3 0 0 1 0 4M17.5 7.5a6 6 0 0 1 0 7"/>';
ICONS.clip2='<path d="m21 11-8.5 8.5a5 5 0 0 1-7-7L14 4a3.5 3.5 0 0 1 5 5l-8.5 8.5a2 2 0 0 1-3-3L15 7"/>';
const minsOf=s=>schRange(s);

const Classroom={
  key:'', warned:'', banner:null,
  init(){
    window.Classroom=this;
    setInterval(()=>this.tick(),15e3); setInterval(()=>this.bar(),1000);
    setTimeout(()=>this.tick(true),4000);
  },
  on(f){ return !window.Features||Features.on(f); },
  /* الحصة الحالية: المادة + وقت البداية والنهاية (ثواني epoch) */
  lessonInfo(){
    if(typeof Sched==='undefined'||!Sched.data) return null;
    const n=Sched.now(); if(n.day<0||n.per<0) return null;
    const sid=Sched.data.cells[n.day+'-'+n.per], sj=sid&&Sched.sub(sid), mm=minsOf(Sched.data.times[n.per]); if(!mm) return null;
    const t=tzNow(), nowM=t.getHours()*60+t.getMinutes()+t.getSeconds()/60, base=Date.now()/1000;
    return {per:n.per,day:n.day,sid:sid||'',subj:sj?sj.name:'',start:Math.round(base+(mm[0]-nowM)*60),end:Math.round(base+(mm[1]-nowM)*60)};
  },
  tick(first){
    const L=this.lessonInfo(), key=L?`${dkey(tzNow())}-${L.per}`:'';
    if(key!==this.key){
      const prev=this.prevL; this.key=key; this.prevL=L;
      if(prev&&prev.sid&&this.on('lastLesson')) this.saveBoard(prev);
      if(L&&L.sid&&!first) this.startLesson(L);
      else if(L&&L.sid&&first&&Date.now()/1000-L.start<10*60) this.startLesson(L);
      window.RemoteBridge&&RemoteBridge.push();
    }
    if(L&&this.on('endNotice')){ const left=L.end-Date.now()/1000;
      if(left<=300&&left>240&&this.warned!==key){ this.warned=key; const msg=`باقي ٥ دقائق على نهاية ${L.subj?'حصة '+L.subj:'الحصة'}`;
        window.RemoteBridge&&RemoteBridge.notify(msg); if(S.lessonToast!==false) toast(msg); } }
  },
  /* الاستراحة الحالية (إذا اكو) */
  breakInfo(){
    if(typeof Sched==='undefined'||!Sched.data) return null;
    const n=Sched.now(); if(n.day<0||n.brk<0) return null;
    const mm=schRange(Sched.data.breaks[n.brk]); if(!mm) return null;
    const t=tzNow(), nowM=t.getHours()*60+t.getMinutes()+t.getSeconds()/60, base=Date.now()/1000;
    return {brk:n.brk,subj:'استراحة',start:Math.round(base+(mm[0]-nowM)*60),end:Math.round(base+(mm[1]-nowM)*60)};
  },
  /* ---------- شريط العد التنازلي ---------- */
  bar(){
    let el=$('#lessonBar'); const L=this.on('countdown')?(this.lessonInfo()||this.breakInfo()):null;
    if(!L||document.documentElement.classList.contains('gated')){ if(el) el.hidden=true; return; }
    if(!el){ el=document.createElement('div'); el.id='lessonBar'; el.innerHTML='<i></i><span></span>'; document.body.appendChild(el); }
    const now=Date.now()/1000, tot=Math.max(60,L.end-L.start), left=Math.max(0,L.end-now), f=clamp(left/tot,0,1);
    const brk=L.brk!==undefined; el.hidden=false; el.classList.toggle('brk',brk); el.classList.toggle('warn',!brk&&left<=300); el.classList.toggle('end',!brk&&left<=60);
    el.querySelector('i').style.width=(f*100)+'%';
    const m=Math.floor(left/60), s=Math.floor(left%60);
    el.querySelector('span').textContent=`${brk?'☕ ':''}${L.subj||'الحصة'} · ${nf(m)}:${nf(pad(s))}`;
  },
  /* ---------- بداية الحصة ---------- */
  startLesson(L){
    if(!this.on('autoPrep')) return;
    const sj=Sched.sub(L.sid); if(!sj) return;
    const saved=store.get('lastBoard.'+L.sid,null), files=sj.files||[];
    if(!saved&&!files.length) return;
    this.showBanner(`<b>${icon('board')}بدأت حصة ${esc(sj.name)}</b>
      ${saved?`<button class="btn sm primary" data-lb="resume">${icon('restart')}كمّل من الحصة الأخيرة <small>${esc(shortDate(new Date(saved.t)))}</small></button>`:''}
      ${files.length?`<button class="btn sm" data-lb="files">${icon('clip2')}ملفات الدرس (${nf(files.length)})</button>`:''}`,L.sid);
    if(S.autoResume&&saved) this.resume(L.sid);
  },
  showBanner(html,sid){
    let el=$('#lessonBanner'); if(!el){ el=document.createElement('div'); el.id='lessonBanner'; document.body.appendChild(el);
      el.addEventListener('click',e=>{ const b=e.target.closest('[data-lb]'); if(!b) return; const a=b.dataset.lb;
        if(a==='x'){ el.hidden=true; return; }
        if(a==='resume') this.resume(el.dataset.sid);
        if(a==='files') this.openFiles(el.dataset.sid);
        el.hidden=true; }); }
    el.dataset.sid=sid; el.innerHTML=html+`<button class="icon-btn" data-lb="x">${icon('x')}</button>`; el.hidden=false;
    clearTimeout(this.bT); this.bT=setTimeout(()=>el.hidden=true,120e3);
  },
  saveBoard(L){
    const B=Board; if(!B.pages.some(p=>p.items.length)) return;
    const data={t:Date.now(),subj:L.subj,board:B.exportData()};
    if(!store.set('lastBoard.'+L.sid,data)){ try{ FS.add('boards',{name:`حصة ${L.subj} - ${shortDate()}.board`,type:'board',size:JSON.stringify(data.board).length,data:data.board}); }catch(e){} }
  },
  async resume(sid){
    const d=store.get('lastBoard.'+sid,null); if(!d) return;
    if(Board.pages.some(p=>p.items.length)){ const L=this.prevL; if(L&&L.sid&&L.sid!==sid) this.saveBoard(L); }
    Board.loadData(d.board); go('board'); toast('رجعت سبورة الحصة الأخيرة ('+d.subj+')');
  },
  async openFiles(sid){
    const sj=Sched.sub(sid); const files=(sj&&sj.files)||[]; if(!files.length) return;
    let f=files[0];
    if(files.length>1){ const i=await modal({title:'ملفات '+sj.name,iconName:'clip2',body:`<div class="list-btns">${files.map((x,i)=>`<button class="btn" data-fi="${i}">${icon(fileIcon(x.name))}${esc(x.name)}</button>`).join('')}</div>`,
        actions:[{label:'إلغاء',val:null,cls:'ghost'}],onOpen:(ov,done)=>ov.querySelector('.mb').addEventListener('click',e=>{ const b=e.target.closest('[data-fi]'); if(b) done(+b.dataset.fi); })});
      if(i==null) return; f=files[i]; }
    openFile(nodeOf({path:f.path,name:f.name,dir:false,size:f.size||0,mtime:0}));
  },
  /* ---------- ملفات الدرس (من شاشة الجدول) ---------- */
  async manageFiles(sid){
    const sj=Sched.sub(sid); if(!sj) return; sj.files=sj.files||[];
    const render=ov=>{ $('.mb',ov).innerHTML=`<p class="hint">هذي الملفات تطلع أول ما تبدي حصة ${esc(sj.name)} — بضغطة وحدة تنفتح.</p>
      <div class="list-btns">${sj.files.map((x,i)=>`<div class="row"><span style="flex:1">${icon(fileIcon(x.name))} ${esc(x.name)}</span><button class="btn sm danger" data-rmf="${i}">${icon('trash')}</button></div>`).join('')||'<p class="hint">ماكو ملفات بعد.</p>'}</div>
      <div class="btns" style="margin-top:10px"><button class="btn primary" data-addf="1">${icon('plus')}إضافة ملف</button></div>`; paintIcons(ov); };
    await modal({title:'ملفات الدرس — '+sj.name,iconName:'clip2',body:'',actions:[{label:'تم',val:true,cls:'primary'}],
      onOpen:ov=>{ render(ov); $('.mb',ov).addEventListener('click',async e=>{
        const r=e.target.closest('[data-rmf]'); if(r){ sj.files.splice(+r.dataset.rmf,1); Sched.persist(); render(ov); return; }
        if(e.target.closest('[data-addf]')){
          if(!(window.Native&&Native.on)){ toast('اختيار الملفات يشتغل على جهاز الصف',false); return; }
          const got=await FilePicker.pick({accept:'.pdf,.pptx,.docx,.xlsx,image/*,video/*,.board',multiple:true,title:'ملفات '+sj.name});
          if(got&&got.length){ for(const g of got) if(!sj.files.some(x=>x.path===g.path)) sj.files.push({path:g.path,name:g.name,size:g.size}); Sched.persist(); render(ov); } } }); }});
    Sched.render();
  }
};
const fileIcon=n=>({pdf:'pdf',pptx:'slides',docx:'word',xlsx:'table',png:'image',jpg:'image',jpeg:'image',board:'board'}[String(n).split('.').pop().toLowerCase()]||'doc');

/* ---------- ترتيب الدور ---------- */
const TurnOrder={
  get T(){ const C=Attend.cls, d=dkey(tzNow()); if(!C.turn||C.turn.date!==d) C.turn={date:d,order:[],i:0,done:[]}; return C.turn; },
  pool(){ const C=Attend.cls, r=C.records[dkey(tzNow())]||{}; return C.students.filter(s=>r[s.id]!=='a'&&r[s.id]!=='e'); },
  build(mode){ const T=this.T, P=this.pool().map(s=>s.id); if(mode==='random') for(let i=P.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [P[i],P[j]]=[P[j],P[i]]; } T.order=P; T.i=0; T.done=[]; Attend.persist(); },
  name(id){ const s=Attend.cls.students.find(x=>x.id===id); return s?s.name:'؟'; },
  async open(){
    if(!Attend.cls.students.length){ toast('ضيف أسماء الطلاب من تطبيق الحضور أول',false); return; }
    if(!this.T.order.length) this.build('list');
    const render=ov=>{ const T=this.T; $('.mb',ov).innerHTML=`<div class="turn-now">${T.i<T.order.length?`<small>الدور الحالي</small><b>${esc(this.name(T.order[T.i]))}</b><small>${nf(T.i+1)} من ${nf(T.order.length)}</small>`:'<b>خلص الدور — كل الطلاب شاركوا</b>'}</div>
      <ol class="turn-list">${T.order.map((id,k)=>`<li class="${k<T.i?'done':k===T.i?'cur':''}">${esc(this.name(id))}</li>`).join('')}</ol>
      <div class="btns"><button class="btn sm ghost" data-tq="list">${icon('queue')}حسب القائمة</button><button class="btn sm ghost" data-tq="random">${icon('dice')}ترتيب عشوائي</button></div>`; paintIcons(ov);
      const cur=$('.turn-list .cur',ov); cur&&cur.scrollIntoView({block:'center'}); };
    await modal({title:'ترتيب الدور',iconName:'queue',wide:true,body:'',actions:[{label:'السابق',val:()=>'__prev',cls:'ghost'},{label:'التالي',val:()=>'__next',cls:'primary'},{label:'إغلاق',val:null,cls:'ghost'}],
      onOpen:(ov,done)=>{ render(ov);
        ov.querySelector('.modal > .btns').addEventListener('click',e=>{ const b=e.target.closest('[data-i]'); if(!b) return; const i=+b.dataset.i; if(i<2){ e.stopPropagation(); const T=this.T; T.i=clamp(T.i+(i?1:-1),0,T.order.length); Attend.persist(); render(ov); if(i&&T.i<T.order.length) beep(1,880); } },true);
        $('.mb',ov).addEventListener('click',e=>{ const b=e.target.closest('[data-tq]'); if(b){ this.build(b.dataset.tq); render(ov); } }); }});
  }
};

/* ---------- لوحة الواجبات (بشاشة الجدول) ---------- */
const Homework={
  get list(){ const D=Sched.data; D.homework=D.homework||[]; return D.homework; },
  upcoming(){ const today=dkey(tzNow()); return this.list.filter(h=>!h.due||h.due>=today).sort((a,b)=>(a.due||'9').localeCompare(b.due||'9')); },
  card(ed){
    const L=this.upcoming();
    return `<div class="card"><h3>${icon('homework')}لوحة الواجبات (${nf(L.length)})<span class="end btns">${L.length?`<button class="btn sm ghost" data-hw="big">${icon('fit')}عرض كبير</button>`:''}${ed?`<button class="btn sm" data-hw="add">${icon('plus')}واجب</button>`:''}</span></h3>
      ${L.length?`<div class="hw-list">${L.map(h=>{ const sj=Sched.sub(h.sid); return `<div class="hw"><i class="dot" style="--sc:${sj?Sched.col(sj.id):'#94a3b8'}"></i><div><b>${esc(sj?sj.name:'عام')}</b><span>${esc(h.text)}</span>${h.due?`<small>التسليم: ${esc(this.dueLabel(h.due))}</small>`:''}</div>${ed?`<button class="mini" data-hwdel="${h.id}">${icon('trash')}</button>`:''}</div>`; }).join('')}</div>`:'<p class="note">ماكو واجبات.</p>'}</div>`;
  },
  dueLabel(k){ const [y,m,d]=k.split('-').map(Number), dt=new Date(y,m-1,d); return `${DAYS[dt.getDay()]} ${nf(d)}/${nf(m)}`; },
  async add(){
    const L=Classroom.lessonInfo(); const D=Sched.data;
    const v=await modal({title:'واجب جديد',iconName:'homework',body:`<label class="hint">المادة</label><select class="field" id="hwS">${D.subjects.map(s=>`<option value="${s.id}" ${L&&L.sid===s.id?'selected':''}>${esc(s.name)}</option>`).join('')}</select>
      <label class="hint">الواجب</label><textarea class="field" id="hwT" placeholder="مثلاً: حل تمارين صفحة ٤٥"></textarea>
      <label class="hint">يوم التسليم</label><input class="field" type="date" id="hwD" value="${(()=>{ const d=tzNow(); d.setDate(d.getDate()+1); return dkey(d); })()}">`,
      actions:[{label:'إلغاء',val:null,cls:'ghost'},{label:'حفظ',val:ov=>({sid:$('#hwS',ov).value,text:$('#hwT',ov).value.trim(),due:$('#hwD',ov).value}),cls:'primary'}]});
    if(!v||!v.text) return; this.list.push({id:uid(),...v,t:Date.now()}); Sched.persist(); Sched.render(); toast('انضاف الواجب');
  },
  big(){
    const L=this.upcoming();
    modal({title:'الواجبات',iconName:'homework',wide:true,body:`<div class="hw-big">${L.map(h=>{ const sj=Sched.sub(h.sid); return `<div><b style="--sc:${sj?Sched.col(sj.id):'#94a3b8'}">${esc(sj?sj.name:'عام')}</b><span>${esc(h.text)}</span>${h.due?`<small>${esc(this.dueLabel(h.due))}</small>`:''}</div>`; }).join('')}</div>`,actions:[{label:'إغلاق',val:null,cls:'primary'}]});
  }
};

/* ---------- بطاقات RFID: القارئ (USB) يكتب رقم البطاقة بسرعة ويضغط Enter ---------- */
const RFID={
  buf:'', last:0, gaps:[], waiting:null,
  init(){
    window.RFID=this;
    addEventListener('keydown',e=>this.key(e),true);
  },
  key(e){
    const now=performance.now();
    if(/^[0-9A-Fa-f]$/.test(e.key)){ if(now-this.last>80){ this.buf=''; this.gaps=[]; } else this.gaps.push(now-this.last); this.buf+=e.key; this.last=now; return; }
    if(e.key==='Enter'){
      const fast=this.gaps.length>=5&&this.gaps.reduce((a,b)=>a+b,0)/this.gaps.length<45;
      if(fast&&this.buf.length>=6&&this.buf.length<=20&&now-this.last<120){
        const uid=this.buf.toUpperCase(); this.buf=''; e.preventDefault(); e.stopPropagation();
        const t=document.activeElement; if(t&&(t.tagName==='INPUT'||t.tagName==='TEXTAREA')&&t.value.endsWith(uid.slice(-6))) t.value=t.value.slice(0,-uid.length);
        this.card(uid);
      }
      this.buf=''; this.gaps=[];
    }
  },
  find(uid){ for(const C of Attend.data.classes) for(const s of C.students) if(s.card===uid) return {C,s}; return null; },
  card(uid){
    if(this.waiting){ const w=this.waiting; this.waiting=null; w(uid); return; }
    if(window.Features&&!Features.on('rfid')) return;
    const f=this.find(uid);
    if(!f){ toast('بطاقة غير معرّفة — عرّفها من الحضور ← الطلاب',false); beep(2,220); return; }
    const {C,s}=f, d=dkey(tzNow()), r=C.records[d]||(C.records[d]={});
    const L=Classroom.lessonInfo(), late=S.rfidLateMin&&L&&L.per===0&&(Date.now()/1000-L.start)>S.rfidLateMin*60;
    if(!r[s.id]||r[s.id]==='a') r[s.id]=late?'l':'p';
    Attend.persist(); if(current==='attend') Attend.refreshDay();
    this.welcome(s.name,late); if(window.Usage) Usage.hit('rfid');
  },
  welcome(name,late){
    let el=$('#rfidHi'); if(!el){ el=document.createElement('div'); el.id='rfidHi'; document.body.appendChild(el); }
    el.innerHTML=`${icon('check')}<b>أهلاً ${esc(name)}</b><span>${late?'سُجّل متأخر':'سُجّل حاضر'}</span>`; el.hidden=false; el.classList.toggle('late',!!late);
    beep(1,1046); clearTimeout(this.wT); this.wT=setTimeout(()=>el.hidden=true,2200);
  },
  /* ننتظر بطاقة (للتعريف) — يرجّع الرقم أو null إذا انلغى */
  wait(title,sub){
    return new Promise(res=>{
      modal({title,iconName:'card',body:`<div class="rfid-wait">${icon('card')}<b>مرّر البطاقة على القارئ</b><span>${sub||''}</span></div>`,actions:[{label:'إلغاء',val:null,cls:'ghost'}],
        onOpen:(ov,done)=>{ this.waiting=uid=>{ done(uid); }; }}).then(v=>{ this.waiting=null; res(v); });
    });
  },
  async link(sid){
    const C=Attend.cls, s=C.students.find(x=>x.id===sid); if(!s) return;
    const uid=await this.wait('ربط بطاقة',esc(s.name)); if(!uid) return;
    const other=this.find(uid); if(other&&other.s!==s&&!await confirmBox('بطاقة مستعملة',`هذي البطاقة مربوطة بـ «${esc(other.s.name)}». تنقلها لـ «${esc(s.name)}»؟`,'نقل',true,'card')) return;
    if(other) delete other.s.card; s.card=uid; Attend.persist(); Attend.render(); toast('انربطت البطاقة بـ '+s.name);
  },
  async linkAll(){
    const C=Attend.cls, list=C.students.filter(s=>!s.card); if(!list.length){ toast('كل الطلاب عدهم بطاقات'); return; }
    for(const s of list){
      const uid=await this.wait(`تعريف البطاقات (${nf(list.indexOf(s)+1)} من ${nf(list.length)})`,esc(s.name)); if(!uid) break;
      const other=this.find(uid); if(other){ toast(`البطاقة مربوطة بـ ${other.s.name} — تخطّينا ${s.name}`,false); continue; }
      s.card=uid; Attend.persist(); beep(1,1046);
    }
    Attend.render();
  },
  async test(){ const uid=await this.wait('فحص بطاقة','نطلعلك اسم صاحبها'); if(!uid) return; const f=this.find(uid);
    modal({title:'فحص بطاقة',iconName:'card',body:`<p style="text-align:center;font-size:22px"><b>${f?esc(f.s.name):'بطاقة غير معرّفة'}</b></p><p class="hint" style="text-align:center" dir="ltr">${esc(uid)}</p>`}); },
  unlink(sid){ const s=Attend.cls.students.find(x=>x.id===sid); if(s){ delete s.card; Attend.persist(); Attend.render(); toast('انفصلت البطاقة'); } }
};

/* ---------- ربط الواجهات الموجودة ---------- */
(function hookClassUI(){
  // شاشة الحضور: أزرار الدور والبطاقات
  const rm=Attend.renderMain.bind(Attend);
  Attend.renderMain=function(){
    rm();
    const M=$('#atMain');
    if(this.tab==='day'){ const b=M.querySelector('[data-cx=pick]'); if(b&&Classroom.on('turn')) b.insertAdjacentHTML('afterend',`<button class="btn" data-x3="turn">${icon('queue')}ترتيب الدور</button>`); }
    if(this.tab==='students'&&Classroom.on('rfid')){
      const card=M.querySelector('.card:last-child h3'); if(card) card.insertAdjacentHTML('afterend',`<div class="btns" style="margin:-4px 0 10px"><button class="btn sm" data-x3="cardsAll">${icon('card')}تعريف كل البطاقات</button><button class="btn sm ghost" data-x3="cardTest">${icon('card')}فحص بطاقة</button><span class="hint">قارئ RFID بـ USB — كل طالب يمرّر بطاقته ويتسجل حاضر.</span></div>`);
      $$('.tbl tr',M).forEach(tr=>{ const btn=tr.querySelector('[data-ren]'); if(!btn) return; const s=this.cls.students.find(x=>x.id===btn.dataset.ren); if(!s) return;
        btn.insertAdjacentHTML('beforebegin',s.card?`<button class="btn sm ghost" data-x3="cardOff" data-sid="${s.id}" title="فصل البطاقة">${icon('card')}✓</button>`:`<button class="btn sm ghost" data-x3="card" data-sid="${s.id}" title="ربط بطاقة">${icon('card')}+</button>`); });
    }
  };
  $('#atMain').addEventListener('click',e=>{ const b=e.target.closest('[data-x3]'); if(!b) return; e.stopPropagation(); const a=b.dataset.x3;
    if(a==='turn') TurnOrder.open(); if(a==='cardsAll') RFID.linkAll(); if(a==='cardTest') RFID.test();
    if(a==='card') RFID.link(b.dataset.sid); if(a==='cardOff') RFID.unlink(b.dataset.sid); },true);
  // شاشة الجدول: ملفات كل درس + لوحة الواجبات
  const sr=Sched.render.bind(Sched);
  Sched.render=function(){
    sr(); const ed=this.canEdit(), side=$('#schMain .sch-side');
    if(side&&Classroom.on('homework')) side.insertAdjacentHTML('afterbegin',Homework.card(ed));
    if(ed&&Classroom.on('autoPrep')) $$('#schMain .sch-sj .chip').forEach(ch=>{ const id=(ch.querySelector('[data-sren]')||{}).dataset; if(!id) return; const sj=this.sub(id.sren); if(!sj) return;
      ch.insertAdjacentHTML('beforeend',`<button class="mini" data-sfiles="${sj.id}" title="ملفات الدرس">${icon('clip2')}${sj.files&&sj.files.length?nf(sj.files.length):''}</button>`); });
    paintIcons($('#schMain'));
  };
  $('#schMain').addEventListener('click',e=>{
    const f=e.target.closest('[data-sfiles]'); if(f){ e.stopPropagation(); Classroom.manageFiles(f.dataset.sfiles); return; }
    const h=e.target.closest('[data-hw]'); if(h){ e.stopPropagation(); h.dataset.hw==='add'?Homework.add():Homework.big(); return; }
    const d=e.target.closest('[data-hwdel]'); if(d){ e.stopPropagation(); const L=Homework.list; L.splice(L.findIndex(x=>x.id===d.dataset.hwdel),1); Sched.persist(); Sched.render(); }
  },true);
})();
