/* =====================================================================
   3.0 — النظام: تشغيل/إطفاء كل ميزة، صحة الجهاز، سجل الأعطال، التحديث من
   فلاشة، وضع الصيانة، إحصائيات الاستخدام، دليل الاستخدام، ثيمات المناسبات،
   وضع العرض، إعادة ضبط المصنع، حساس الضوء، والكاميرا الثانية للصبورة.
   ===================================================================== */
ICONS.heart='<path d="M12 20s-7-4.4-9-9a5 5 0 0 1 9-3 5 5 0 0 1 9 3c-2 4.6-9 9-9 9z"/><path d="M3 12h4l2-3 3 6 2-3h7"/>';
ICONS.log='<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h6M9 9h1"/>';
ICONS.toggles='<rect x="2" y="5" width="20" height="6" rx="3"/><circle cx="17" cy="8" r="2" fill="currentColor"/><rect x="2" y="13" width="20" height="6" rx="3"/><circle cx="7" cy="16" r="2"/>';
ICONS.wrench='<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4z"/>';
ICONS.chart='<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>';
ICONS.book='<path d="M4 4h6a3 3 0 0 1 3 3v13a2.5 2.5 0 0 0-2.5-2.5H4z"/><path d="M20 4h-6a3 3 0 0 0-3 3v13a2.5 2.5 0 0 1 2.5-2.5H20z"/>';
ICONS.sparkle='<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/>';
ICONS.play2='<circle cx="12" cy="12" r="9"/><path d="m10 8 6 4-6 4z" fill="currentColor"/>';
ICONS.sun='<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>';
ICONS.factory='<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 8v4l3 2"/>';

/* ---------- تشغيل وإطفاء الميزات ---------- */
const FEATURES=[
  ['remote','ريموت المعلم','الريموت',true],
  ['autoPrep','الصبورة تحضّر الدرس من الجدول','الصف',true],['lastLesson','حفظ سبورة كل حصة (الحصة الأخيرة)','الصف',true],
  ['countdown','شريط العدّ التنازلي لنهاية الحصة','الصف',true],['endNotice','تنبيه قبل نهاية الحصة بـ ٥ دقائق','الصف',true],
  ['turn','ترتيب الدور','الصف',true],['homework','لوحة الواجبات','الصف',true],['rfid','بطاقات RFID للحضور','الصف',true],
  ['sticky','الملاحظات اللاصقة','السبورة',true],['curtain','الستارة (إخفاء وكشف)','السبورة',true],['magnify','المكبّر','السبورة',true],
  ['numline','مسطرة الأرقام ودوائر الكسور','السبورة',true],['symbols','الرموز الرياضية','السبورة',true],['cutpaste','القص واللصق','السبورة',true],
  ['campaste','لصق صورة من الكاميرا','السبورة',true],['split2','سبورة لطالبين','السبورة',true],
  ['usbUpdate','التحديث من فلاشة','النظام',true],['errlog','سجل الأعطال','النظام',true],['usage','إحصائيات الاستخدام','النظام',true],
  ['lightSensor','حساس الضوء (سطوع تلقائي)','الحساسات',false],['boardCam','الكاميرا تراقب الصبورة (ما تقفل وأحد يكتب)','الحساسات',false]
];
const Features={
  on(k){ const v=(S.feat||{})[k]; if(v!=null) return !!v; const f=FEATURES.find(x=>x[0]===k); return f?f[3]:true; },
  set(k,v){ S.feat=S.feat||{}; S.feat[k]=!!v; save(); Sys3.applyFeatures(k); },
  sec(){
    const groups=[...new Set(FEATURES.map(f=>f[2]))];
    return `<div class="card"><h3>${icon('toggles')}تشغيل وإطفاء الميزات</h3><p class="hint">إذا أي ميزة سببت مشكلة بالصف، اطفيها من هنا وباقي النظام يبقى شغال.</p></div>`+
      groups.map(g=>`<div class="card"><h3>${esc(g)}</h3>${FEATURES.filter(f=>f[2]===g).map(([k,n])=>`<div class="row"><label>${esc(n)}</label><label class="sw"><input type="checkbox" data-feat="${k}" ${this.on(k)?'checked':''}><span></span></label></div>`).join('')}</div>`).join('');
  }
};
window.Features=Features;

