/* =====================================================================
   SCHEDULE — جدول الحصص (يظهر لكل المستخدمين، والتعديل للأستاذ والمطوّر فقط)
   قائمة مواد وحدة تنختار منها الحصص + قائمة معلمين تضيفهم بنفسك.
   ===================================================================== */
const SCH_DAYS=['الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس'];
const SCH_COL=['#2563eb','#16a34a','#d97706','#9333ea','#0d9488','#e11d48','#0891b2','#c2410c','#4f46e5','#65a30d','#db2777','#475569','#b45309','#0f766e'];
/* دوام المدرسة: ٨:٠٠ — ١:٣٠ (٧ حصص و٣ استراحات) */
const SCH_TIMES=['8:00 - 8:45','8:45 - 9:30','9:40 - 10:25','10:25 - 11:10','11:20 - 12:05','12:05 - 12:50','12:55 - 13:30'];
const SCH_BREAKS=['9:30 - 9:40','11:10 - 11:20','12:50 - 12:55'];
const SCH_BRK_N=['الأولى','الثانية','الثالثة','الرابعة','الخامسة'];
/* «12:55 - 1:30» → دقائق من بداية اليوم. الساعات ١–٦ تنحسب بعد الظهر (الدوام ما يبدي قبل ٧) */
function schRange(s){ const m=String(s||'').replace(/[٠-٩]/g,d=>'٠١٢٣٤٥٦٧٨٩'.indexOf(d)).match(/(\d+):(\d+)\s*[-–]\s*(\d+):(\d+)/); if(!m) return null;
  const h=x=>{ x=+x; return x>=1&&x<=6?x+12:x; }; const a=h(m[1])*60+ +m[2], b=h(m[3])*60+ +m[4]; return b>a?[a,b]:null; }
