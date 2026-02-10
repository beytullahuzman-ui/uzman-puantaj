/* UZMAN Puantaj — PWA (Supabase) demo
   Not: Bu ön yüz tek başına tam güvenlik sağlamaz. Üretimde RLS + Edge Functions + auth gerekir. */
(function(){
  const $ = (id)=>document.getElementById(id);
  const logEl = $('log');
  const state = {
    route:'home',
    session:null, // {user, role}
    sb:null,
    cfg: loadCfg(),
    terminals: [],
    users: [],
    lastGeo: null,
  };

  // ---------- helpers ----------
  function nowIso(){ return new Date().toISOString(); }
  function fmtDT(iso){
    if(!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleString('tr-TR', {year:'numeric',month:'2-digit',day:'2-digit', hour:'2-digit', minute:'2-digit'});
  }
  function fmtMin(min){
    if(min==null) return '—';
    const h = Math.floor(min/60);
    const m = Math.round(min%60);
    return `${h}sa ${m}dk`;
  }
  function clampStr(s,n){ s=(s??'')+''; return s.length>n? s.slice(0,n)+'…' : s; }
  function log(msg){
    const t = new Date().toLocaleTimeString('tr-TR', {hour:'2-digit',minute:'2-digit',second:'2-digit'});
    const line = `[${t}] ${msg}`;
    const cur = logEl.textContent.trim();
    const lines = (cur? (cur+'\n') : '') + line;
    const arr = lines.split('\n').slice(-30);
    logEl.textContent = arr.join('\n');
    console.log(line);
  }
  function showAlert(el, msg){
    el.style.display = msg ? 'block' : 'none';
    el.textContent = msg || '';
  }
  function showOk(el, msg){
    el.style.display = msg ? 'block' : 'none';
    el.textContent = msg || '';
  }
  function normPhone(s){
    s = (s||'').replace(/\D/g,'');
    if (s.startsWith('90')) s = s.slice(2);
    if (s.startsWith('0')) s = s.slice(1);
    return s;
  }
  function loadCfg(){
    try{ return JSON.parse(localStorage.getItem('uzman_cfg')||'{}'); }catch{ return {}; }
  }
  function saveCfg(cfg){
    localStorage.setItem('uzman_cfg', JSON.stringify(cfg||{}));
  }
  function clearCfg(){
    localStorage.removeItem('uzman_cfg');
    localStorage.removeItem('uzman_session');
  }
  function loadSession(){
    try{ return JSON.parse(localStorage.getItem('uzman_session')||'null'); }catch{ return null; }
  }
  function saveSession(sess){
    localStorage.setItem('uzman_session', JSON.stringify(sess||null));
  }

  // ---------- Supabase ----------
  function ensureSupabase(){
    const url = (state.cfg?.sbUrl||'').trim();
    const anon = (state.cfg?.sbAnon||'').trim();
    if(!url || !anon){
      state.sb = null;
      return null;
    }
    try{
      state.sb = window.supabase.createClient(url, anon, { auth: { persistSession:false } });
      return state.sb;
    }catch(err){
      state.sb = null;
      log('Supabase client kurulamadı: ' + err.message);
      return null;
    }
  }

  async function sbPing(){
    const sb = ensureSupabase();
    if(!sb) throw new Error('Supabase ayarları eksik');
    // basit ping: terminals sayımı
    const { count, error } = await sb.from('terminals').select('*', { count:'exact', head:true });
    if(error) throw error;
    return count ?? 0;
  }

  async function sbLoadMeta(){
    const sb = ensureSupabase();
    if(!sb) return;

    // terminals
    const t = await sb.from('terminals').select('*').order('name');
    if(t.error) throw t.error;
    state.terminals = t.data || [];

    // users (personnel + admin)
    const u = await sb.from('users').select('id,phone,name,role,is_owner,is_active,created_at,terminal_id').order('created_at', {ascending:false});
    if(u.error) throw u.error;
    state.users = (u.data||[]).filter(x=>x.is_active !== false);

    renderTerminalOptions();
    renderAdminUserOptions();
    await updateKPIs();
  }

  async function updateKPIs(){
    const sb = ensureSupabase();
    if(!sb){ $('kpiUsers').textContent='—'; $('kpiTerminals').textContent='—'; $('kpiToday').textContent='—'; return; }
    try{
      $('kpiUsers').textContent = state.users.length.toString();
      $('kpiTerminals').textContent = state.terminals.length.toString();

      // today shifts count
      const d0 = new Date(); d0.setHours(0,0,0,0);
      const d1 = new Date(); d1.setHours(23,59,59,999);
      const { count, error } = await sb.from('shifts').select('*', {count:'exact', head:true})
        .gte('started_at', d0.toISOString()).lte('started_at', d1.toISOString());
      if(error) throw error;
      $('kpiToday').textContent = (count ?? 0).toString();
    }catch(e){
      log('KPI hata: ' + e.message);
    }
  }

  // ---------- SQL block ----------
  const SQL = `-- UZMAN Puantaj (demo) tablolar
-- Supabase -> SQL Editor içine yapıştırıp Run ile çalıştır.

create extension if not exists pgcrypto;

-- TERMINALS
create table if not exists public.terminals (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

-- USERS (personel + admin)
create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  phone text not null unique,
  name text not null,
  role text not null check (role in ('personnel','admin')),
  pin text not null,
  terminal_id uuid references public.terminals(id) on delete set null,
  is_owner boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- SHIFTS (başla / bitir)
create table if not exists public.shifts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  terminal_id uuid references public.terminals(id) on delete set null,
  started_at timestamptz not null,
  ended_at timestamptz,
  start_lat double precision,
  start_lng double precision,
  end_lat double precision,
  end_lng double precision,
  start_accuracy_m double precision,
  end_accuracy_m double precision,
  start_note text,
  end_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_shifts_user_started on public.shifts(user_id, started_at desc);
create index if not exists idx_shifts_started_at on public.shifts(started_at desc);

-- MVP için RLS kapalı (client'tan rahat yazabilsin diye)
alter table public.terminals disable row level security;
alter table public.users disable row level security;
alter table public.shifts disable row level security;

-- ÖRNEK SEED:
-- 1) önce terminal ekle
-- insert into public.terminals(name) values ('Antalya Terminali'), ('İzmit Terminali');

-- 2) admin ve personel ekle (PIN'leri sen belirle)
-- insert into public.users(phone,name,role,pin,is_owner) values
-- ('5432234916','Beytullah Uzman','admin','3204',true),
-- ('5368373204','Admin 2','admin','4916',true);

-- 3) personel örneği (PIN: telefon son 4)
-- insert into public.users(phone,name,role,pin) values ('5XXXXXXXXX','Personel 1','personnel','XXXX');`;

  // ---------- routing ----------
  const routes = {
    home: {title:'Ana Sayfa', sub:'Giriş ve durum'},
    personnel: {title:'Personel', sub:'Başlandı / Bitti ve çizelge'},
    admin: {title:'Admin Paneli', sub:'Rapor, konum, manuel düzeltme'},
    setup: {title:'Kurulum', sub:'Supabase ve SQL'},
  };

  function setRoute(r){
    state.route = r;
    document.querySelectorAll('.nav button').forEach(b=>{
      b.classList.toggle('active', b.dataset.route === r);
    });
    $('pageTitle').textContent = routes[r]?.title || '—';
    $('pageSub').textContent = routes[r]?.sub || '';

    $('viewHome').classList.toggle('hidden', r!=='home');
    $('viewPersonnel').classList.toggle('hidden', r!=='personnel');
    $('viewAdmin').classList.toggle('hidden', r!=='admin');
    $('viewSetup').classList.toggle('hidden', r!=='setup');

    // access control
    if(r==='personnel' && state.session?.role!=='personnel'){
      setRoute('home');
      showAlert($('loginError'), 'Personel ekranı için personel girişi gerekli.');
      return;
    }
    if(r==='admin' && state.session?.role!=='admin'){
      setRoute('home');
      showAlert($('loginError'), 'Admin paneli için admin girişi gerekli.');
      return;
    }

    if(r==='personnel') refreshPersonnel();
    if(r==='admin') refreshAdmin();
    if(r==='setup') refreshSetup();
  }

  // ---------- geolocation ----------
  async function getGeo(){
    return await new Promise((resolve, reject)=>{
      if(!navigator.geolocation){
        reject(new Error('Konum API desteklenmiyor'));
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos)=>{
          resolve({
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            acc: pos.coords.accuracy,
            ts: pos.timestamp
          });
        },
        (err)=>{
          const m = err.code===1 ? 'Konum izni verilmedi.' :
                    err.code===2 ? 'Konum alınamadı.' :
                    err.code===3 ? 'Konum zaman aşımı.' : (err.message||'Konum hatası');
          reject(new Error(m));
        },
        { enableHighAccuracy:true, timeout: 15000, maximumAge: 0 }
      );
    });
  }
  function setGeoBadge(kind, text){
    const el = $('geoBadge');
    el.className = 'badge ' + (kind||'warn');
    el.textContent = text;
  }

  // ---------- auth / login ----------
  async function login(){
    showAlert($('loginError'), '');
    showOk($('loginOk'), '');

    const mode = $('loginMode').value;
    const phone = normPhone($('loginPhone').value);
    const pin = ($('loginPin').value||'').trim();

    if(phone.length < 10) { showAlert($('loginError'), 'Telefon hatalı. Örnek: 5xxxxxxxxx'); return; }
    if(pin.length < 4) { showAlert($('loginError'), 'PIN 4 haneli olmalı.'); return; }

    const sb = ensureSupabase();
    if(!sb){
      showAlert($('loginError'), 'Kurulum eksik. Kurulum & Ayarlar ekranından Supabase Project URL ve Public Key gir.');
      return;
    }

    try{
      // user lookup
      const { data, error } = await sb.from('users')
        .select('id,phone,name,role,is_owner,is_active,terminal_id')
        .eq('phone', phone).maybeSingle();
      if(error) throw error;
      if(!data) { showAlert($('loginError'), 'Kullanıcı bulunamadı. Admin panelinden ekleyin.'); return; }
      if(data.is_active === false) { showAlert($('loginError'), 'Bu kullanıcı pasif.'); return; }
      if(data.role !== mode){ showAlert($('loginError'), 'Seçtiğin mod ile kullanıcı rolü uyuşmuyor.'); return; }

      // pin check
      const { data: pinRow, error: pErr } = await sb.from('users').select('pin').eq('id', data.id).maybeSingle();
      if(pErr) throw pErr;
      if(!pinRow || (pinRow.pin||'') !== pin){
        showAlert($('loginError'), 'PIN hatalı.');
        return;
      }

      state.session = { user: data, role: data.role };
      saveSession(state.session);
      $('btnLogout').classList.remove('hidden');

      showOk($('loginOk'), `Giriş başarılı: ${data.name}`);
      setWhoami();
      await sbLoadMeta();

      // route jump
      setRoute(data.role === 'admin' ? 'admin' : 'personnel');
    }catch(e){
      showAlert($('loginError'), 'Supabase hata: ' + e.message);
      log('Login hata: ' + e.message);
    }
  }

  function logout(){
    state.session = null;
    saveSession(null);
    $('btnLogout').classList.add('hidden');
    setWhoami();
    setRoute('home');
  }

  function setWhoami(){
    const el = $('whoami');
    if(!state.session){
      el.textContent = 'Giriş yok';
      return;
    }
    const u = state.session.user;
    el.textContent = `${u.name} • ${u.role === 'admin' ? 'Admin' : 'Personel'}`;
  }

  // ---------- personnel ----------
  async function refreshPersonnel(){
    showAlert($('personnelError'), '');
    showOk($('personnelOk'), '');
    const sb = ensureSupabase();
    if(!sb) return;

    // me badge + terminals
    const u = state.session.user;
    $('meBadge').textContent = `${u.name} • ${u.phone}`;

    // load active shift
    try{
      await sbLoadMeta();
      // default terminal selection
      if(u.terminal_id){
        $('personnelTerminal').value = u.terminal_id;
      } else if(state.terminals[0]){
        $('personnelTerminal').value = state.terminals[0].id;
      }

      const { data, error } = await sb.from('shifts')
        .select('id,started_at,ended_at,terminal_id')
        .eq('user_id', u.id)
        .order('started_at', {ascending:false})
        .limit(1);
      if(error) throw error;
      const last = (data||[])[0];
      if(last && !last.ended_at){
        $('shiftStatus').className = 'badge ok';
        $('shiftStatus').textContent = 'Mesai açık';
        $('shiftHint').textContent = 'Mesai devam ediyor. Bitirmek için "Bitti".';
      } else {
        $('shiftStatus').className = 'badge warn';
        $('shiftStatus').textContent = 'Mesai kapalı';
        $('shiftHint').textContent = 'Mesai başlatmak için "Başlandı".';
      }

      await renderMyShifts();

    }catch(e){
      showAlert($('personnelError'), 'Hata: ' + e.message);
      log('Personel refresh hata: ' + e.message);
    }
  }

  async function renderMyShifts(){
    const sb = ensureSupabase();
    const u = state.session.user;
    const tbl = $('tblMyShifts');
    tbl.innerHTML = '';

    const since = new Date(); since.setDate(since.getDate()-14);
    const { data, error } = await sb.from('shifts')
      .select('started_at,ended_at,terminal_id')
      .eq('user_id', u.id)
      .gte('started_at', since.toISOString())
      .order('started_at', {ascending:false})
      .limit(100);
    if(error) throw error;

    const tMap = new Map(state.terminals.map(t=>[t.id,t.name]));
    (data||[]).forEach(row=>{
      const d = new Date(row.started_at);
      const dateStr = d.toLocaleDateString('tr-TR', {year:'numeric',month:'2-digit',day:'2-digit'});
      const start = fmtDT(row.started_at);
      const end = fmtDT(row.ended_at);
      const min = calcNetMinutes(row.started_at, row.ended_at);
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${dateStr}</td>
        <td>${tMap.get(row.terminal_id)||'—'}</td>
        <td class="mono">${start}</td>
        <td class="mono">${end}</td>
        <td><span class="badge ${min==null?'warn':(min>=480?'ok':'')}">${fmtMin(min)}</span></td>
      `;
      tbl.appendChild(tr);
    });
    if((data||[]).length===0){
      const tr = document.createElement('tr');
      tr.innerHTML = `<td colspan="5" class="small">Kayıt yok.</td>`;
      tbl.appendChild(tr);
    }
  }

  function calcNetMinutes(startIso, endIso){
    if(!startIso || !endIso) return null;
    const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
    if(ms<=0) return 0;
    let min = Math.round(ms/60000);
    // 9 saati geçen her çalışmada 1 saat yemek düş
    if(min > 9*60) min -= 60;
    if(min < 0) min = 0;
    return min;
  }

  async function startShift(){
    showAlert($('personnelError'), '');
    showOk($('personnelOk'), '');
    const sb = ensureSupabase();
    const u = state.session.user;
    const terminalId = $('personnelTerminal').value || null;
    if(!terminalId){ showAlert($('personnelError'), 'Terminal seç.'); return; }

    try{
      // location required
      setGeoBadge('warn','Konum isteniyor…');
      const geo = await getGeo();
      state.lastGeo = geo;
      setGeoBadge('ok', `Konum alındı: ${geo.lat.toFixed(5)}, ${geo.lng.toFixed(5)} (±${Math.round(geo.acc)}m)`);

      // prevent duplicate open shift
      const last = await sb.from('shifts').select('id,ended_at').eq('user_id', u.id).order('started_at', {ascending:false}).limit(1);
      if(last.error) throw last.error;
      if(last.data && last.data[0] && !last.data[0].ended_at){
        showAlert($('personnelError'), 'Zaten açık mesain var. Bitirip tekrar dene.');
        return;
      }

      const payload = {
        user_id: u.id,
        terminal_id: terminalId,
        started_at: nowIso(),
        start_lat: geo.lat,
        start_lng: geo.lng,
        start_accuracy_m: geo.acc,
        start_note: 'Başlandı (mobil)'
      };
      const ins = await sb.from('shifts').insert(payload).select('id').maybeSingle();
      if(ins.error) throw ins.error;

      showOk($('personnelOk'), 'Mesai başlatıldı.');
      log(`Mesai başlatıldı (user=${u.phone})`);
      await refreshPersonnel();
    }catch(e){
      showAlert($('personnelError'), e.message);
      setGeoBadge('bad', 'Konum Sonucu: ' + e.message);
      log('Başlat hata: ' + e.message);
    }
  }

  async function endShift(){
    showAlert($('personnelError'), '');
    showOk($('personnelOk'), '');
    const sb = ensureSupabase();
    const u = state.session.user;

    try{
      setGeoBadge('warn','Konum isteniyor…');
      const geo = await getGeo();
      state.lastGeo = geo;
      setGeoBadge('ok', `Konum alındı: ${geo.lat.toFixed(5)}, ${geo.lng.toFixed(5)} (±${Math.round(geo.acc)}m)`);

      // find open shift
      const open = await sb.from('shifts').select('*').eq('user_id', u.id).is('ended_at', null).order('started_at', {ascending:false}).limit(1);
      if(open.error) throw open.error;
      const row = (open.data||[])[0];
      if(!row){ showAlert($('personnelError'), 'Açık mesai yok.'); return; }

      const upd = await sb.from('shifts').update({
        ended_at: nowIso(),
        end_lat: geo.lat,
        end_lng: geo.lng,
        end_accuracy_m: geo.acc,
        end_note: 'Bitti (mobil)',
        updated_at: nowIso()
      }).eq('id', row.id);
      if(upd.error) throw upd.error;

      showOk($('personnelOk'), 'Mesai bitirildi.');
      log(`Mesai bitirildi (user=${u.phone})`);
      await refreshPersonnel();
    }catch(e){
      showAlert($('personnelError'), e.message);
      setGeoBadge('bad', 'Konum Sonucu: ' + e.message);
      log('Bitir hata: ' + e.message);
    }
  }

  // ---------- admin ----------
  async function refreshAdmin(){
    showAlert($('adminError'), '');
    showOk($('adminOk'), '');
    const sb = ensureSupabase();
    if(!sb) return;

    try{
      await sbLoadMeta();
      const u = state.session.user;
      $('adminBadge').textContent = `${u.name}${u.is_owner ? ' 👑' : ''} • ${u.phone}`;

      // default date range = last 7 days
      const to = new Date();
      const from = new Date(); from.setDate(to.getDate()-7);
      if(!$('adminFrom').value) $('adminFrom').value = from.toISOString().slice(0,10);
      if(!$('adminTo').value) $('adminTo').value = to.toISOString().slice(0,10);

    }catch(e){
      showAlert($('adminError'), 'Hata: ' + e.message);
      log('Admin refresh hata: ' + e.message);
    }
  }

  async function adminLoadRange(){
    showAlert($('adminError'), '');
    showOk($('adminOk'), '');
    const sb = ensureSupabase();
    const userId = $('adminPickUser').value;
    if(!userId){ showAlert($('adminError'), 'Personel seç.'); return; }

    const from = $('adminFrom').value;
    const to = $('adminTo').value;
    if(!from || !to){ showAlert($('adminError'), 'Tarih aralığı seç.'); return; }

    try{
      const fromDT = new Date(from+'T00:00:00.000Z');
      const toDT = new Date(to+'T23:59:59.999Z');

      const { data, error } = await sb.from('shifts')
        .select('id,started_at,ended_at,terminal_id,start_lat,start_lng,end_lat,end_lng,start_accuracy_m,end_accuracy_m')
        .eq('user_id', userId)
        .gte('started_at', fromDT.toISOString())
        .lte('started_at', toDT.toISOString())
        .order('started_at', {ascending:false})
        .limit(500);
      if(error) throw error;

      renderAdminTable(data||[]);
      const totalMin = (data||[]).reduce((acc,r)=> acc + (calcNetMinutes(r.started_at, r.ended_at) || 0), 0);
      $('adminSummary').textContent = `Kayıt: ${(data||[]).length} • Toplam net: ${fmtMin(totalMin)}`;

      showOk($('adminOk'), 'Liste güncellendi.');
    }catch(e){
      showAlert($('adminError'), 'Hata: ' + e.message);
      log('Admin liste hata: ' + e.message);
    }
  }

  function renderAdminTable(rows){
    const tbl = $('tblAdminShifts');
    tbl.innerHTML = '';
    const tMap = new Map(state.terminals.map(t=>[t.id,t.name]));
    rows.forEach(r=>{
      const d = new Date(r.started_at);
      const dateStr = d.toLocaleDateString('tr-TR', {year:'numeric',month:'2-digit',day:'2-digit'});
      const net = calcNetMinutes(r.started_at, r.ended_at);
      const loc = renderLocLine(r);
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${dateStr}</td>
        <td>${tMap.get(r.terminal_id)||'—'}</td>
        <td class="mono">${fmtDT(r.started_at)}</td>
        <td class="mono">${fmtDT(r.ended_at)}</td>
        <td><span class="badge ${net==null?'warn':(net>540?'ok':'')}">${fmtMin(net)}</span></td>
        <td>${loc}</td>
      `;
      tbl.appendChild(tr);
    });
    if(rows.length===0){
      const tr = document.createElement('tr');
      tr.innerHTML = `<td colspan="6" class="small">Kayıt yok.</td>`;
      tbl.appendChild(tr);
    }
  }

  function renderLocLine(r){
    const s = (r.start_lat && r.start_lng) ? `${r.start_lat.toFixed(5)}, ${r.start_lng.toFixed(5)} (±${Math.round(r.start_accuracy_m||0)}m)` : '—';
    const e = (r.end_lat && r.end_lng) ? `${r.end_lat.toFixed(5)}, ${r.end_lng.toFixed(5)} (±${Math.round(r.end_accuracy_m||0)}m)` : '—';
    return `<div class="small"><b>Başlandı:</b> <span class="mono">${s}</span><br/><b>Bitti:</b> <span class="mono">${e}</span></div>`;
  }

  // ---------- admin: user mgmt / manual / terminals ----------
  async function adminOpenUsers(){
    const sb = ensureSupabase();
    const me = state.session.user;

    const modal = makeModal('Kullanıcı Yönetimi',
      `<div class="split">
         <div>
           <label>Telefon</label><input id="m_phone" placeholder="5xxxxxxxxx" inputmode="numeric" />
         </div>
         <div>
           <label>Ad Soyad</label><input id="m_name" placeholder="Ad Soyad" />
         </div>
         <div>
           <label>Rol</label>
           <select id="m_role"><option value="personnel">personnel</option><option value="admin">admin</option></select>
           <div class="hint">Admin eklemek için yetkin olmalı.</div>
         </div>
         <div>
           <label>PIN</label><input id="m_pin" placeholder="••••" inputmode="numeric" />
           <div class="hint">Personel için genelde telefonun son 4 hanesi.</div>
         </div>
       </div>
       <div style="height:10px"></div>
       <div class="row">
         <button class="btn primary" id="m_add">Ekle</button>
       </div>
       <div style="height:12px"></div>
       <div class="small">Kullanıcılar</div>
       <div style="height:8px"></div>
       <div style="max-height:280px; overflow:auto; border:1px solid rgba(255,255,255,.08); border-radius:14px; background: rgba(0,0,0,.16)">
         <table>
           <thead><tr><th>Ad</th><th>Telefon</th><th>Rol</th><th>Durum</th><th></th></tr></thead>
           <tbody id="m_tbl"></tbody>
         </table>
       </div>
       <div class="alert" id="m_err"></div>
       <div class="okline" id="m_ok"></div>`
    );

    const mErr = modal.q('#m_err');
    const mOk = modal.q('#m_ok');
    const mTbl = modal.q('#m_tbl');

    function canManageAdmins(){
      // sadece owner admin admin ekleyip silebilir
      return !!me.is_owner;
    }

    function render(){
      mTbl.innerHTML = '';
      state.users.forEach(u=>{
        const tr = document.createElement('tr');
        const isOwner = !!u.is_owner;
        const canDelete = (u.role==='personnel') || (u.role==='admin' && canManageAdmins() && !isOwner);
        tr.innerHTML = `
          <td>${u.name}${isOwner?' 👑':''}</td>
          <td class="mono">${u.phone}</td>
          <td>${u.role}</td>
          <td>${u.is_active===false?'<span class="badge bad">pasif</span>':'<span class="badge ok">aktif</span>'}</td>
          <td>${canDelete?'<button class="btn danger" data-del="'+u.id+'">Sil</button>':''}</td>
        `;
        mTbl.appendChild(tr);
      });
      if(!canManageAdmins()){
        modal.q('#m_role').value = 'personnel';
        modal.q('#m_role').querySelector('option[value="admin"]').disabled = true;
      }
    }

    render();

    modal.q('#m_add').addEventListener('click', async ()=>{
      showAlert(mErr,''); showOk(mOk,'');
      const phone = normPhone(modal.q('#m_phone').value);
      const name = (modal.q('#m_name').value||'').trim();
      const role = modal.q('#m_role').value;
      const pin = (modal.q('#m_pin').value||'').trim();

      if(phone.length<10){ showAlert(mErr,'Telefon hatalı.'); return; }
      if(!name){ showAlert(mErr,'İsim gerekli.'); return; }
      if(pin.length<4){ showAlert(mErr,'PIN 4 haneli olmalı.'); return; }
      if(role==='admin' && !canManageAdmins()){ showAlert(mErr,'Admin ekleme yetkin yok.'); return; }

      try{
        const ins = await sb.from('users').insert({
          phone, name, role, pin,
          is_owner: false,
          is_active: true
        });
        if(ins.error) throw ins.error;
        await sbLoadMeta();
        render();
        showOk(mOk,'Kullanıcı eklendi.');
      }catch(e){
        showAlert(mErr, e.message);
      }
    });

    mTbl.addEventListener('click', async (e)=>{
      const btn = e.target.closest('button[data-del]');
      if(!btn) return;
      const id = btn.getAttribute('data-del');
      const u = state.users.find(x=>x.id===id);
      if(!u) return;

      if(u.is_owner){
        showAlert(mErr, 'Owner admin silinemez.');
        return;
      }
      if(u.role==='admin' && !canManageAdmins()){
        showAlert(mErr, 'Admin silme yetkin yok.');
        return;
      }
      if(!confirm(`${u.name} silinsin mi?`)) return;

      try{
        const del = await sb.from('users').delete().eq('id', id);
        if(del.error) throw del.error;
        await sbLoadMeta();
        render();
        showOk(mOk,'Silindi.');
      }catch(err){
        showAlert(mErr, err.message);
      }
    });
  }

  async function adminOpenTerminals(){
    const sb = ensureSupabase();

    const modal = makeModal('Terminal Ekle',
      `<div class="split">
         <div>
           <label>Terminal adı</label>
           <input id="t_name" placeholder="Örn: Antalya Terminali" />
         </div>
         <div style="display:flex; align-items:flex-end">
           <button class="btn primary" id="t_add" style="width:100%">Ekle</button>
         </div>
       </div>
       <div style="height:12px"></div>
       <div style="max-height:260px; overflow:auto; border:1px solid rgba(255,255,255,.08); border-radius:14px; background: rgba(0,0,0,.16)">
         <table>
           <thead><tr><th>Terminal</th><th></th></tr></thead>
           <tbody id="t_tbl"></tbody>
         </table>
       </div>
       <div class="alert" id="t_err"></div>
       <div class="okline" id="t_ok"></div>`
    );

    const tErr = modal.q('#t_err');
    const tOk = modal.q('#t_ok');
    const tTbl = modal.q('#t_tbl');

    function render(){
      tTbl.innerHTML = '';
      state.terminals.forEach(t=>{
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${t.name}</td><td><button class="btn danger" data-del="${t.id}">Sil</button></td>`;
        tTbl.appendChild(tr);
      });
      if(state.terminals.length===0){
        const tr = document.createElement('tr');
        tr.innerHTML = `<td colspan="2" class="small">Terminal yok.</td>`;
        tTbl.appendChild(tr);
      }
    }

    render();

    modal.q('#t_add').addEventListener('click', async ()=>{
      showAlert(tErr,''); showOk(tOk,'');
      const name = (modal.q('#t_name').value||'').trim();
      if(!name){ showAlert(tErr,'Terminal adı gerekli.'); return; }
      try{
        const ins = await sb.from('terminals').insert({ name });
        if(ins.error) throw ins.error;
        await sbLoadMeta();
        render();
        showOk(tOk,'Terminal eklendi.');
      }catch(e){
        showAlert(tErr, e.message);
      }
    });

    tTbl.addEventListener('click', async (e)=>{
      const btn = e.target.closest('button[data-del]');
      if(!btn) return;
      const id = btn.getAttribute('data-del');
      const t = state.terminals.find(x=>x.id===id);
      if(!t) return;
      if(!confirm(`${t.name} silinsin mi?`)) return;
      try{
        const del = await sb.from('terminals').delete().eq('id', id);
        if(del.error) throw del.error;
        await sbLoadMeta();
        render();
        showOk(tOk,'Silindi.');
      }catch(err){
        showAlert(tErr, err.message);
      }
    });
  }

  async function adminOpenManual(){
    const sb = ensureSupabase();
    const userId = $('adminPickUser').value;
    if(!userId){ showAlert($('adminError'), 'Önce personel seç.'); return; }

    const modal = makeModal('Manuel Mesai Düzeltme',
      `<div class="split">
         <div>
           <label>Başlangıç</label>
           <input id="mm_start" type="datetime-local" />
         </div>
         <div>
           <label>Bitiş</label>
           <input id="mm_end" type="datetime-local" />
         </div>
         <div>
           <label>Not</label>
           <input id="mm_note" placeholder="Unutma / düzeltme nedeni" />
         </div>
       </div>
       <div style="height:10px"></div>
       <div class="row">
         <button class="btn primary" id="mm_save">Kaydet</button>
       </div>
       <div class="alert" id="mm_err"></div>
       <div class="okline" id="mm_ok"></div>`
    );

    const err = modal.q('#mm_err');
    const ok = modal.q('#mm_ok');

    modal.q('#mm_save').addEventListener('click', async ()=>{
      showAlert(err,''); showOk(ok,'');
      const s = modal.q('#mm_start').value;
      const e = modal.q('#mm_end').value;
      if(!s || !e){ showAlert(err,'Başlangıç ve bitiş gerekli.'); return; }
      const sIso = new Date(s).toISOString();
      const eIso = new Date(e).toISOString();
      if(new Date(eIso) <= new Date(sIso)){ showAlert(err,'Bitiş başlangıçtan küçük olamaz.'); return; }

      try{
        const terminalId = state.users.find(x=>x.id===userId)?.terminal_id || null;
        const ins = await sb.from('shifts').insert({
          user_id: userId,
          terminal_id: terminalId,
          started_at: sIso,
          ended_at: eIso,
          start_note: 'Manuel: ' + clampStr(modal.q('#mm_note').value, 200),
          end_note: 'Manuel'
        });
        if(ins.error) throw ins.error;
        showOk(ok,'Kayıt eklendi.');
      }catch(ex){
        showAlert(err, ex.message);
      }
    });
  }

  // ---------- setup ----------
  function refreshSetup(){
    $('sbUrl').value = state.cfg?.sbUrl || '';
    $('sbAnon').value = state.cfg?.sbAnon || '';
    $('sqlBlock').textContent = SQL;
  }

  async function saveSetupUI(){
    const sbUrl = ($('sbUrl').value||'').trim();
    const sbAnon = ($('sbAnon').value||'').trim();
    state.cfg = { ...state.cfg, sbUrl, sbAnon };
    saveCfg(state.cfg);
    ensureSupabase();
    showOk($('setupOk'), 'Kaydedildi.');
    showAlert($('setupError'), '');
    log('Kurulum kaydedildi.');
    try{
      await sbLoadMeta();
      await updateKPIs();
    }catch(e){
      // ignore
    }
  }

  async function testSetupUI(){
    showAlert($('setupError'), '');
    showOk($('setupOk'), '');
    try{
      await saveSetupUI();
      const cnt = await sbPing();
      showOk($('setupOk'), `Bağlantı başarılı. terminals count=${cnt}`);
      log('Supabase bağlantı OK');
    }catch(e){
      showAlert($('setupError'), e.message);
      log('Supabase test hata: ' + e.message);
    }
  }

  // ---------- UI render helpers ----------
  function renderTerminalOptions(){
    const sel = $('personnelTerminal');
    sel.innerHTML = '';
    state.terminals.forEach(t=>{
      const opt = document.createElement('option');
      opt.value = t.id;
      opt.textContent = t.name;
      sel.appendChild(opt);
    });
  }

  function renderAdminUserOptions(){
    const sel = $('adminPickUser');
    sel.innerHTML = '';
    // only personnel
    const list = state.users.filter(u=>u.role==='personnel');
    list.forEach(u=>{
      const opt = document.createElement('option');
      opt.value = u.id;
      opt.textContent = `${u.name} (${u.phone})`;
      sel.appendChild(opt);
    });
  }

  // ---------- modal ----------
  function makeModal(title, innerHTML){
    const wrap = document.createElement('div');
    wrap.style.position='fixed';
    wrap.style.inset='0';
    wrap.style.background='rgba(0,0,0,.55)';
    wrap.style.display='grid';
    wrap.style.placeItems='center';
    wrap.style.zIndex='9999';
    wrap.innerHTML = `
      <div style="width:min(980px, calc(100vw - 24px)); max-height: calc(100vh - 24px); overflow:auto;
                  background: linear-gradient(180deg, rgba(255,255,255,.07), rgba(255,255,255,.02));
                  border:1px solid rgba(255,255,255,.12); border-radius:18px; box-shadow: 0 24px 80px rgba(0,0,0,.65);">
        <div style="padding:14px 16px; display:flex; align-items:center; justify-content:space-between; gap:10px;
                    border-bottom:1px solid rgba(255,255,255,.10); background: rgba(0,0,0,.14)">
          <div>
            <div style="font-weight:700">${title}</div>
            <div style="font-size:12px; color:rgba(147,164,199,.9)">Supabase veri tabanına yazar</div>
          </div>
          <button class="btn" id="m_close">Kapat</button>
        </div>
        <div style="padding:14px 16px" id="m_body">${innerHTML}</div>
      </div>
    `;
    document.body.appendChild(wrap);
    const close = ()=>wrap.remove();
    wrap.querySelector('#m_close').addEventListener('click', close);
    wrap.addEventListener('click', (e)=>{ if(e.target===wrap) close(); });

    return {
      el: wrap,
      q: (sel)=>wrap.querySelector(sel),
      close
    };
  }

  // ---------- init ----------
  function wire(){
    // nav
    document.querySelectorAll('.nav button').forEach(b=>{
      b.addEventListener('click', ()=>setRoute(b.dataset.route));
    });

    $('loginMode').addEventListener('change', ()=>{
      const isPersonnel = $('loginMode').value === 'personnel';
      $('pinHint').textContent = isPersonnel ? 'Personel için varsayılan: telefonun son 4 hanesi.' : 'Admin PIN, admin kullanıcı kaydında tanımlıdır.';
    });

    $('btnLogin').addEventListener('click', login);
    $('btnLogout').addEventListener('click', logout);

    $('btnGeoTest').addEventListener('click', async ()=>{
      try{
        setGeoBadge('warn','Konum isteniyor…');
        const geo = await getGeo();
        state.lastGeo = geo;
        setGeoBadge('ok', `Konum alındı: ${geo.lat.toFixed(5)}, ${geo.lng.toFixed(5)} (±${Math.round(geo.acc)}m)`);
        log('Konum test OK');
      }catch(e){
        setGeoBadge('bad','Konum Sonucu: ' + e.message);
        log('Konum test hata: ' + e.message);
      }
    });

    // personnel buttons
    $('btnStart').addEventListener('click', startShift);
    $('btnEnd').addEventListener('click', endShift);

    // admin buttons
    $('btnRefreshAdmin').addEventListener('click', refreshAdmin);
    $('btnAdminLoad').addEventListener('click', adminLoadRange);
    $('btnAdminManual').addEventListener('click', adminOpenManual);
    $('btnAdminUsers').addEventListener('click', adminOpenUsers);
    $('btnAdminTerminals').addEventListener('click', adminOpenTerminals);

    // setup
    $('btnSaveSetup').addEventListener('click', saveSetupUI);
    $('btnTestSetup').addEventListener('click', testSetupUI);
    $('btnClearLocal').addEventListener('click', ()=>{
      if(!confirm('Bu cihazdaki ayarlar ve oturum silinsin mi?')) return;
      clearCfg();
      state.cfg = loadCfg();
      logout();
      location.reload();
    });

    // try restore session
    state.session = loadSession();
    setWhoami();
    if(state.session){
      $('btnLogout').classList.remove('hidden');
    }

    ensureSupabase();
    refreshSetup();

    // preload meta
    sbLoadMeta().catch(e=>log('Meta yükleme hata: ' + e.message));

    // start route
    if(state.session?.role==='admin') setRoute('admin');
    else if(state.session?.role==='personnel') setRoute('personnel');
    else setRoute('home');

    log('Uygulama hazır.');
  }

  wire();

})();