/* ---------- إحصائيات الاستخدام (على الجهاز فقط) ---------- */
const Usage={
  d:null,
  load(){ if(!this.d) this.d=store.get('usage',{days:{}}); return this.d; },
  hit(k,n=1){ if(!Features.on('usage')) return; const D=this.load(), day=dkey(tzNow()), o=D.days[day]||(D.days[day]={}); o[k]=(o[k]||0)+n; clearTimeout(this.t); this.t=setTimeout(()=>{ const keys=Object.keys(D.days).sort(); while(keys.length>60) delete D.days[keys.shift()]; store.set('usage',D); },2000); },
  NAMES:{home:'الشاشة الرئيسية','go:home':'الشاشة الرئيسية','go:board':'السبورة','go:pdf':'قارئ PDF','go:files':'الملفات','go:attend':'الحضور','go:sched':'الجدول','go:timer':'المؤقت','go:office':'المستندات','go:media':'الوسائط','go:settings':'الإعدادات','go:browser':'المتصفح','go:cast':'العرض اللاسلكي',
    pick:'القرعة',rfid:'بطاقات RFID','board:sticky':'الملاحظات اللاصقة','board:curtain':'الستارة','board:magnify':'المكبّر','board:numline':'مسطرة الأرقام','board:fraction':'الكسور','board:symbols':'الرموز','board:camera':'صورة الكاميرا','board:split':'سبورة لطالبين','board:paste':'اللصق'},
  sec(){
    const D=this.load(), days=Object.keys(D.days).sort().slice(-30), tot={}, mins={};
    for(const d of days) for(const [k,v] of Object.entries(D.days[d])){ if(k.startsWith('min:')) mins[k.slice(4)]=(mins[k.slice(4)]||0)+v; else tot[k]=(tot[k]||0)+v; }
    const top=Object.entries(tot).filter(([k])=>!k.startsWith('remote:')).sort((a,b)=>b[1]-a[1]).slice(0,10), mx=top.length?top[0][1]:1;
    const rem=Object.entries(tot).filter(([k])=>k.startsWith('remote:')).reduce((a,b)=>a+b[1],0);
    const tm=Object.entries(mins).sort((a,b)=>b[1]-a[1]).slice(0,6), mm=tm.length?tm[0][1]:1;
    const name=k=>this.NAMES[k]||this.NAMES['go:'+k]||TITLES[k]||k;
    return `<div class="card"><h3>${icon('chart')}إحصائيات الاستخدام — آخر ${nf(days.length)} يوم</h3>
      <p class="hint">تنحفظ بالجهاز بس، وتساعدك تعرف شنو المعلمين يستعملون أكثر حتى تطوّره. ${nf(rem)} أمر من الريموت.</p>
      ${top.length?`<div class="usage">${top.map(([k,v])=>`<div><span>${esc(name(k))}</span><i style="--w:${Math.max(4,v/mx*100)}%"></i><b>${nf(v)}</b></div>`).join('')}</div>`:'<p class="note">ماكو بيانات بعد.</p>'}</div>
      ${tm.length?`<div class="card"><h3>${icon('timer')}وقت الاستخدام (دقائق)</h3><div class="usage">${tm.map(([k,v])=>`<div><span>${esc(name(k))}</span><i style="--w:${Math.max(4,v/mm*100)}%"></i><b>${nf(Math.round(v))}</b></div>`).join('')}</div></div>`:''}
      <div class="btns"><button class="btn sm ghost danger" data-s3="usageClear">${icon('trash')}تصفير الإحصائيات</button></div>`;
  }
};
window.Usage=Usage;