/* عرض الوقت بنظام ١٢ ساعة: 13:30 → 1:30 */
function schFmt(s){ const r=schRange(s); if(!r) return String(s||''); const f=x=>{ let h=Math.floor(x/60); if(h>12) h-=12; return h+':'+String(x%60).padStart(2,'0'); }; return f(r[0])+' - '+f(r[1]); }
const SCH_SUBJ=['احياء','رياضة','فرنسي','رياضيات','اجتماعيات','عربي','كيمياء','اسلامية','انكليزي','فيزياء','فنية'];
/* الجدول الأصلي (الثالث المتوسط -ج-) — الصف = اليوم، العمود = رقم الحصة */
const SCH_GRID=[   // جدول تشرين الأول ٢٠٢٦
  ['انكليزي','فيزياء','احياء','اجتماعيات','رياضيات','فنية','عربي'],
  ['كيمياء','عربي','احياء','رياضيات','انكليزي','اجتماعيات','فرنسي'],
  ['كيمياء','عربي','فرنسي','انكليزي','اسلامية','رياضيات','فيزياء'],
  ['اجتماعيات','رياضة','احياء','عربي','انكليزي','اسلامية','رياضيات'],
  ['اجتماعيات','عربي','انكليزي','رياضيات','كيمياء','فيزياء','']
];
const Sched={
  data:null, tick:0,
  fresh(){
    const subjects=SCH_SUBJ.map((n,i)=>({id:'s'+(i+1),name:n}));
    const id=n=>(subjects.find(s=>s.name===n)||{}).id||'';
    const cells={}; SCH_GRID.forEach((row,d)=>row.forEach((n,p)=>{ if(n) cells[d+'-'+p]=id(n); }));
    return {title:'',subjects,teachers:[],times:SCH_TIMES.slice(),breaks:SCH_BREAKS.slice(),cells};
  },
  init(){
    this.data=store.get('timetable',null)||this.fresh();
    // 3.0: أوقات دوام المدرسة الجديدة (٨:٠٠ — ١:٣٠) + الاستراحات
    if(!S.schT3){ this.data.times=SCH_TIMES.slice(); this.data.breaks=SCH_BREAKS.slice(); this.persist(); S.schT3=true; save(); }
    if(!Array.isArray(this.data.breaks)){ this.data.breaks=SCH_BREAKS.slice(); this.persist(); }
    // جدول الدروس الجديد (تشرين الأول ٢٠٢٦) — الأوقات والمعلمين يبقون
    if(!S.schG4){ const D=this.data; D.cells={}; SCH_GRID.forEach((row,d)=>row.forEach((n,p)=>{ if(n) D.cells[d+'-'+p]=this.addSubject(n); })); this.persist(); S.schG4=true; save(); }
    const m=$('#schMain');
    m.addEventListener('click',e=>this.onClick(e));
    m.addEventListener('keydown',e=>{ if(e.key==='Enter'&&e.target.id==='schTn'){ e.preventDefault(); this.addTeacher(); } });
    setInterval(()=>{ if(isShown('sched')) this.mark(); },30e3);
    if(!S.schMig){ S.schMig=true; if(!S.dock.includes('sched')&&S.dock.length<8) S.dock.splice(2,0,'sched'); save(); }
  },
  persist(){ if(!store.set('timetable',this.data)) toast('تعذر حفظ الجدول',false); },
  canEdit(){ return typeof Role==='undefined'||!Role.is('student'); },
  sub(id){ return this.data.subjects.find(s=>s.id===id); },
  col(id){ const i=this.data.subjects.findIndex(s=>s.id===id); return SCH_COL[(i<0?0:i)%SCH_COL.length]; },
  /* اليوم والحصة الحالية */
  now(){
    const t=tzNow(), d=t.getDay(), dayIdx=d===0?0:(d>=1&&d<=4?d:-1); // الأحد=0 … الخميس=4
    const mins=t.getHours()*60+t.getMinutes(); let per=-1, brk=-1;
    this.data.times.forEach((s,i)=>{ const r=schRange(s); if(r&&mins>=r[0]&&mins<r[1]) per=i; });
    (this.data.breaks||[]).forEach((s,i)=>{ const r=schRange(s); if(r&&mins>=r[0]&&mins<r[1]) brk=i; });
    return {day:dayIdx,per,brk};
  },
  mark(){
    const n=this.now(); $$('#schMain .sch td.c, #schMain .sch th.dy, #schMain .sch th.pr').forEach(x=>x.classList.remove('now','today'));
    $$('#schMain .sch tr[data-d]').forEach(r=>{ const d=+r.dataset.d; r.querySelector('th.dy').classList.toggle('today',d===n.day);
      $$('td.c',r).forEach(td=>td.classList.toggle('now',d===n.day&&+td.dataset.p===n.per)); });
    $$('#schMain .sch th.pr').forEach(th=>th.classList.toggle('today',+th.dataset.p===n.per&&n.day>=0));
    $$('#schMain .sch-brk [data-bi]').forEach(c=>c.classList.toggle('now',+c.dataset.bi===n.brk&&n.day>=0));
  },
  render(){
    const D=this.data, ed=this.canEdit(), np=D.times.length;
    const head=`<div class="app-head"><span class="ficon" style="--c:#7c3aed;width:56px;height:56px">${icon('table')}</span><div><h1 class="h1">جدول الحصص</h1><p class="sub" style="margin:0">${esc(D.title||S.cls||'')}${ed?'':' — عرض فقط'}</p></div><span class="grow"></span>
      ${ed?`<button class="btn sm ghost" data-sch="title">${icon('edit')}اسم الجدول</button><button class="btn sm ghost danger" data-sch="reset">${icon('restart')}الجدول الأصلي</button>`:`<span class="note">${icon('info')}التعديل من الأستاذ أو المطوّر فقط</span>`}</div>`;
    const rows=SCH_DAYS.map((dn,d)=>`<tr data-d="${d}"><th class="dy">${dn}</th>${D.times.map((_,p)=>{ const sid=D.cells[d+'-'+p], sj=sid&&this.sub(sid);
      return `<td class="c${sj?'':' empty'}" data-p="${p}" ${ed?`data-cell="${d}-${p}" tabindex="0"`:''} style="--sc:${sj?this.col(sid):'transparent'}">${sj?`<b>${esc(sj.name)}</b>`:(ed?'<i>+</i>':'')}</td>`; }).join('')}</tr>`).join('');
    const thead=`<tr><th class="corner"></th>${D.times.map((t,p)=>`<th class="pr" data-p="${p}"><b>${nf(p+1)}</b><small ${ed?`data-time="${p}"`:''}><span dir="ltr">${esc(schFmt(t))}</span></small></th>`).join('')}</tr>`;
    const subj=`<div class="card"><h3>${icon('doc')}قائمة الدروس (${nf(D.subjects.length)})</h3><div class="chips sch-sj">${D.subjects.map(s=>`<span class="chip" style="--sc:${this.col(s.id)}"><i class="dot"></i>${esc(s.name)}${ed?`<button class="mini" data-sren="${s.id}" title="تعديل">${icon('edit')}</button><button class="mini" data-sdel="${s.id}" title="حذف">${icon('x')}</button>`:''}</span>`).join('')||'<span class="note">ماكو دروس</span>'}</div>
      ${ed?`<div class="btns" style="margin-top:12px"><button class="btn sm" data-sch="addS">${icon('plus')}إضافة درس</button></div>`:''}</div>`;
    const tch=`<div class="card"><h3>${icon('users')}المعلمون (${nf(D.teachers.length)})</h3>
      ${D.teachers.length?`<div class="sch-tl">${D.teachers.map(t=>{ const sj=t.subj&&this.sub(t.subj); return `<div class="sch-t"><span class="av">${esc(t.name.trim().charAt(0)||'؟')}</span><div class="nm"><b>${esc(t.name)}</b>${sj?`<small><i class="dot" style="--sc:${this.col(sj.id)}"></i>${esc(sj.name)}</small>`:''}</div>
        ${ed?`<span class="ac"><button class="mini" data-tsub="${t.id}" title="المادة">${icon('doc')}</button><button class="mini" data-tren="${t.id}" title="تعديل الاسم">${icon('edit')}</button><button class="mini" data-tdel="${t.id}" title="حذف">${icon('trash')}</button></span>`:''}</div>`; }).join('')}</div>`
        :`<div class="note" style="padding:6px 2px">${ed?'ما أضفت أي معلم بعد — اكتب الاسم تحت واضغط إضافة.':'ماكو معلمين مضافين.'}</div>`}
      ${ed?`<div class="sch-add"><input class="field" id="schTn" type="text" placeholder="اسم المعلم" autocomplete="off"><select class="field" id="schTs"><option value="">— المادة (اختياري) —</option>${D.subjects.map(s=>`<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select><button class="btn primary" data-sch="addT">${icon('plus')}إضافة</button></div>`:''}</div>`;
    $('#schMain').innerHTML=`${head}<div class="sch-wrap"><div class="card sch-card"><div class="sch-scroll"><table class="sch">${thead}${rows}</table></div>${this.brkHTML(ed)}${ed?`<p class="note" style="margin:12px 0 0">${icon('info')}اضغط أي خانة حتى تختار الدرس، واضغط الوقت حتى تعدله.</p>`:''}</div><div class="sch-side">${tch}${subj}</div></div>`;
    this.mark();
  },
  brkHTML(ed){
    const B=this.data.breaks||[]; if(!B.length&&!ed) return '';
    return `<div class="sch-brk"><b>${icon('timer')}الاستراحات</b>${B.map((t,i)=>`<span class="chip" data-bi="${i}" ${ed?`data-brk="${i}"`:''}>${'الاستراحة '+(SCH_BRK_N[i]||nf(i+1))} <span dir="ltr">${esc(schFmt(t))}</span></span>`).join('')}</div>`;
  },
  /* اختيار درس من القائمة — يرجّع id أو '' (فارغ) أو null (إلغاء) */
  pickSubject(title,{empty=true,cur=''}={}){
    const D=this.data;
    return modal({title,iconName:'table',wide:false,
      body:`<div class="chips sch-pick">${D.subjects.map(s=>`<button class="chip${s.id===cur?' on':''}" data-pk="${s.id}" style="--sc:${this.col(s.id)}"><i class="dot"></i>${esc(s.name)}</button>`).join('')}
        <button class="chip" data-pk="__new" style="border-style:dashed">${icon('plus')}درس جديد</button>${empty?`<button class="chip" data-pk="__none">${icon('x')}فارغ</button>`:''}</div>`,
      actions:[{label:'إلغاء',val:null,cls:'ghost'}],
      onOpen:(ov,done)=>{ ov.querySelector('.mb').addEventListener('click',async e=>{ const b=e.target.closest('[data-pk]'); if(!b) return; const k=b.dataset.pk;
        if(k==='__none') return done('');
        if(k==='__new'){ const n=await promptBox('اسم الدرس الجديد','','مثلاً: حاسوب'); if(!n) return; return done(this.addSubject(n)); }
        done(k); }); }});
  },
  addSubject(n){ n=String(n).trim(); const ex=this.data.subjects.find(s=>s.name===n); if(ex) return ex.id;
    const ids=this.data.subjects.map(s=>+String(s.id).slice(1)||0), id='s'+(Math.max(0,...ids)+1); this.data.subjects.push({id,name:n}); this.persist(); return id; },
  addTeacher(){
    const i=$('#schTn'); if(!i) return; const n=i.value.trim(); if(!n){ i.focus(); return; }
    if(this.data.teachers.some(t=>t.name===n)){ toast('الاسم موجود مسبقاً',false); return; }
    const sv=$('#schTs').value; this.data.teachers.push({id:uid(),name:n,subj:sv||''}); this.persist(); this.render(); toast('تمت إضافة '+n);
    const n2=$('#schTn'); n2&&n2.focus();
  },
  async onClick(e){
    const D=this.data; if(!this.canEdit()) return;
    const cell=e.target.closest('[data-cell]');
    if(cell){ const [d,p]=cell.dataset.cell.split('-'), k=d+'-'+p; const v=await this.pickSubject(`${SCH_DAYS[d]} — الحصة ${nf(+p+1)}`,{cur:D.cells[k]||''});
      if(v===null) return; if(v==='') delete D.cells[k]; else D.cells[k]=v; this.persist(); this.render(); return; }
    const tm=e.target.closest('[data-time]'); if(tm){ const p=+tm.dataset.time; const v=await promptBox(`وقت الحصة ${nf(p+1)}`,schFmt(D.times[p]),'8:00 - 8:45'); if(v){ if(!schRange(v)){ toast('اكتب الوقت هيج: 8:00 - 8:45',false); return; } D.times[p]=v; this.persist(); this.render(); } return; }
    const bk=e.target.closest('[data-brk]'); if(bk){ const i=+bk.dataset.brk; const v=await promptBox(`وقت الاستراحة ${SCH_BRK_N[i]||nf(i+1)}`,schFmt(D.breaks[i]),'9:30 - 9:40'); if(v!==null){ if(!v.trim()){ D.breaks.splice(i,1); } else if(!schRange(v)){ toast('اكتب الوقت هيج: 9:30 - 9:40',false); return; } else D.breaks[i]=v; this.persist(); this.render(); } return; }
    const b=e.target.closest('[data-sch]');
    if(b){ const a=b.dataset.sch;
      if(a==='addS'){ const n=await promptBox('اسم الدرس الجديد','','مثلاً: حاسوب'); if(n){ this.addSubject(n); this.render(); } }
      if(a==='addT') this.addTeacher();
      if(a==='title'){ const n=await promptBox('اسم الجدول',D.title||S.cls||'',S.cls); if(n!==null){ D.title=n; this.persist(); this.render(); } }
      if(a==='reset'&&await confirmBox('الجدول الأصلي','راح يرجع الجدول والدروس لنسخة الثالث المتوسط -ج- الأصلية. أسماء المعلمين تبقى.','رجوع للأصلي',true,'restart')){ const f=this.fresh(); D.subjects=f.subjects; D.cells=f.cells; D.times=f.times; D.breaks=f.breaks; D.teachers.forEach(t=>t.subj=''); this.persist(); this.render(); toast('رجع الجدول الأصلي'); }
      return; }
    const sr=e.target.closest('[data-sren]'); if(sr){ const s=this.sub(sr.dataset.sren); const n=await promptBox('تعديل اسم الدرس',s.name); if(n){ s.name=n; this.persist(); this.render(); } return; }
    const sd=e.target.closest('[data-sdel]'); if(sd){ const s=this.sub(sd.dataset.sdel); if(await confirmBox('حذف درس',`تريد تحذف «${esc(s.name)}»؟ راح تنمسح من خانات الجدول.`,'حذف',true,'trash')){
      D.subjects=D.subjects.filter(x=>x!==s); for(const k of Object.keys(D.cells)) if(D.cells[k]===s.id) delete D.cells[k]; D.teachers.forEach(t=>{ if(t.subj===s.id) t.subj=''; }); this.persist(); this.render(); } return; }
    const tr=e.target.closest('[data-tren]'); if(tr){ const t=D.teachers.find(x=>x.id===tr.dataset.tren); const n=await promptBox('اسم المعلم',t.name); if(n){ t.name=n; this.persist(); this.render(); } return; }
    const ts=e.target.closest('[data-tsub]'); if(ts){ const t=D.teachers.find(x=>x.id===ts.dataset.tsub); const v=await this.pickSubject('مادة '+t.name,{cur:t.subj||''}); if(v!==null){ t.subj=v; this.persist(); this.render(); } return; }
    const td=e.target.closest('[data-tdel]'); if(td){ const t=D.teachers.find(x=>x.id===td.dataset.tdel); if(await confirmBox('حذف معلم',`تريد تحذف «${esc(t.name)}» من القائمة؟`,'حذف',true,'trash')){ D.teachers=D.teachers.filter(x=>x!==t); this.persist(); this.render(); } return; }
  }
};
onShow.sched=()=>Sched.render();
