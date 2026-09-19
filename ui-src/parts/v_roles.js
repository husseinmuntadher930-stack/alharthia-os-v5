
/* =====================================================================
   المستخدمون: الطالب / الأستاذ / المطوّر
   شاشة «مرحباً — منو يستخدم النظام؟» تطلع بكل إقلاع، وكل واجهة إلها صلاحياتها.
   ملاحظة مهمة: هذا حاجز صف، مو حماية أمنية. من يوصل للتيرمنال أو SSH يتخطاه.
   ===================================================================== */
ICONS.users='<circle cx="9" cy="8" r="3.2"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><circle cx="17.5" cy="9" r="2.4"/><path d="M15.6 15.6A5.4 5.4 0 0 1 22 20"/>';
ICONS.swap='<path d="M7 4 3 8l4 4"/><path d="M3 8h12a4 4 0 0 1 4 4"/><path d="m17 20 4-4-4-4"/><path d="M21 16H9a4 4 0 0 1-4-4"/>';
ICONS.key='<circle cx="8" cy="15" r="4"/><path d="m10.9 12.1 8.1-8.1"/><path d="m16 7 2.5 2.5"/><path d="m13.5 9.5 2.5 2.5"/>';

const ROLE_DEF={
  student:{n:'الطالب', c:'#0d9488', c2:'#5eead4', pw:false,
    /* قائمة مسموح بيها — أي شي مو مكتوب هنا مقفل */
    apps:['board','pdf','files','word','ppt','excel','media','timer','settings'],
    screens:['home','apps','board','pdf','files','office','media','timer','settings','gen'],
    secs:['look','gallery','access'],
    side:['files','board','shot','annot','close'],
    note:'بدون إنترنت ولا تيرمنال ولا متجر، والإعدادات مظهر فقط'},
  teacher:{n:'الأستاذ', c:'#9f1239', c2:'#fda4af', pw:true,
    denyApps:['terminal'], denyScreens:['term'],
    note:'كل شي مثل النظام الكامل، بدون التيرمنال'},
  dev:{n:'المطوّر', c:'#1d4ed8', c2:'#93c5fd', pw:true,
    note:'كل شي بدون أي قيد'},
};
const ROLE_ORDER=['student','teacher','dev'];

/* الصورة: خلفية غامجة منقّطة ودائرة بلون الدور وجواها شخص — نفس ستايل الصور */
function roleArt(k){
  const d=ROLE_DEF[k], id='rp'+k;
  return `<svg class="rc-art" viewBox="0 0 160 100" aria-hidden="true">
    <defs><pattern id="${id}" width="7" height="7" patternUnits="userSpaceOnUse">
      <circle cx="1.6" cy="1.6" r="1" fill="#fff" opacity=".08"/></pattern></defs>
    <rect width="160" height="100" fill="#0e1116"/><rect width="160" height="100" fill="url(#${id})"/>
    <circle cx="80" cy="50" r="30" fill="${d.c}"/>
    <g fill="${d.c2}"><circle cx="80" cy="42.5" r="9"/>
      <path d="M80 54.5c-9.2 0-16.6 6.2-18 14h36c-1.4-7.8-8.8-14-18-14Z"/></g></svg>`;
}

/* تجزئة كلمة المرور — ما نخزنها نص صريح */
async function pwHash(v){
  const t='alharthia:'+v;
  try{
    const b=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(t));
    return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('');
  }catch(e){
    let h=5381; for(let i=0;i<t.length;i++) h=((h<<5)+h+t.charCodeAt(i))|0;
    return 'x'+(h>>>0).toString(16);
  }
}

function pwPrompt(title,ph='كلمة المرور'){
  return modal({title,iconName:'key',body:`<input class="field" id="pwIn" type="password" placeholder="${esc(ph)}" autocomplete="off">`,
    actions:[{label:'إلغاء',val:null,cls:'ghost'},{label:'حفظ',val:ov=>$('#pwIn',ov).value||null,cls:'primary'}],
    onOpen:(ov,done)=>{ const i=$('#pwIn',ov); i.focus();
      if(S.osk&&typeof Keyboard!=='undefined'&&Keyboard.show){ Keyboard.target=i; Keyboard.show(); }
      i.addEventListener('keydown',e=>{ if(e.key==='Enter') done(i.value||null); }); }});
}

