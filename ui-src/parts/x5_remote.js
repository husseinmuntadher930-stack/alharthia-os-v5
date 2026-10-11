/* =====================================================================
   3.0 — ريموت المعلم (Raspberry Pi Zero 2 W + شاشة 5 إنج)
   الريموت يدز أوامر لخادم الجهاز، وهنا نسحبها وننفذها بالواجهة، ونرجّع حالة
   الواجهة (الشاشة الحالية، الصفحة، آخر طالب انختار، الحصة…) حتى الريموت يعرضها.
   ===================================================================== */
ICONS.remote='<rect x="7" y="2" width="10" height="20" rx="3"/><circle cx="12" cy="7" r="1.6"/><path d="M10 12h4M10 15h4M10 18h4"/>';
ICONS.bell='<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 20a2 2 0 0 0 4 0"/>';
const RemoteBridge={
  seq:-1, running:false, st:null, lastJson:'', pushT:0, strokes:new Map(), laser:null, note:null, msg:null, tasksV:0,
  init(){
    window.RemoteBridge=this;
    if(!(window.Native&&Native.on)) return;
    if(this.running) return; this.running=true;
    this.loop(); setInterval(()=>this.push(true),5000);
    ['click','pointerup','keyup'].forEach(t=>addEventListener(t,()=>this.push(),true));
  },
  async loop(){
    while(this.running){
      try{ const r=await API.get('/api/remote/poll?after='+this.seq+'&wait=20'); this.seq=r.seq; for(const c of r.cmds) this.exec(c); }
      catch(e){ await new Promise(r=>setTimeout(r,3000)); }
    }
  },
  /* ---------- الحالة اللي يشوفها الريموت ---------- */
  pageInfo(){
    if(isShown('pdf')&&Pdf.doc) return {kind:'pdf',cur:(Pdf.i|0)+1,total:Pdf.n};
    if(isShown('office')&&Office.mode==='ppt'&&Office.slides&&Office.slides.length) return {kind:'slides',cur:Office.si+1,total:Office.slides.length};
    return {kind:'board',cur:Board.pi+1,total:Board.pages.length};
  },
  gather(){
    const pk=Attend.last;
    const L=window.Classroom&&Classroom.lessonInfo?Classroom.lessonInfo():null;
    return {title:(TITLES[current]||(current==='home'?'الشاشة الرئيسية':current)), screen:current,
      role:Role.cur, roleName:(ROLE_DEF[Role.cur]||{}).n, locked:!$('#lock').hidden, lockPw:!!Role.pwOf(Role.cur),
      page:this.pageInfo(), picked:pk&&Date.now()-pk.t<10*60e3?{name:pk.name,left:pk.left,total:pk.total}:null,
      lesson:L, curtain:!!(window.Curtain&&Curtain.on), ar:Board.W>1?Board.W/Board.H:16/9, boardDark:bgIsDark(Board.page.bg),
      note:this.note, msg:this.msg, tasksV:this.tasksV, v:OS_VERSION};
  },
  push(force){
    if(!(window.Native&&Native.on)) return;
    clearTimeout(this.pushT);
    this.pushT=setTimeout(()=>{ const st=this.gather(), j=JSON.stringify(st); if(!force&&j===this.lastJson) return; this.lastJson=j; API.post('/api/remote/state',st).catch(()=>{}); },force?0:120);
  },
  say(text){ this.msg={text,t:Date.now()/1000}; this.push(); },
  /* إشعار يطلع بالريموت (يرن ويومض) — مثل «باقي ٥ دقائق على نهاية الحصة» */
  notify(text){ this.note={text,t:Date.now()/1000}; this.push(true); },
  closeModals(){ $$('#modalHost .overlay').forEach(o=>o.click()); },
  /* ---------- تنفيذ الأوامر ---------- */
  async exec(c){
    try{
      if(c.t&&Date.now()/1000-c.t>30&&c.a!=='paired') return;   // أمر قديم (الواجهة كانت مسدودة) — نتجاهله
      if(window.Usage&&c.a!=='ink'&&c.a!=='laser') Usage.hit('remote:'+c.a);
      if(window.Features&&!Features.on('remote')&&c.a!=='paired') return;
      switch(c.a){
        case 'paired': toast('تم ربط '+(c.name||'الريموت')+' ✓'); this.closeModals(); if(current==='settings') this.renderSec(); break;
        case 'tasks': this.tasksV++; this.push(); break;
        case 'notify': this.notify(c.text); break;
        case 'pick': if($('#lock').hidden){ this.closeModals(); Attend.pick(); } break;
        case 'pickReset': Attend.pickReset(false); Attend.last=null; this.say('تم تصفير القرعة'); break;
        case 'prev': case 'next': this.step(c.a==='next'?1:-1); break;
        case 'board': if(Role.canScreen('board')){ if(SPL.on&&Split.exit) Split.exit(); go('board'); } break;
        case 'home': this.closeModals(); go('home'); break;
        case 'lock': lockNow(); break;
        case 'unlock': await this.unlock(c.pw); break;
        case 'role': await this.role(c.k,c.pw); break;
        case 'undo': if(isShown('board')) Board.undo(); else if(window.Annot&&Annot.on&&Annot.undo) Annot.undo(); break;
        case 'redo': if(isShown('board')) Board.redo(); break;
        case 'newpage': if(!isShown('board')) go('board'); Board.addPage(false); break;
        case 'curtain': if(window.Curtain) Curtain.toggle(); break;
        case 'open': this.open(c); break;
        case 'ink': this.ink(c); break;
        case 'laser': this.laserAt(c.x,c.y); break;
        case 'laserEnd': if(this.laser){ this.laser.live=false; this.laser=null; Board.sched(); } break;
      }
    }catch(e){ console.warn('remote',c.a,e); }
    this.push();
  },
  step(d){
    if(isShown('pdf')&&Pdf.doc){ Pdf.goto((Pdf.i|0)+d); return; }
    if(isShown('office')&&Office.mode==='ppt'&&Office.slides){ Office.goSlide(Office.si+d); if(!$('#showOv').hidden) Office.syncShow(); return; }
    if(!isShown('board')) go('board');
    Board.goPage(Board.pi+d);
  },
  async unlock(pw){
    if($('#lock').hidden) return;
    const r=Role.pwOf(Role.cur);
    if(r&&await pwHash(pw||'')!==r.h){ this.say('كلمة المرور غلط'); beep(2,220); return; }
    unlockDone();
  },
  async role(k,pw){
    if(!ROLE_DEF[k]) return;
    const r=Role.pwOf(k);
    if(r&&await pwHash(pw||'')!==r.h){ this.say('كلمة مرور '+ROLE_DEF[k].n+' غلط'); beep(2,220); return; }
    Role.enter(k); if(!$('#lock').hidden) unlockDone();
  },
  open(c){
    if(!c.path) return;
    const node=nodeOf({path:c.path,name:c.name||c.path.split('/').pop(),dir:false,size:c.size||0,mtime:c.mtime||0});
    this.closeModals(); openFile(node);
  },
  /* الكتابة من الريموت: نرسمها بالطبقة الحية مثل إصبع حقيقي، وبالنهاية تنحفظ كخط عادي (يتراجع عنه) */
  ink(c){
    if(!isShown('board')){ if(SPL.on&&Split.exit) Split.exit(); go('board'); }
    const key='r:'+c.id, pts=(c.pts||[]).filter(p=>Array.isArray(p)&&isFinite(p[0])&&isFinite(p[1])).map(p=>[clamp(p[0],0,1),clamp(p[1],0,2),1]);
    let st=Board.act.get(key);
    if(c.ph==='s'||!st){
      const hl=c.k==='hl', col=/^#[0-9a-f]{6}$/i.test(c.c||'')?c.c:Board.color;
      const s={id:uid(),t:'ink',k:hl?'hl':'pen',c:col,w:(hl?Board.sizes.hl:Board.sizes.ink)/REF,p:[]};
      st={kind:'ink',s,remote:true}; Board.act.set(key,st);
    }
    st.s.p.push(...pts);
    if(c.ph==='e'){ Board.act.delete(key); if(st.s.p.length) Board.commitAdd([st.s]); }
    Board.sched();
  },
  laserAt(x,y){
    if(!isShown('board')&&!isShown('pdf')&&!isShown('office')) go('board');
    const p=[clamp(+x||0,0,1),clamp(+y||0,0,2),performance.now()];
    if(isShown('board')){
      if(!this.laser||!this.laser.live){ this.laser={pts:[],live:true}; Board.trails.push(this.laser); }
      this.laser.pts.push(p); Board.sched(); return;
    }
    // فوق الـ PDF والعروض: نقطة حمرة فوق كل شي
    let dot=$('#rmLaser'); if(!dot){ dot=document.createElement('div'); dot.id='rmLaser'; document.body.appendChild(dot); }
    const W=innerWidth; dot.style.left=(p[0]*W)+'px'; dot.style.top=(p[1]*W)+'px'; dot.hidden=false;
    clearTimeout(this.ldT); this.ldT=setTimeout(()=>dot.hidden=true,1200);
  },
  /* ---------- قسم الإعدادات ---------- */
  async renderSec(){
    const el=$('#setMain .sec[data-sec=remote]'); if(!el) return;
    const head=`<div class="card"><h3>${icon('remote')}ريموت المعلم <span class="badge-exp">جديد</span></h3>
      <p class="hint">جهاز تحكم لاسلكي (Raspberry Pi Zero 2 W ويا شاشة 5 إنج): القرعة، تقليب الصفحات، الملفات، فتح السبورة، القفل، تبديل المستخدم، الكتابة على السبورة من بعيد، مؤشر ليزر، ومهام المعلم.</p>`;
    if(!(window.Native&&Native.on)){ el.innerHTML=head+`<div class="cam-note">${icon('info')}يشتغل على جهاز الصف نفسه.</div></div>`; paintIcons(el); return; }
    let s; try{ s=await API.get('/api/remote'); }catch(e){ el.innerHTML=head+`<div class="cam-note">${icon('info')}${esc(errMsg(e))}</div></div>`; return; }
    const url=s.ips.length?`http://${s.ips[0]}:${s.port}/`:'';
    el.innerHTML=head+`
      <div class="row"><label>تشغيل الريموت</label><label class="sw"><input type="checkbox" data-rm="enable" ${s.enabled?'checked':''}><span></span></label></div>
      <div class="row"><span class="lbl">عنوان الريموت</span><b dir="ltr" style="font-family:monospace">${esc(url||'— ماكو شبكة —')}</b></div>
      <div class="btns" style="margin-top:10px"><button class="btn primary" data-rm="pair">${icon('plus')}ربط ريموت جديد</button></div></div>
      <div class="card"><h3>${icon('remote')}الأجهزة المربوطة (${nf(s.devices.length)})</h3>
        ${s.devices.length?s.devices.map(d=>`<div class="row"><span class="cam-st${d.online?' ok':''}" style="min-width:74px">${d.online?'متصل':'غير متصل'}</span><b style="flex:1">${esc(d.name)}</b>
          <button class="btn sm ghost" data-rm="rename" data-id="${d.id}">${icon('edit')}</button><button class="btn sm danger" data-rm="remove" data-id="${d.id}">${icon('trash')}فصل</button></div>`).join('')
          :`<p class="hint">ماكو ريموت مربوط بعد — اضغط «ربط ريموت جديد» واكتب الرمز بالريموت.</p>`}</div>
      <div class="card"><h3>${icon('wifi')}شبكة الريموت</h3>
        <p class="hint">الريموت لازم يكون على نفس شبكة الجهاز. إذا ماكو Wi-Fi بالصف، شغّل شبكة خاصة من الجهاز نفسه (الأحسن يكون الجهاز متصل بالإنترنت بكيبل وقتها).</p>
        <div class="row"><label>شبكة خاصة للريموت<span class="hint">${esc(s.hotspot.ssid)} — كلمة المرور: <b dir="ltr">${esc(s.hotspot.psk||'تنعمل أول تشغيل')}</b></span></label><label class="sw"><input type="checkbox" data-rm="hotspot" ${s.hotspot.on?'checked':''}><span></span></label></div></div>
      <div class="card"><h3>${icon('terminal')}تجهيز الريموت (مرة وحدة)</h3>
        <p class="hint">على الـ Zero بعد ما تحرق Raspberry Pi OS Lite (ويكون على نفس الشبكة)، اكتب هذين الأمرين، وبعدها اضغط «ربط ريموت جديد» واكتب الرمز الي يطلب منك:</p>
        <pre class="code" dir="ltr">curl -so remote-zero-setup.sh ${esc(url||'http://IP:8770/')}setup.sh
sudo bash remote-zero-setup.sh ${esc(url||'http://IP:8770/')}${s.hotspot.on?` ${esc(s.hotspot.ssid)} ${esc(s.hotspot.psk)}`:''}</pre></div>`;
    paintIcons(el);
    el.onclick=async e=>{ const b=e.target.closest('[data-rm]'); if(!b||b.tagName==='INPUT') return; const a=b.dataset.rm;
      if(a==='pair') this.pairModal();
      if(a==='remove'&&await confirmBox('فصل الريموت','الريموت راح يحتاج ربط جديد برمز.','فصل',true,'trash')){ await API.post('/api/remote',{action:'remove',id:b.dataset.id}); this.renderSec(); }
      if(a==='rename'){ const n=await promptBox('اسم الريموت','ريموت المعلم'); if(n){ await API.post('/api/remote',{action:'rename',id:b.dataset.id,name:n}); this.renderSec(); } } };
    el.onchange=async e=>{ const i=e.target.closest('input[data-rm]'); if(!i) return;
      try{
        if(i.dataset.rm==='enable') await API.post('/api/remote',{action:'enable',on:i.checked});
        if(i.dataset.rm==='hotspot'){ toast(i.checked?'جاري تشغيل شبكة الريموت…':'جاري إطفاء شبكة الريموت…'); await API.post('/api/remote',{action:'hotspot',on:i.checked}); }
      }catch(err){ toast(errMsg(err),false); }
      this.renderSec(); };
  },
  async pairModal(){
    let s; try{ s=await API.post('/api/remote',{action:'pair'}); }catch(e){ toast(errMsg(e),false); return; }
    const pin=s.pairing.pin; let left=s.pairing.seconds, iv=0;
    modal({title:'ربط ريموت جديد',iconName:'remote',body:`<p style="text-align:center">بالريموت اكتب هذا الرمز:</p>
      <div class="rm-pin" dir="ltr">${pin.split('').map(d=>`<i>${nf(d)}</i>`).join('')}</div><p class="hint" style="text-align:center" id="rmLeft"></p>`,
      actions:[{label:'إلغاء',val:null,cls:'ghost'}],
      onOpen:ov=>{ const t=()=>{ left--; const el=$('#rmLeft',ov); if(el) el.textContent=`الرمز يبقى صالح ${nf(Math.max(0,left))} ثانية`; if(left<=0) ov.click(); }; t(); iv=setInterval(t,1000); }
    }).then(()=>{ clearInterval(iv); API.post('/api/remote',{action:'cancel'}).catch(()=>{}); this.renderSec(); });
  }
};