const Sys3={
  health:null, logs:null, updDismiss:'', lux:null, motion:null,
  init(){
    window.Sys3=this;
    // أقسام جديدة بالإعدادات
    const nav=$('#setNav'), main=$('#setMain');
    const add=(sec,ic,txt,after)=>{ if($(`#setNav [data-sec=${sec}]`)) return; const ref=$(`#setNav [data-sec=${after}]`);
      const b=document.createElement('button'); b.className='nav-btn'; b.dataset.sec=sec; b.innerHTML=`${icon(ic)}<span class="txt">${txt}</span>`;
      ref?ref.after(b):nav.appendChild(b); const d=document.createElement('div'); d.className='sec'; d.dataset.sec=sec; d.hidden=true; main.appendChild(d); };
    add('remote','remote','الريموت','camera'); add('classroom','sparkle','الصف الذكي','remote'); add('features','toggles','تشغيل وإطفاء الميزات','classroom');
    add('health','heart','صحة الجهاز والأعطال','backup'); add('guide','book','دليل الاستخدام','health');
    for(const r of ['student']) if(ROLE_DEF[r].secs&&!ROLE_DEF[r].secs.includes('guide')) ROLE_DEF[r].secs.push('guide');
    const orig=showSec;
    showSec=function(sec){ orig(sec); Sys3.renderSec(sec); };
    main.addEventListener('change',e=>this.onChange(e)); main.addEventListener('click',e=>this.onClick(e));
    // تسجيل الأخطاء
    let n=0; setInterval(()=>n=0,60e3);
    const send=(msg)=>{ if(!Features.on('errlog')||!(window.Native&&Native.on)||++n>20) return; API.post('/api/log',{src:'ui',msg:String(msg).slice(0,1500)}).catch(()=>{}); };
    addEventListener('error',e=>send(`${e.message} @${(e.filename||'').split('/').pop()}:${e.lineno}`));
    addEventListener('unhandledrejection',e=>send('promise: '+(e.reason&&(e.reason.stack||e.reason.message)||e.reason)));
    // الاستخدام: فتح الشاشات ووقتها
    const og=go; let since=Date.now(), cur=current;
    go=function(id,arg){ const r=og(id,arg); if(id!==cur){ Usage.hit('min:'+cur,(Date.now()-since)/60e3); since=Date.now(); cur=id; Usage.hit('go:'+id); } return r; };
    const oe=Role.enter.bind(Role); Role.enter=function(k){ oe(k); Sys3.maintCheck(); };
    this.applyOccasion(); this.maintCheck();
    setInterval(()=>this.pollUsb(),20e3); setTimeout(()=>this.pollUsb(),8000);
    setInterval(()=>this.pollLight(),10e3); setInterval(()=>this.pollMotion(),3e3);
  },
  applyFeatures(k){ if(k==='remote'&&window.RemoteBridge) RemoteBridge.push(true); if(current==='settings') this.renderSec($('#setNav .on')&&$('#setNav .on').dataset.sec); },
  renderSec(sec){
    const el=$(`#setMain .sec[data-sec=${sec}]`); if(!el) return;
    if(sec==='remote') return RemoteBridge.renderSec();
    if(sec==='features'){ el.innerHTML=Features.sec(); paintIcons(el); $$('input[type=range]',el).forEach(setRangeFill); return; }
    if(sec==='classroom'){ el.innerHTML=this.classSec(); paintIcons(el); return; }
    if(sec==='health') return this.healthSec();
    if(sec==='guide'){ el.innerHTML=Guide.sec(); paintIcons(el); return; }
    if(sec==='backup') this.backupCards();
    if(sec==='look') this.lookCards();
  },
  /* ---------- الصف الذكي ---------- */
  classSec(){
    const L=Classroom.lessonInfo();
    return `<div class="card"><h3>${icon('sparkle')}الصف الذكي <span class="badge-exp">3.0</span></h3>
        <p class="hint">${L?`الحصة الحالية: <b>${esc(L.subj||'—')}</b> — الحصة ${nf(L.per+1)}`:'ماكو حصة هسة حسب الجدول.'}</p>
        <div class="row"><label>رجوع سبورة الحصة الأخيرة تلقائياً<span class="hint">بدل ما يسألك أول الحصة</span></label><label class="sw"><input type="checkbox" data-s3="autoResume" ${S.autoResume?'checked':''}><span></span></label></div>
        <div class="row"><label>تنبيه على السبورة نفسها قبل نهاية الحصة<span class="hint">الريموت ينبّه دائماً</span></label><label class="sw"><input type="checkbox" data-s3="lessonToast" ${S.lessonToast!==false?'checked':''}><span></span></label></div>
        <div class="row"><label>بطاقة RFID بعد هالدقائق من الحصة الأولى = متأخر<span class="hint">٠ = ما يسجّل تأخير</span></label><input type="number" class="field" style="width:90px" min="0" max="45" data-s3="rfidLateMin" value="${S.rfidLateMin||0}"></div>
        <div class="btns" style="margin-top:8px"><button class="btn sm" data-s3go="sched">${icon('table')}الجدول وملفات الدروس والواجبات</button><button class="btn sm" data-s3go="attend">${icon('card')}الطلاب والبطاقات</button></div></div>
      <div class="card"><h3>${icon('sun')}حساس الضوء ${Features.on('lightSensor')?'':'<span class="badge-exp">مطفي</span>'}</h3>
        <p class="hint">حساس BH1750 على منافذ I2C بالراسبيري (SDA=3، SCL=5، 3.3V، GND). يغيّر سطوع الواجهة حسب ضوء الصف.</p>
        <div class="row"><label>تشغيل حساس الضوء</label><label class="sw"><input type="checkbox" data-feat="lightSensor" ${Features.on('lightSensor')?'checked':''}><span></span></label></div>
        <div class="row"><span class="lbl">القراءة الحالية</span><b class="cam-st${this.lux!=null?' ok':''}">${this.lux!=null?nf(Math.round(this.lux))+' lux':'— ماكو حساس —'}</b></div></div>
      <div class="card"><h3>${icon('camera')}الكاميرا تراقب الصبورة ${Features.on('boardCam')?'':'<span class="badge-exp">مطفي</span>'}</h3>
        <p class="hint">إذا أكو حركة أمام الصبورة (أحد واكف يكتب بإيده) الشاشة ما تنقفل عليه. تستعمل الكاميرا المختارة من الإعدادات ← الكاميرا.</p>
        <div class="row"><label>تشغيل المراقبة</label><label class="sw"><input type="checkbox" data-feat="boardCam" ${Features.on('boardCam')?'checked':''}><span></span></label></div>
        <div class="row"><span class="lbl">الحركة الآن</span><b class="cam-st${this.motion!=null?' ok':''}">${this.motion!=null?nf(this.motion)+'٪':'—'}</b></div></div>`;
  },
  /* ---------- صحة الجهاز + سجل الأعطال + الصيانة + الإحصائيات ---------- */
  async healthSec(){
    const el=$('#setMain .sec[data-sec=health]'); if(!el) return;
    const maint=`<div class="card"><h3>${icon('wrench')}وضع الصيانة</h3><p class="hint">المطوّر بس يكدر يستعمل الجهاز، والباقين يشوفون «الجهاز تحت الصيانة».</p>
      <div class="row"><label>تشغيل وضع الصيانة</label><label class="sw"><input type="checkbox" data-s3="maint" ${S.maint?'checked':''} ${Role.is('dev')?'':'disabled'}><span></span></label></div>${Role.is('dev')?'':'<p class="note">يتشغّل من حساب المطوّر.</p>'}</div>`;
    if(!(window.Native&&Native.on)){ el.innerHTML=`<div class="card"><h3>${icon('heart')}صحة الجهاز</h3><div class="cam-note">${icon('info')}فحص الجهاز يشتغل على جهاز الصف نفسه.</div></div>`+maint+(Features.on('usage')?Usage.sec():''); paintIcons(el); return; }
    el.innerHTML=`<div class="card"><h3>${icon('heart')}صحة الجهاز</h3><div class="empty"><div class="spin"></div>جاري الفحص…</div></div>`;
    let h, lg={items:[]}; try{ h=await API.get('/api/health'); }catch(e){ h=null; }
    if(Features.on('errlog')) try{ lg=await API.get('/api/log?n=120'); }catch(e){}
    if(!$(`#setMain .sec[data-sec=health]`)||$(`#setMain .sec[data-sec=health]`).hidden) return;
    const gb=b=>fmtSize(b||0), T=h&&h.temp, th=h&&h.throttled||{};
    const items=h?[
      ['حرارة المعالج',T==null?'—':nf(Math.round(T))+'°',T==null?'':T>80?'bad':T>70?'warn':'ok'],
      ['الكهرباء',th.under_voltage_now?'ضعيفة الآن!':th.under_voltage_ever?'ضعفت قبل':'ممتازة',th.under_voltage_now?'bad':th.under_voltage_ever?'warn':'ok'],
      ['الذاكرة',h.mem?`${gb(h.mem.total-h.mem.avail)} من ${gb(h.mem.total)}`:'—',h.mem&&h.mem.avail/h.mem.total<.1?'warn':'ok'],
      ['التخزين',`${gb(h.disk.used)} من ${gb(h.disk.total)}`,h.disk.free/h.disk.total<.08?'bad':h.disk.free/h.disk.total<.15?'warn':'ok'],
      ['شغّال من',h.uptime>86400?nf(Math.floor(h.uptime/86400))+' يوم':nf(Math.floor(h.uptime/3600))+' ساعة','ok'],
      ['الواجهة',h.procs.host?'شغالة':'متوقفة',h.procs.host?'ok':'bad'],['الكتابة السريعة',h.procs.ink?'شغالة':'متوقفة',h.procs.ink?'ok':'warn'],
      ['الكيبورد',h.procs.osk?'شغال':'متوقف',h.procs.osk?'ok':'warn'],
      ['الريموت',`${nf(h.remote.online)} متصل من ${nf(h.remote.devices)}`,h.remote.on?'ok':'warn'],
      ['ساعة الوقت (DS1302)',h.rtc?(h.rtc.present?'موصولة ✓':'مو موصولة'):'—',h.rtc&&h.rtc.present?'ok':'warn'],
      ['الكاميرات',nf(h.cameras),'ok'],['فلاشات',nf(h.usb),'ok'],['أعطال آخر ٢٤ ساعة',nf(h.errors24h),h.errors24h>20?'warn':'ok']]:[];
    const bad=items.filter(i=>i[2]==='bad').length, warn=items.filter(i=>i[2]==='warn').length;
    el.innerHTML=`<div class="card"><h3>${icon('heart')}صحة الجهاز <span class="hstat ${bad?'bad':warn?'warn':'ok'}">${!h?'تعذر الفحص':bad?'يحتاج انتباه':warn?'ملاحظات بسيطة':'كل شي تمام'}</span><span class="end"><button class="btn sm ghost" data-s3="healthRe">${icon('restart')}فحص</button></span></h3>
        <div class="hgrid">${items.map(([n,v,c])=>`<div class="h-${c}"><small>${n}</small><b>${esc(v)}</b></div>`).join('')}</div>
        ${th.under_voltage_ever?`<p class="note">${icon('info')}الكهرباء ضعفت — استعمل شاحن الراسبيري الأصلي (5V 5A للـ Pi 5).</p>`:''}</div>
      ${Features.on('errlog')?`<div class="card"><h3>${icon('log')}سجل الأعطال (${nf(lg.items.length)})<span class="end btns"><button class="btn sm ghost" data-s3="logSave">${icon('save')}حفظ نسخة</button><button class="btn sm ghost danger" data-s3="logClear">${icon('trash')}مسح</button></span></h3>
        ${lg.items.length?`<div class="errlog">${lg.items.slice().reverse().map(x=>`<div><small dir="ltr">${esc(x.t)} · ${esc(x.src)}</small><span dir="ltr">${esc(x.msg)}</span></div>`).join('')}</div>`:'<p class="note">ماكو أعطال مسجلة 👌</p>'}
        <p class="hint">إذا أي برنامج وقف، النظام يرجّعه وحده خلال ثواني (الرجوع التلقائي)، وينكتب هنا.</p></div>`:''}`+maint+(Features.on('usage')?Usage.sec():'');
    paintIcons(el); this.logs=lg;
  },
  /* ---------- النسخ الاحتياطي: التحديث من فلاشة + ضبط المصنع ---------- */
  async backupCards(){
    const el=$('#setMain .sec[data-sec=backup]'); if(!el) return; $$('.s3card',el).forEach(c=>c.remove());
    let ups=[]; if(window.Native&&Native.on&&Features.on('usbUpdate')) try{ ups=(await API.get('/api/usbupdate')).items; }catch(e){}
    el.insertAdjacentHTML('beforeend',`${Features.on('usbUpdate')?`<div class="card s3card"><h3>${icon('usb')}التحديث من فلاشة</h3>
        <p class="hint">إذا ماكو إنترنت بالمدرسة: حط ملف <b dir="ltr">alharthia-os-….zip</b> بجذر فلاشة واشبكها — النظام يلگاه وحده.</p>
        ${ups.length?ups.map(u=>`<div class="row"><b style="flex:1" dir="ltr">${esc(u.name)}</b><span class="hint">${esc(u.usb)} · ${fmtSize(u.size)}</span><button class="btn sm primary" data-upd="${esc(u.path)}">${icon('download')}تحديث</button></div>`).join(''):'<p class="note">ماكو ملف تحديث على الفلاشات المشبوكة.</p>'}</div>`:''}
      <div class="card s3card"><h3>${icon('factory')}إعادة ضبط المصنع</h3>
        <p class="hint">يرجّع النظام مثل أول تشغيل: الإعدادات، الطلاب والحضور، الجدول، السبورات المحفوظة بالواجهة، الريموتات والمهام. <b>ملفاتك بالمستندات والفلاشات تبقى.</b> يحتاج كلمة مرور النظام (OS_PASSWORD).</p>
        <div class="btns"><button class="btn danger" data-s3="factory" ${Role.is('student')?'disabled':''}>${icon('factory')}إعادة ضبط المصنع</button></div></div>`);
    paintIcons(el);
  },
  async factory(){
    if(!(window.Native&&Native.on)){ toast('تشتغل على جهاز الصف نفسه',false); return; }
    const pw=await modal({title:'إعادة ضبط المصنع',iconName:'factory',body:`<p>راح ينمسح كل شي بالواجهة (الطلاب، الحضور، الجدول، الإعدادات، السبورات المحفوظة بالواجهة، الريموتات والمهام). الملفات الشخصية تبقى.</p>
      <p><b>اكتب كلمة مرور النظام (OS_PASSWORD) حتى تأكد:</b></p><input class="field" type="password" id="frPw" placeholder="كلمة مرور النظام" autocomplete="off">`,
      actions:[{label:'إلغاء',val:null,cls:'ghost'},{label:'مسح كل شي',val:ov=>$('#frPw',ov).value,cls:'danger fill'}],onOpen:ov=>setTimeout(()=>$('#frPw',ov).focus(),60)});
    if(!pw) return;
    try{ const r=await API.post('/api/checkpw',{pw}); if(!r.ok){ toast('كلمة مرور النظام غلط',false); beep(2,220); return; }
      await API.post('/api/factory',{pw});
      for(let i=localStorage.length-1;i>=0;i--){ const k=localStorage.key(i); if(k&&k.startsWith('alharthia.')) localStorage.removeItem(k); }
      toast('تمت إعادة ضبط المصنع — جاري إعادة التشغيل…'); setTimeout(()=>location.reload(),1500);
    }catch(e){ toast(errMsg(e),false); }
  },
  /* ---------- التحديث من فلاشة ---------- */
  async pollUsb(){
    if(!(window.Native&&Native.on)||!Features.on('usbUpdate')||Role.is('student')) return;
    let r; try{ r=await API.get('/api/usbupdate'); }catch(e){ return; }
    const u=r.items[0]; if(!u||this.updDismiss===u.path+u.mtime||this.updating) return;
    this.updDismiss=u.path+u.mtime;
    const ok=await confirmBox('تحديث على الفلاشة',`لگيت ملف تحديث <b dir="ltr">${esc(u.name)}</b> على «${esc(u.usb)}». تحدّث النظام هسة؟ (ياخذ دقائق وبعدها تعيد التشغيل)`,'تحديث','','usb');
    if(ok) this.applyUpdate(u.path);
  },
  async applyUpdate(path){
    this.updating=true; let pr=0;
    const m=modal({title:'جاري التحديث…',iconName:'usb',body:`<div class="bar" style="height:12px"><i id="updBar" style="width:2%"></i></div><p class="hint" id="updMsg">لا تسحب الفلاشة ولا تطفي الجهاز.</p>`,actions:[]});
    try{ const j=await API.post('/api/usbupdate',{path}); await Native.job(j,p=>{ pr=p; const b=$('#updBar'); if(b) b.style.width=Math.round(p*100)+'%'; });
      $$('#modalHost .overlay').forEach(o=>o.remove()); const again=await confirmBox('تم التحديث ✓','لازم إعادة تشغيل الجهاز حتى تشتغل كل الميزات الجديدة.','إعادة التشغيل','','restart');
      if(again) API.post('/api/power',{action:'reboot'}).catch(()=>{});
    }catch(e){ $$('#modalHost .overlay').forEach(o=>o.remove()); toast('فشل التحديث: '+errMsg(e),false); }
    this.updating=false;
  },
  /* ---------- حساس الضوء + الكاميرا ---------- */
  async pollLight(){
    if(!Features.on('lightSensor')||!(window.Native&&Native.on)) return;
    try{ const r=await API.get('/api/light'); this.lux=r.lux; if(r.lux==null) return;
      const target=clamp(Math.round(35+Math.log10(1+r.lux)/Math.log10(1001)*65),35,100);
      S.bright=Math.round(S.bright+(target-S.bright)*.35); applyBright(); save(); if(current==='settings'&&!$('#setMain .sec[data-sec=classroom]').hidden) this.renderSec('classroom');
    }catch(e){}
  },
  async pollMotion(){
    if(!Features.on('boardCam')||!(window.Native&&Native.on)) return;
    try{ const r=await API.get('/api/motion'); this.motion=r.level; if(r.level!=null&&r.level>.6&&$('#lock').hidden) lastAct=Date.now(); }catch(e){}
  },
  /* ---------- وضع الصيانة ---------- */
  maintCheck(){
    let el=$('#maint'); const on=!!S.maint&&!Role.is('dev');
    if(!on){ if(el) el.hidden=true; return; }
    if(!el){ el=document.createElement('div'); el.id='maint'; document.body.appendChild(el); el.addEventListener('click',e=>{ if(e.target.closest('[data-mt]')) Role.ask(); }); }
    el.innerHTML=`<div>${icon('wrench')}<h1>الجهاز تحت الصيانة</h1><p>راح يرجع يشتغل قريباً.</p><button class="btn" data-mt="1">${icon('users')}دخول المطوّر</button></div>`; el.hidden=false;
  },
  /* ---------- ثيمات المناسبات ---------- */
  OCC:{none:['بدون',''],ramadan:['رمضان','رمضان كريم'],eid:['العيد','عيدكم مبارك'],flag:['يوم العلم','يوم العلم العراقي'],school:['العودة للمدارس','أهلاً بالعودة للمدارس'],student:['يوم الطالب','كل عام وطلابنا بخير — يوم الطالب']},
  lookCards(){
    const el=$('#setMain .sec[data-sec=look]'); if(!el) return; $$('.s3card',el).forEach(c=>c.remove());
    el.insertAdjacentHTML('beforeend',`<div class="card s3card"><h3>${icon('sparkle')}ثيم المناسبة</h3><p class="hint">زينة وتهنئة بالشاشة الرئيسية حسب المناسبة.</p>
      <div class="chips">${Object.entries(this.OCC).map(([k,[n]])=>`<button class="chip${(S.occasion||'none')===k?' on':''}" data-occ="${k}">${n}</button>`).join('')}</div>
      <div class="row" style="margin-top:8px"><label>نص التهنئة (اختياري)</label><input class="field" data-s3="occText" value="${esc(S.occText||'')}" placeholder="${esc((this.OCC[S.occasion||'none']||['',''])[1])}"></div></div>`);
    paintIcons(el);
  },
  applyOccasion(){
    const k=S.occasion||'none'; document.documentElement.dataset.occ=k;
    let el=$('#occBanner'); if(k==='none'){ if(el) el.hidden=true; return; }
    if(!el){ el=document.createElement('div'); el.id='occBanner'; const h=$('#home'); (h||document.body).appendChild(el); }
    const deco={ramadan:'<svg viewBox="0 0 60 60"><path d="M38 8a22 22 0 1 0 14 34A18 18 0 1 1 38 8z" fill="#fde68a"/><circle cx="46" cy="16" r="2.5" fill="#fde68a"/></svg>',
      eid:'<svg viewBox="0 0 60 60"><path d="m30 6 5 13 14 1-11 9 4 14-12-8-12 8 4-14-11-9 14-1z" fill="#fde68a"/></svg>',
      flag:'<svg viewBox="0 0 60 40"><rect width="60" height="13.3" fill="#ce1126"/><rect y="13.3" width="60" height="13.4" fill="#fff"/><rect y="26.7" width="60" height="13.3" fill="#111"/></svg>',
      school:'<svg viewBox="0 0 60 60"><path d="M30 12 4 24l26 12 26-12z" fill="#fde68a"/><path d="M14 30v12c8 6 24 6 32 0V30" fill="none" stroke="#fde68a" stroke-width="4"/></svg>',
      student:'<svg viewBox="0 0 60 60"><path d="M30 12 4 24l26 12 26-12z" fill="#fde68a"/><path d="M50 26v14" stroke="#fde68a" stroke-width="3"/><circle cx="50" cy="42" r="3" fill="#fde68a"/></svg>'}[k]||'';
    el.innerHTML=`${deco}<b>${esc(S.occText||this.OCC[k][1])}</b>${deco}`; el.hidden=false;
  },
  /* ---------- الأحداث ---------- */
  async onChange(e){
    const f=e.target.closest('[data-feat]'); if(f){ Features.set(f.dataset.feat,f.checked); return; }
    const t=e.target.closest('[data-s3]'); if(!t) return; const k=t.dataset.s3;
    if(k==='autoResume'||k==='lessonToast'){ S[k]=t.checked; save(); }
    if(k==='rfidLateMin'){ S.rfidLateMin=clamp(+t.value||0,0,45); save(); }
    if(k==='maint'){ S.maint=t.checked; save(); this.maintCheck(); toast(t.checked?'وضع الصيانة شغال — بس المطوّر يستعمل الجهاز':'انطفى وضع الصيانة'); }
    if(k==='occText'){ S.occText=t.value.trim(); save(); this.applyOccasion(); }
  },
  async onClick(e){
    const o=e.target.closest('[data-occ]'); if(o){ S.occasion=o.dataset.occ; save(); this.applyOccasion(); this.lookCards(); return; }
    const u=e.target.closest('[data-upd]'); if(u){ if(await confirmBox('تحديث من الفلاشة','تحدّث النظام هسة؟','تحديث','','usb')) this.applyUpdate(u.dataset.upd); return; }
    const g=e.target.closest('[data-s3go]'); if(g){ go(g.dataset.s3go); return; }
    const gd=e.target.closest('[data-guide]'); if(gd){ Guide.go(gd.dataset.guide); return; }
    const b=e.target.closest('button[data-s3]'); if(!b) return; const a=b.dataset.s3;
    if(a==='healthRe') this.healthSec();
    if(a==='logClear'&&await confirmBox('مسح السجل','تريد تمسح سجل الأعطال؟','مسح',true,'trash')){ await API.post('/api/log/clear',{}); this.healthSec(); }
    if(a==='logSave'&&this.logs){ const txt=this.logs.items.map(x=>`${x.t}\t${x.src}\t${x.msg}`).join('\n'); const blob=new Blob([txt],{type:'text/plain'});
      FS.add('docs',{name:FS.uniqueName(FS.find('docs'),`سجل الأعطال ${dkey(tzNow())}.txt`),type:'txt',size:blob.size,blob}); toast('انحفظ بالمستندات'); }
    if(a==='usageClear'&&await confirmBox('تصفير الإحصائيات','تريد تمسح إحصائيات الاستخدام؟','تصفير',true,'trash')){ Usage.d={days:{}}; store.set('usage',Usage.d); this.healthSec(); }
    if(a==='factory') this.factory();
  }
};