const Role={
  cur:'dev', asking:false, pwRole:null,
  def(){ return ROLE_DEF[this.cur]||ROLE_DEF.dev; },
  is(k){ return this.cur===k; },
  pwOf(k){ const r=(S.rolePw||{})[k]; return r&&r.on&&r.h?r:null; },

  canApp(id){ const d=this.def(); if(d.apps) return d.apps.includes(id); return !(d.denyApps||[]).includes(id); },
  canScreen(id){ const d=this.def(); if(d.screens) return d.screens.includes(id); return !(d.denyScreens||[]).includes(id); },
  canSec(id){ const d=this.def(); return d.secs?d.secs.includes(id):true; },

  /* ---------- شاشة الاختيار ---------- */
  ask(){
    if(this.asking) return; this.asking=true; this.pwRole=null;
    const el=$('#welcome'); el.hidden=false;
    document.documentElement.classList.add('gated');
    this.renderPick();
  },
  renderPick(){
    $('#welcome').innerHTML=`<div class="wl-box">
      <div class="wl-hd"><h1>مرحباً</h1><p>منو يستخدم النظام؟</p></div>
      <div class="wl-cards">${ROLE_ORDER.map(k=>{ const d=ROLE_DEF[k], lk=!!this.pwOf(k);
        return `<button class="rcard" data-role="${k}" style="--rc:${d.c}">
          ${roleArt(k)}<span class="rc-nm">${d.n}${lk?`<span class="rc-lock" title="محمية بكلمة مرور">${icon('lock')}</span>`:''}</span>
          <span class="rc-note">${d.note}</span></button>`; }).join('')}</div>
      <p class="wl-foot">${icon('info')} تكدر تبدّل المستخدم بأي وقت من القائمة الجانبية.</p></div>`;
    paintIcons($('#welcome'));
  },
  renderPw(k){
    this.pwRole=k;
    const d=ROLE_DEF[k];
    $('#welcome').innerHTML=`<div class="wl-box">
      <div class="wl-hd"><h1>${d.n}</h1><p>اكتب كلمة المرور</p></div>
      <div class="wl-pw" style="--rc:${d.c}">${roleArt(k)}
        <input id="wlPw" type="password" class="field" placeholder="كلمة المرور" autocomplete="off" inputmode="text">
        <div class="wl-err" id="wlErr" hidden></div>
        <div class="btns"><button class="btn ghost" data-wl="back">${icon('chevR')}رجوع</button>
          <button class="btn primary" data-wl="ok">${icon('check')}دخول</button></div></div></div>`;
    paintIcons($('#welcome'));
    const i=$('#wlPw'); i.focus();
    i.onkeydown=e=>{ if(e.key==='Enter') this.tryPw(k); };
    if(S.osk&&typeof Keyboard!=='undefined'&&Keyboard.show){ Keyboard.target=i; Keyboard.show(); }
  },
  async tryPw(k){
    const i=$('#wlPw'), er=$('#wlErr'); if(!i) return;
    const h=await pwHash(i.value||'');
    if(h===S.rolePw[k].h){ this.enter(k); return; }
    er.hidden=false; er.textContent='كلمة المرور غلط'; i.value=''; i.focus(); beep(2,220);
  },
  enter(k){
    this.cur=k; store.set('role',k);
    this.asking=false;
    if(typeof Keyboard!=='undefined'&&Keyboard.hide) Keyboard.hide();
    $('#welcome').hidden=true; $('#welcome').innerHTML='';
    document.documentElement.classList.remove('gated');
    this.apply();
    toast('أهلاً — واجهة '+ROLE_DEF[k].n);
  },
  /* أزرار تودّي لقسم مقفل: ما ننطيها تطلع أصلاً بدل ما تنضغط وتطلع رسالة منع */
  sweep(root=document){
    if(!this.def().apps&&!(this.def().denyScreens||[]).length) return;   // المطوّر: ماكو شي ينخفي
    for(const b of $$('[data-go]',root)){
      const id=b.dataset.go, sec=b.dataset.sec||b.dataset.arg;
      const bad=!this.canScreen(id)||(id==='settings'&&sec&&!this.canSec(sec));
      if(b.hidden!==bad) b.hidden=bad;
    }
    for(const b of $$('[data-app]',root)) { const bad=!this.canApp(b.dataset.app); if(b.hidden!==bad) b.hidden=bad; }
  },
  watch(){
    if(this._ob) return;
    let t=0;
    this._ob=new MutationObserver(()=>{ cancelAnimationFrame(t); t=requestAnimationFrame(()=>this.sweep()); });
    this._ob.observe($('#os'),{childList:true,subtree:true});
  },

  /* ---------- تطبيق الصلاحيات ---------- */
  apply(){
    const d=this.def();
    document.documentElement.dataset.user=this.cur;   // مو data-role: closest() كان يلگيها ويبلع النقرات
    // نخبر النظام حتى يمنع التشغيل فعلياً مو بس يخفي الأزرار
    if(typeof Native!=='undefined'&&Native.on) API.post('/api/role',{role:this.cur}).catch(()=>{});
    // قائمة الإعدادات
    $$('#setNav .nav-btn').forEach(b=>{ b.hidden=!this.canSec(b.dataset.sec); });
    const shown=$$('#setNav .nav-btn').filter(b=>!b.hidden);
    if(current==='settings'){
      const on=$('#setNav .nav-btn.on');
      if((!on||on.hidden)&&shown[0]) showSec(shown[0].dataset.sec);
    }
    // لو المستخدم كان بشاشة ممنوعة
    if(!this.canScreen(current)) go('home');
    renderDock(); if(current==='apps') Apps.render();
    if(typeof Side!=='undefined'&&Side.open) Side.show(Side.side);
    this.sweep(); this.watch();
  },
  /* ---------- الربط ---------- */
  init(){
    if(!S.rolePw) S.rolePw={};
    for(const k of ['teacher','dev']) if(!S.rolePw[k]) S.rolePw[k]={on:false,h:''};
    // شاشة الاختيار
    const el=document.createElement('div'); el.id='welcome'; el.hidden=true;
    document.body.appendChild(el);
    el.addEventListener('click',async e=>{
      const r=e.target.closest('#welcome [data-role]');
      if(r){ const k=r.dataset.role; if(this.pwOf(k)) this.renderPw(k); else this.enter(k); return; }
      const b=e.target.closest('[data-wl]'); if(!b) return;
      if(b.dataset.wl==='back'){ if(typeof Keyboard!=='undefined'&&Keyboard.hide) Keyboard.hide(); this.renderPick(); }
      if(b.dataset.wl==='ok'&&this.pwRole) await this.tryPw(this.pwRole);
    });

    // منع الانتقال للشاشات المقفلة
    const baseGo=go;
    go=(id,arg)=>{ if(!Role.canScreen(id)){ toast('هذا القسم مو متاح بواجهة '+Role.def().n,false); return; } return baseGo(id,arg); };
    // منع تشغيل البرامج المقفلة
    if(typeof Apps!=='undefined'&&Apps.launch){
      const baseLaunch=Apps.launch.bind(Apps);
      Apps.launch=id=>{ if(!Role.canApp(id)){ toast('هذا البرنامج مو متاح بواجهة '+Role.def().n,false); return; } return baseLaunch(id); };
    }
    // إخفاء التطبيقات المقفلة من الشاشة الرئيسية وقائمة التطبيقات
    const baseDock=renderDock;
    renderDock=function(){ const keep=S.dock; S.dock=keep.filter(id=>Role.canApp(id)); baseDock(); S.dock=keep; };
    const baseApps=Apps.render.bind(Apps);
    Apps.render=function(){ const all=APPS_BUILTIN.slice();
      APPS_BUILTIN.length=0; APPS_BUILTIN.push(...all.filter(a=>Role.canApp(a.id)));
      try{ baseApps(); } finally{ APPS_BUILTIN.length=0; APPS_BUILTIN.push(...all); } };
    // قائمة الإعدادات
    const baseShow=showSec;
    showSec=function(sec){ if(!Role.canSec(sec)){ const f=$$('#setNav .nav-btn').find(b=>Role.canSec(b.dataset.sec)); sec=f?f.dataset.sec:sec; } return baseShow(sec); };
    // القائمة الجانبية: تبقى للكل، بس بدون الأزرار الي توديك لقسم مقفل
    if(typeof Side!=='undefined'&&Side.mainTools){
      const baseTools=Side.mainTools.bind(Side);
      Side.mainTools=function(){ const d=Role.def();
        let list=baseTools().filter(b=>b===null||!d.side||d.side.includes(b.k));
        list=list.filter(b=>b===null||b.k!=='switch');
        const i=list.findIndex(b=>b&&b.k==='close');
        list.splice(i<0?list.length:i,0,{k:'switch',t:'تبديل المستخدم',i:'swap'});
        // ما نخلي فاصلين ورا بعض
        return list.filter((b,ix)=>!(b===null&&list[ix-1]===null));
      };
      const baseClick=Side.onClick.bind(Side);
      Side.onClick=function(e){ const b=e.target.closest('[data-sb]');
        if(b&&b.dataset.sb==='switch'){ this.hide(); Annot.exit(); Role.ask(); return; }
        return baseClick(e); };
    }
  },
};

/* ---------- الإعدادات ← المستخدمون ---------- */
Extra.secs.users=function(){
  const mine=Role.cur, d=ROLE_DEF[mine];
  if(mine==='student') return `<h1 class="h1">المستخدمون</h1><p class="sub">واجهة الطالب بدون كلمة مرور.</p>`;
  // المطوّر يدير الاثنين، الأستاذ يدير واجهته بس
  const list=mine==='dev'?['dev','teacher']:['teacher'];
  const card=k=>{ const r=S.rolePw[k], on=!!(r&&r.on&&r.h), rd=ROLE_DEF[k];
    return `<div class="card"><h3 style="--c:${rd.c}">${icon('key')}كلمة مرور واجهة ${rd.n}</h3>
      <div class="row"><label for="pw_${k}">تفعيل كلمة المرور
        <span class="hint">${on?'شغّالة — تنطلب كل ما تدخل هذه الواجهة':'مطفية — الدخول مباشرة بدون كلمة مرور'}</span></label>
        <label class="sw"><input type="checkbox" id="pw_${k}" data-rpw="on" data-k="${k}" ${on?'checked':''}><span></span></label></div>
      <div class="btns" style="margin-top:12px">
        <button class="btn" data-rpw="set" data-k="${k}">${icon('edit')}${on?'تغيير كلمة المرور':'وضع كلمة مرور'}</button>
        ${on?`<button class="btn danger" data-rpw="clear" data-k="${k}">${icon('trash')}إلغاء كلمة المرور</button>`:''}</div></div>`;
  };
  return `<h1 class="h1">المستخدمون</h1>
    <p class="sub">إنت داخل بواجهة <b>${d.n}</b>. ${d.note}.</p>
    ${list.map(card).join('')}
    <div class="card"><h3>${icon('swap')}تبديل المستخدم</h3>
      <p class="hint">ترجع لشاشة «منو يستخدم النظام؟» بدون إعادة تشغيل. وهي تطلع لحالها بكل إقلاع.</p>
      <div class="btns" style="margin-top:12px"><button class="btn primary" data-rpw="switch">${icon('swap')}تبديل المستخدم</button></div></div>
    <div class="card"><p class="hint">${icon('info')} كلمة المرور حاجز صف حتى ما يعبث الطلاب بالإعدادات — مو حماية أمنية.
      من عنده وصول للتيرمنال أو SSH على الجهاز يكدر يتخطاها.</p></div>`;
};