/* ---------- دليل الاستخدام + وضع العرض ---------- */
const Guide={
  ITEMS:[
    ['remote','remote','ريموت المعلم','الإعدادات ← الريموت ← «ربط ريموت جديد»، واكتب الرمز بالريموت. منه: القرعة، الصفحات، الملفات، القفل، تبديل المستخدم، الكتابة والمؤشر، ومهامك.','settings:remote'],
    ['lesson','sparkle','الصبورة تحضّر الدرس','من شاشة الجدول اضغط 📎 جنب أي درس وأضف ملفاته. أول الحصة يطلع شريط: «كمّل من الحصة الأخيرة» و«ملفات الدرس». وشريط رفيع فوك يعدّ وقت الحصة.','sched'],
    ['tools','tools','أدوات الصف بالسبورة','زر «أدوات الصف» بشريط السبورة: ملاحظة لاصقة، ستارة، مكبّر، مسطرة أرقام، كسور، رموز رياضية، صورة من الكاميرا، سبورة لطالبين، ولصق.','board'],
    ['cut','scissors','قص ونسخ ولصق','حدّد العناصر بأداة «تحديد» ← «قص» أو «نسخ»، روح لأي صفحة وافتح «أدوات الصف» ← «لصق». (أو Ctrl+X / C / V)','board'],
    ['turn','queue','ترتيب الدور','الحضور ← «ترتيب الدور»: حسب القائمة أو عشوائي، و«التالي» ينقل للي بعده. الغايبين ما يدخلون.','attend'],
    ['rfid','card','بطاقات الطلاب RFID','اشبك قارئ RFID بـ USB. الحضور ← الطلاب ← «تعريف كل البطاقات». بعدها كل طالب يمرر بطاقته ويتسجل حاضر.','attend'],
    ['hw','homework','لوحة الواجبات','شاشة الجدول ← «واجب»، و«عرض كبير» حتى الطلاب ينقلونه.','sched'],
    ['health','heart','صحة الجهاز والأعطال','الإعدادات ← صحة الجهاز: الحرارة والكهرباء والتخزين، وسجل الأعطال. أي برنامج يوقف يرجع وحده.','settings:health'],
    ['usb','usb','التحديث بفلاشة','حط ملف alharthia-os-….zip بالفلاشة واشبكها — يطلعلك «تحديث».','settings:backup'],
    ['feat','toggles','تشغيل وإطفاء الميزات','الإعدادات ← تشغيل وإطفاء الميزات: أي ميزة تزعجك اطفيها.','settings:features']
  ],
  sec(){
    return `<div class="card"><h3>${icon('book')}دليل الاستخدام — AlharthiaOS ${OS_VERSION}</h3><p class="hint">شرح قصير لكل ميزة، وزر «جرّبها» يوديك لمكانها.</p>
      <div class="btns"><button class="btn primary" data-guide="__demo">${icon('play2')}وضع العرض (جولة تلقائية)</button></div></div>
      <div class="guide">${this.ITEMS.map(([k,i,t,d,to])=>`<div class="card g-item"><h3>${icon(i)}${t}</h3><p>${d}</p><button class="btn sm" data-guide="${to}">${icon('chevL')}جرّبها</button></div>`).join('')}</div>`;
  },
  go(to){ if(to==='__demo') return Demo.start(); const [a,b]=to.split(':'); if(a==='settings') go('settings',b); else go(a); },
};
const Demo={
  on:false, i:0,
  STEPS:[['home','AlharthiaOS 3.0 — نظام الصف التفاعلي'],['board','السبورة الذكية — أقلام، أشكال، أدوات هندسية، وأدوات الصف'],['sched','الجدول يعرف الحصة: يحضّر الدرس ويعدّ الوقت'],
    ['attend','الحضور بالبطاقات، القرعة بدون تكرار، وترتيب الدور'],['timer','المؤقت للأنشطة'],['settings:remote','ريموت المعلم اللاسلكي'],['settings:health','صحة الجهاز والرجوع التلقائي'],['home','المس الشاشة حتى توقف العرض']],
  start(){
    this.on=true; this.i=0; let el=$('#demoCap'); if(!el){ el=document.createElement('div'); el.id='demoCap'; document.body.appendChild(el); }
    el.hidden=false; this.step(); this.iv=setInterval(()=>this.step(),6500);
    setTimeout(()=>addEventListener('pointerdown',this.stopH=()=>this.stop(),{once:true,capture:true}),400);
  },
  step(){ const [scr,cap]=this.STEPS[this.i++%this.STEPS.length]; const [a,b]=scr.split(':'); try{ if(a==='settings') go('settings',b); else go(a); }catch(e){}
    const el=$('#demoCap'); el.innerHTML=`<span class="dc-badge">وضع العرض</span><b>${esc(cap)}</b>`; },
  stop(){ this.on=false; clearInterval(this.iv); const el=$('#demoCap'); if(el) el.hidden=true; toast('توقف وضع العرض'); }
};