document.addEventListener('click',async e=>{
  const b=e.target.closest('[data-rpw]'); if(!b) return;
  const a=b.dataset.rpw, k=b.dataset.k;
  if(a==='switch'){ Role.ask(); return; }
  if(a==='clear'){
    if(await confirmBox('إلغاء كلمة المرور','واجهة '+ROLE_DEF[k].n+' راح تنفتح بدون كلمة مرور.','إلغاء الكلمة',true,'trash')){
      S.rolePw[k]={on:false,h:''}; save(); Extra.renderSec('users'); toast('تم إلغاء كلمة المرور'); }
    return;
  }
  if(a==='set'||a==='on'){
    if(a==='on'&&!b.checked){ S.rolePw[k].on=false; save(); Extra.renderSec('users'); toast('تم إيقاف كلمة المرور'); return; }
    const v=await pwPrompt('كلمة مرور واجهة '+ROLE_DEF[k].n);
    if(!v){ Extra.renderSec('users'); return; }
    const v2=await pwPrompt('أعد كتابة كلمة المرور');
    if(v2!==v){ toast('الكلمتين مو نفسها',false); Extra.renderSec('users'); return; }
    S.rolePw[k]={on:true,h:await pwHash(v)}; save(); Extra.renderSec('users'); toast('تم حفظ كلمة المرور');
  }
});
