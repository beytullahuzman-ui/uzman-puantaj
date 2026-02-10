/* UZMAN Puantaj - Supabase (no backend) */
const $ = (q, el=document) => el.querySelector(q);
const $$ = (q, el=document) => Array.from(el.querySelectorAll(q));

const STORE = {
  get(k, d=null){ try{ const v=localStorage.getItem(k); return v?JSON.parse(v):d; }catch(e){ return d; } },
  set(k, v){ localStorage.setItem(k, JSON.stringify(v)); },
  del(k){ localStorage.removeItem(k); }
};

const CFG_KEY="UZMAN_CFG";
const SESSION_KEY="UZMAN_SESSION";

const DEFAULT_CFG = {
  supabaseUrl: "",
  supabaseKey: "",
  owners: [
    { phone: "+905432234916", pin: "3204" },
    { phone: "+905368373204", pin: "4916" }
  ]
};

function normalizePhone(raw){
  if(!raw) return "";
  let s = raw.trim().replace(/\s+/g,"");
  if(s.startsWith("0") && s.length===11) s = "+9" + s; // 0xxxxxxxxxx -> +90xxxxxxxxxx
  if(s.startsWith("90") && !s.startsWith("+")) s = "+"+s;
  if(s.startsWith("5") && s.length===10) s = "+90"+s;
  return s;
}
function last4(phone){ return (phone||"").replace(/\D/g,"").slice(-4); }

function fmtDate(d){
  const x = new Date(d);
  const y=x.getFullYear();
  const m=String(x.getMonth()+1).padStart(2,"0");
  const day=String(x.getDate()).padStart(2,"0");
  return `${y}-${m}-${day}`;
}
function fmtTime(d){
  const x=new Date(d);
  const hh=String(x.getHours()).padStart(2,"0");
  const mm=String(x.getMinutes()).padStart(2,"0");
  return `${hh}:${mm}`;
}
function fmtDT(d){
  const x=new Date(d);
  return `${fmtDate(x)} ${fmtTime(x)}`;
}
function durMs(a,b){ return Math.max(0, new Date(b).getTime() - new Date(a).getTime()); }
function msToHM(ms){
  const m = Math.round(ms/60000);
  const h = Math.floor(m/60);
  const r = m%60;
  return `${h}sa ${String(r).padStart(2,"0")}dk`;
}
function lunchMs(totalMs){
  return totalMs > 9*3600*1000 ? 3600*1000 : 0;
}
function mapsLink(lat,lng){
  return `https://www.google.com/maps?q=${encodeURIComponent(lat + "," + lng)}`;
}

/* Supabase REST (anon) */
function getCfg(){ return { ...DEFAULT_CFG, ...(STORE.get(CFG_KEY, {})) }; }
function setCfg(cfg){ STORE.set(CFG_KEY, cfg); }

function sbHeaders(){
  const cfg=getCfg();
  if(!cfg.supabaseUrl || !cfg.supabaseKey) return null;
  return {
    "apikey": cfg.supabaseKey,
    "Authorization": `Bearer ${cfg.supabaseKey}`,
    "Content-Type": "application/json",
    "Prefer": "return=representation"
  };
}
async function sbFetch(path, opts={}){
  const cfg=getCfg();
  const h=sbHeaders();
  if(!h) throw new Error("Kurulum yok: Supabase URL/Key giriniz.");
  const url = cfg.supabaseUrl.replace(/\/+$/,"") + "/rest/v1/" + path.replace(/^\/+/,"");
  const res = await fetch(url, { ...opts, headers: { ...h, ...(opts.headers||{}) }});
  if(!res.ok){
    const t = await res.text().catch(()=> "");
    throw new Error(`Supabase hata (${res.status}): ${t || res.statusText}`);
  }
  const ct = res.headers.get("content-type")||"";
  if(ct.includes("application/json")) return await res.json();
  return await res.text();
}

/* UI state */
const state = {
  view: "home",
  user: null,
  terminals: [],
  users: [],
  openShift: null,
  edit: { shiftId: null, row: null }
};

function setConn(ok, text){
  $("#connText").textContent = ok ? "Açık" : "Kapalı";
  $("#pillStatus").style.borderColor = ok ? "rgba(34,197,94,.35)" : "rgba(255,255,255,.12)";
  $("#pillStatus").style.background = ok ? "rgba(34,197,94,.10)" : "rgba(255,255,255,.03)";
  $("#connText").style.color = ok ? "rgba(180,255,210,.95)" : "rgba(200,210,230,.9)";
  if(text) $("#connText").textContent = text;
}

function setView(v){
  state.view=v;
  const map = {
    home: ["Ana Sayfa", "Giriş ve durum"],
    personel: ["Personel", "Başlandı / Bitti + çizelge"],
    admin: ["Admin", "Rapor + yönetim"],
    ayar: ["Kurulum", "Supabase ve SQL"]
  };
  $("#topTitle").textContent = map[v][0];
  $("#topSub").textContent = map[v][1];

  $("#viewHome").style.display = v==="home" ? "" : "none";
  $("#viewPersonel").style.display = v==="personel" ? "" : "none";
  $("#viewAdmin").style.display = v==="admin" ? "" : "none";
  $("#viewAyar").style.display = v==="ayar" ? "" : "none";

  $$("#nav button").forEach(b=>b.classList.toggle("active", b.dataset.view===v));
}

function setErr(el, msg){
  el.style.display = msg ? "" : "none";
  el.textContent = msg || "";
}

function sessionGet(){ return STORE.get(SESSION_KEY, null); }
function sessionSet(s){ STORE.set(SESSION_KEY, s); }
function sessionClear(){ STORE.del(SESSION_KEY); }

/* Geolocation */
async function getGeo(){
  return new Promise((resolve,reject)=>{
    if(!navigator.geolocation) return reject(new Error("Tarayıcı konum desteklemiyor."));
    navigator.geolocation.getCurrentPosition(
      (pos)=>resolve(pos),
      (err)=>{
        const map = { 1:"İzin verilmedi.", 2:"Konum alınamadı.", 3:"Zaman aşımı." };
        reject(new Error(map[err.code] || err.message || "Konum hatası."));
      },
      { enableHighAccuracy:true, timeout: 15000, maximumAge: 0 }
    );
  });
}
function geoToText(pos){
  const c=pos.coords;
  return `lat ${c.latitude.toFixed(6)}, lng ${c.longitude.toFixed(6)} (±${Math.round(c.accuracy)}m)`;
}

/* DB bootstrap SQL */
const SQL = `-- UZMAN Puantaj (demo) - tablolar
create extension if not exists pgcrypto;

create table if not exists public.terminals (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  phone text not null unique,
  name text not null,
  role text not null check (role in ('personel','admin')),
  pin text not null,
  is_owner boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.shifts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  terminal_id uuid references public.terminals(id) on delete set null,
  started_at timestamptz not null,
  ended_at timestamptz,
  start_lat double precision,
  start_lng double precision,
  start_acc double precision,
  end_lat double precision,
  end_lng double precision,
  end_acc double precision,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists shifts_user_started_idx on public.shifts(user_id, started_at desc);
create index if not exists shifts_terminal_started_idx on public.shifts(terminal_id, started_at desc);

-- DEMO için RLS kapalı (anon key ile REST çalışsın diye).
alter table public.terminals disable row level security;
alter table public.users disable row level security;
alter table public.shifts disable row level security;
`;

function ensurePWA(){
  if("serviceWorker" in navigator){
    navigator.serviceWorker.register("./sw.js").catch(()=>{});
  }
}

let deferredPrompt=null;
window.addEventListener("beforeinstallprompt", (e)=>{
  e.preventDefault();
  deferredPrompt = e;
  $("#btnInstall").style.display="";
});
$("#btnInstall").addEventListener("click", async ()=>{
  if(!deferredPrompt) return;
  deferredPrompt.prompt();
  deferredPrompt=null;
  $("#btnInstall").style.display="none";
});

async function loadTerminals(){
  try{
    const rows = await sbFetch(`terminals?select=id,name&order=name.asc`, { method:"GET" });
    state.terminals = rows || [];
    const sel1=$("#pTerminal"), sel2=$("#aTermSel"), sel3=$("#eTerminal");
    [sel1,sel2,sel3].forEach(sel=>{
      sel.innerHTML = "";
      const opt0=document.createElement("option");
      opt0.value=""; opt0.textContent="Seçiniz...";
      sel.appendChild(opt0);
      state.terminals.forEach(t=>{
        const o=document.createElement("option");
        o.value=t.id; o.textContent=t.name;
        sel.appendChild(o);
      });
    });
    $("#kpiTerm").textContent = String(state.terminals.length);
  }catch(e){
    $("#kpiTerm").textContent = "—";
  }
}

async function loadUsers(){
  try{
    const rows = await sbFetch(`users?select=id,phone,name,role,is_owner&order=created_at.asc`, { method:"GET" });
    state.users = rows || [];
    $("#kpiUsers").textContent = String(state.users.length);

    const aPerson=$("#aPerson");
    aPerson.innerHTML="";
    const opt0=document.createElement("option");
    opt0.value=""; opt0.textContent="Seçiniz...";
    aPerson.appendChild(opt0);
    state.users.filter(u=>u.role==="personel").forEach(u=>{
      const o=document.createElement("option");
      o.value=u.id; o.textContent=`${u.name} (${u.phone})`;
      aPerson.appendChild(o);
    });
  }catch(e){
    $("#kpiUsers").textContent="—";
  }
}

async function countToday(){
  try{
    const d=fmtDate(new Date());
    const start = new Date(d+"T00:00:00");
    const end = new Date(d+"T23:59:59");
    const q = `shifts?select=id&started_at=gte.${start.toISOString()}&started_at=lte.${end.toISOString()}`;
    const rows = await sbFetch(q, { method:"GET" });
    $("#kpiShift").textContent = String(rows.length);
  }catch(e){
    $("#kpiShift").textContent="—";
  }
}

/* Auth */
async function login(role, phoneRaw, pinRaw){
  const phone = normalizePhone(phoneRaw);
  const pin = (pinRaw||"").trim();
  if(!phone || !pin) throw new Error("Telefon ve PIN zorunlu.");
  const rows = await sbFetch(`users?select=id,phone,name,role,is_owner,pin&phone=eq.${encodeURIComponent(phone)}`, { method:"GET" });
  const u = rows?.[0];
  if(!u) throw new Error("Bu telefon tanımlı değil. Admin eklemeli.");
  if(u.role !== role) throw new Error("Rol uyuşmuyor. Modu kontrol edin.");
  if(u.pin !== pin) throw new Error("PIN hatalı.");
  state.user = { id:u.id, phone:u.phone, name:u.name, role:u.role, is_owner:!!u.is_owner };
  sessionSet({ userId:u.id, role:u.role, phone:u.phone });
  renderWho();
  await afterLogin();
}

async function restoreSession(){
  const s=sessionGet();
  if(!s) return false;
  try{
    const rows = await sbFetch(`users?select=id,phone,name,role,is_owner&phone=eq.${encodeURIComponent(s.phone)}`, { method:"GET" });
    const u=rows?.[0];
    if(!u) { sessionClear(); return false; }
    state.user = { id:u.id, phone:u.phone, name:u.name, role:u.role, is_owner:!!u.is_owner };
    renderWho();
    await afterLogin();
    return true;
  }catch(e){
    return false;
  }
}

function renderWho(){
  if(!state.user){
    $("#whoTag").textContent = "—";
    $("#pUser").textContent = "—";
    $("#aUser").textContent = "—";
    return;
  }
  const crown = state.user.is_owner ? " 👑" : "";
  $("#whoTag").textContent = `${state.user.name}${crown} • ${state.user.role}`;
  $("#pUser").textContent = `${state.user.name}${crown} (${state.user.phone})`;
  $("#aUser").textContent = `${state.user.name}${crown} (${state.user.phone})`;
}

async function afterLogin(){
  await loadTerminals();
  await loadUsers();
  await countToday();

  if(state.user.role==="personel"){
    setView("personel");
    await personelRefresh();
  }else{
    setView("admin");
    adminDefaultDates();
  }
}

function adminDefaultDates(){
  const now = new Date();
  const to = fmtDate(now);
  const from = fmtDate(new Date(now.getTime()-6*24*3600*1000));
  $("#aFrom").value = from;
  $("#aTo").value = to;
}

/* Personel logic */
async function getOpenShift(userId){
  const rows = await sbFetch(`shifts?select=id,started_at,terminal_id&user_id=eq.${encodeURIComponent(userId)}&ended_at=is.null&order=started_at.desc&limit=1`, { method:"GET" });
  return rows?.[0] || null;
}

async function personelRefresh(){
  setErr($("#pErr"), "");
  if(!state.user) return;
  $("#pToday").value = fmtDT(new Date());
  state.openShift = await getOpenShift(state.user.id).catch(()=>null);
  $("#pHint").textContent = state.openShift
    ? `Açık mesai var: ${fmtDT(state.openShift.started_at)} (bitirmek için “Bitti”)`
    : "Açık mesai yok. Başlamak için “Başlandı”.";
  await personelLoadTable();
}

async function personelLoadTable(){
  const tbody = $("#pTable tbody");
  tbody.innerHTML = "";
  const rows = await sbFetch(`shifts?select=id,started_at,ended_at,terminal_id,start_lat,start_lng,end_lat,end_lng&user_id=eq.${encodeURIComponent(state.user.id)}&order=started_at.desc&limit=60`, { method:"GET" });
  let totalNet=0, totalLunch=0;
  for(const r of rows){
    const day = fmtDate(r.started_at);
    const start = fmtTime(r.started_at);
    const end = r.ended_at ? fmtTime(r.ended_at) : "—";
    const total = r.ended_at ? durMs(r.started_at, r.ended_at) : 0;
    const lunch = r.ended_at ? lunchMs(total) : 0;
    const net = r.ended_at ? (total - lunch) : 0;
    totalNet += net; totalLunch += lunch;
    const tr=document.createElement("tr");
    const termName = (state.terminals.find(t=>t.id===r.terminal_id)?.name) || "—";
    const loc = (r.start_lat && r.start_lng) ? `<a class="maplink" href="${mapsLink(r.start_lat,r.start_lng)}" target="_blank">Başlangıç</a>` : "—";
    tr.innerHTML = `
      <td>${day}</td>
      <td>${start}</td>
      <td>${end}</td>
      <td>${r.ended_at?msToHM(total):"—"}</td>
      <td>${r.ended_at?msToHM(lunch):"—"}</td>
      <td>${r.ended_at?msToHM(net):"—"}</td>
      <td>${termName}</td>
      <td>${loc}</td>
    `;
    tbody.appendChild(tr);
  }
  $("#pSum").textContent = rows.length ? `Net: ${msToHM(totalNet)} • Mola: ${msToHM(totalLunch)}` : "Kayıt yok";
}

async function personelStart(){
  setErr($("#pErr"), "");
  if(!state.user) return;
  if(state.openShift) throw new Error("Zaten açık mesai var. Önce bitirin.");
  const terminalId = $("#pTerminal").value;
  if(!terminalId) throw new Error("Terminal seçiniz.");
  const pos = await getGeo();
  $("#pGeoText").textContent = geoToText(pos);
  $("#pGeo").className = "tag ok"; $("#pGeo").textContent = "Konum: OK";
  const c = pos.coords;

  const payload = {
    user_id: state.user.id,
    terminal_id: terminalId,
    started_at: new Date().toISOString(),
    start_lat: c.latitude,
    start_lng: c.longitude,
    start_acc: c.accuracy
  };
  const inserted = await sbFetch("shifts", { method:"POST", body: JSON.stringify(payload) });
  state.openShift = inserted?.[0] || null;
  await personelRefresh();
}

async function personelEnd(){
  setErr($("#pErr"), "");
  if(!state.user) return;
  state.openShift = await getOpenShift(state.user.id).catch(()=>null);
  if(!state.openShift) throw new Error("Açık mesai yok.");
  const pos = await getGeo();
  $("#pGeoText").textContent = geoToText(pos);
  $("#pGeo").className = "tag ok"; $("#pGeo").textContent = "Konum: OK";
  const c=pos.coords;

  const patch = {
    ended_at: new Date().toISOString(),
    end_lat: c.latitude,
    end_lng: c.longitude,
    end_acc: c.accuracy
  };
  await sbFetch(`shifts?id=eq.${encodeURIComponent(state.openShift.id)}`, { method:"PATCH", body: JSON.stringify(patch) });
  state.openShift = null;
  await personelRefresh();
}

/* Admin reporting */
function dateRangeISO(from, to){
  const start = new Date(from + "T00:00:00");
  const end = new Date(to + "T23:59:59");
  return { startISO: start.toISOString(), endISO: end.toISOString() };
}

let lastAdminRows=[];

async function adminLoadRange(){
  setErr($("#aErr"), "");
  const personId=$("#aPerson").value;
  const termId=$("#aTermSel").value;
  const from=$("#aFrom").value;
  const to=$("#aTo").value;
  if(!from || !to) throw new Error("Tarih aralığı zorunlu.");
  const {startISO,endISO}=dateRangeISO(from,to);

  let q = `shifts?select=id,started_at,ended_at,terminal_id,user_id,start_lat,start_lng,end_lat,end_lng,note`;
  q += `&started_at=gte.${encodeURIComponent(startISO)}`;
  q += `&started_at=lte.${encodeURIComponent(endISO)}`;
  if(personId) q += `&user_id=eq.${encodeURIComponent(personId)}`;
  if(termId) q += `&terminal_id=eq.${encodeURIComponent(termId)}`;
  q += `&order=started_at.desc&limit=500`;

  const rows = await sbFetch(q, { method:"GET" });
  lastAdminRows = rows;
  renderAdminTable(rows);
  return rows;
}

function renderAdminTable(rows){
  const tbody=$("#aTable tbody");
  tbody.innerHTML="";
  let totalNet=0, totalLunch=0;
  for(const r of rows){
    const user = state.users.find(u=>u.id===r.user_id);
    const person = user ? `${user.name}${user.is_owner?" 👑":""}` : "—";
    const term = (state.terminals.find(t=>t.id===r.terminal_id)?.name) || "—";
    const total = r.ended_at ? durMs(r.started_at,r.ended_at) : 0;
    const lunch = r.ended_at ? lunchMs(total) : 0;
    const net = r.ended_at ? (total-lunch) : 0;
    totalNet += net; totalLunch += lunch;

    const sLoc = (r.start_lat && r.start_lng) ? `<a class="maplink" href="${mapsLink(r.start_lat,r.start_lng)}" target="_blank">Harita</a>` : "—";
    const eLoc = (r.end_lat && r.end_lng) ? `<a class="maplink" href="${mapsLink(r.end_lat,r.end_lng)}" target="_blank">Harita</a>` : "—";
    const tr=document.createElement("tr");
    tr.innerHTML = `
      <td>${fmtDate(r.started_at)}</td>
      <td>${person}</td>
      <td>${term}</td>
      <td>${fmtDT(r.started_at)}</td>
      <td>${r.ended_at?fmtDT(r.ended_at):'<span class="tag warn">Açık</span>'}</td>
      <td>${r.ended_at?msToHM(total):"—"}</td>
      <td>${r.ended_at?msToHM(lunch):"—"}</td>
      <td>${r.ended_at?msToHM(net):"—"}</td>
      <td>${sLoc}</td>
      <td>${eLoc}</td>
      <td><button class="btn" data-edit="${r.id}">Düzenle</button></td>
    `;
    tbody.appendChild(tr);
  }
  $("#aTotal").textContent = rows.length ? msToHM(totalNet) : "—";
  $("#aLunch").textContent = rows.length ? msToHM(totalLunch) : "—";
  $("#aCount").textContent = String(rows.length);

  $$("button[data-edit]", tbody).forEach(btn=>{
    btn.addEventListener("click", ()=> openEdit(btn.dataset.edit, rows.find(x=>x.id===btn.dataset.edit)));
  });
}

function rowsToCsv(rows){
  const head = ["date","person","terminal","started_at","ended_at","duration_min","lunch_min","net_min","start_lat","start_lng","end_lat","end_lng","note"];
  const lines=[head.join(",")];
  for(const r of rows){
    const user=state.users.find(u=>u.id===r.user_id);
    const term=(state.terminals.find(t=>t.id===r.terminal_id)?.name)||"";
    const total = r.ended_at ? Math.round(durMs(r.started_at,r.ended_at)/60000) : "";
    const lunch = r.ended_at ? Math.round(lunchMs(durMs(r.started_at,r.ended_at))/60000) : "";
    const net = r.ended_at ? (total - lunch) : "";
    const row=[
      fmtDate(r.started_at),
      user?user.name:"",
      term,
      r.started_at||"",
      r.ended_at||"",
      total,lunch,net,
      r.start_lat||"", r.start_lng||"",
      r.end_lat||"", r.end_lng||"",
      (r.note||"").replaceAll('"','""')
    ].map(v=>`"${String(v)}"`);
    lines.push(row.join(","));
  }
  return lines.join("\n");
}

function download(name, text){
  const blob=new Blob([text], {type:"text/plain;charset=utf-8"});
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a");
  a.href=url; a.download=name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/* Edit modal */
function openEdit(id, row){
  state.edit.shiftId=id;
  state.edit.row=row;
  $("#eStart").value = row.started_at ? row.started_at.slice(0,16) : "";
  $("#eEnd").value = row.ended_at ? row.ended_at.slice(0,16) : "";
  $("#eNote").value = row.note || "";
  $("#eTerminal").value = row.terminal_id || "";
  setErr($("#eErr"), "");
  $("#editModal").classList.add("on");
}
function closeEdit(){
  $("#editModal").classList.remove("on");
  state.edit.shiftId=null;
  state.edit.row=null;
}
async function saveEdit(){
  setErr($("#eErr"), "");
  if(!state.edit.shiftId) return;
  const s=$("#eStart").value.trim();
  const e=$("#eEnd").value.trim();
  if(!s) return setErr($("#eErr"), "Başlangıç zorunlu.");
  const started = new Date(s).toISOString();
  const ended = e ? new Date(e).toISOString() : null;
  const patch={
    started_at: started,
    ended_at: ended,
    terminal_id: $("#eTerminal").value || null,
    note: $("#eNote").value.trim() || null
  };
  await sbFetch(`shifts?id=eq.${encodeURIComponent(state.edit.shiftId)}`, { method:"PATCH", body: JSON.stringify(patch) });
  closeEdit();
  await adminLoadRange();
}

/* Admin management */
async function addUser(){
  setErr($("#userMgmtErr"), "");
  const phone=normalizePhone($("#newPhone").value);
  const name=$("#newName").value.trim();
  const role=$("#newRole").value;
  if(!phone || !name) throw new Error("Telefon ve ad soyad zorunlu.");
  const pin = last4(phone);
  const payload={ phone, name, role, pin, is_owner: false };
  await sbFetch("users", { method:"POST", body: JSON.stringify(payload) });
  $("#newPhone").value=""; $("#newName").value="";
  await loadUsers();
}
async function addTerminal(){
  setErr($("#termMgmtErr"), "");
  const name=$("#newTermName").value.trim();
  if(!name) throw new Error("Terminal adı zorunlu.");
  await sbFetch("terminals", { method:"POST", body: JSON.stringify({ name }) });
  $("#newTermName").value="";
  await loadTerminals();
}

async function seedOwners(){
  setErr($("#sqlErr"), "");
  const cfg=getCfg();
  const owners = cfg.owners || [];
  const existingTerms = await sbFetch("terminals?select=id&limit=1", { method:"GET" }).catch(()=>[]);
  if(!existingTerms.length){
    const sample=["1001 Derince Terminali","1011 Antalya Terminali","1005 Samsun Terminali"];
    for(const n of sample){ await sbFetch("terminals", { method:"POST", body: JSON.stringify({ name:n }) }); }
  }
  for(const o of owners){
    const phone=normalizePhone(o.phone);
    const pin=(o.pin||"").trim();
    if(!phone || !pin) continue;
    const name = "Beytullah Uzman";
    const rows = await sbFetch(`users?select=id&phone=eq.${encodeURIComponent(phone)}`, { method:"GET" });
    if(rows.length){
      await sbFetch(`users?phone=eq.${encodeURIComponent(phone)}`, { method:"PATCH", body: JSON.stringify({ role:"admin", is_owner:true, pin }) });
    }else{
      await sbFetch("users", { method:"POST", body: JSON.stringify({ phone, name, role:"admin", pin, is_owner:true }) });
    }
  }
  await loadUsers();
  await loadTerminals();
}

function setupSQLBox(){ $("#sqlBox").textContent = SQL; }

async function testCfg(){
  setErr($("#sqlErr"), "");
  try{
    await sbFetch("terminals?select=id&limit=1", { method:"GET" });
    setConn(true, "Açık");
    $("#cfgHint").textContent = "Bağlantı OK. SQL kurulumunu yaptıysanız giriş yapabilirsiniz.";
  }catch(e){
    setConn(false, "Kapalı");
    $("#cfgHint").textContent = "Bağlantı hatası: " + e.message;
    throw e;
  }
}

function requireAdmin(){
  if(!state.user || state.user.role!=="admin") throw new Error("Admin yetkisi gerekir.");
}

function bindNav(){
  $$("#nav button").forEach(btn=>{
    btn.addEventListener("click", async ()=>{
      const v=btn.dataset.view;
      if(v==="personel" && (!state.user || state.user.role!=="personel")) return setView("home");
      if(v==="admin" && (!state.user || state.user.role!=="admin")) return setView("home");
      setView(v);
      if(v==="ayar"){ setupSQLBox(); }
      if(v==="personel" && state.user?.role==="personel"){ await personelRefresh().catch(()=>{}); }
    });
  });
}

async function refreshKPIs(){
  await loadTerminals().catch(()=>{});
  await loadUsers().catch(()=>{});
  await countToday().catch(()=>{});
}

async function init(){
  ensurePWA();
  bindNav();
  setupSQLBox();

  const cfg=getCfg();
  const hasCfg=!!(cfg.supabaseUrl && cfg.supabaseKey);

  $("#setupNotice").style.display = hasCfg ? "none" : "";
  $("#cfgUrl").value = cfg.supabaseUrl || "";
  $("#cfgKey").value = cfg.supabaseKey || "";

  if(hasCfg){
    await testCfg().catch(()=>{});
    await refreshKPIs().catch(()=>{});
  }else{
    setConn(false, "Kapalı");
    $("#cfgHint").textContent = "Kurulum yok. Supabase URL + Public Key gir.";
  }

  if(hasCfg){
    const ok = await restoreSession();
    if(!ok) setView("home");
  }else{
    setView("ayar");
  }
  renderWho();
}

$("#btnLogout").addEventListener("click", ()=>{
  state.user=null; sessionClear();
  renderWho();
  setView("home");
});

$("#btnLogin").addEventListener("click", async ()=>{
  setErr($("#homeErr"), "");
  try{
    const role=$("#modeSel").value;
    await login(role, $("#phone").value, $("#pin").value);
    $("#pin").value="";
  }catch(e){
    setErr($("#homeErr"), e.message);
  }
});

$("#btnTestGeo").addEventListener("click", async ()=>{
  try{
    const pos=await getGeo();
    $("#geoText").textContent = geoToText(pos);
    $("#geoTag").className="tag ok"; $("#geoTag").textContent="Konum: OK";
  }catch(e){
    $("#geoText").textContent = e.message;
    $("#geoTag").className="tag bad"; $("#geoTag").textContent="Konum: HATA";
  }
});

$("#btnStart").addEventListener("click", async ()=>{
  try{ await personelStart(); }
  catch(e){ $("#pGeo").className="tag bad"; $("#pGeo").textContent="Konum: GEREKLİ"; setErr($("#pErr"), e.message); }
});
$("#btnEnd").addEventListener("click", async ()=>{
  try{ await personelEnd(); }
  catch(e){ $("#pGeo").className="tag bad"; $("#pGeo").textContent="Konum: GEREKLİ"; setErr($("#pErr"), e.message); }
});
$("#btnRefreshP").addEventListener("click", async ()=>{ await personelRefresh().catch(()=>{}); });

$("#btnLoadRange").addEventListener("click", async ()=>{
  try{ requireAdmin(); await adminLoadRange(); }
  catch(e){ setErr($("#aErr"), e.message); }
});
$("#btnExportCsv").addEventListener("click", async ()=>{
  try{
    requireAdmin();
    if(!lastAdminRows.length){ await adminLoadRange(); }
    const csv = rowsToCsv(lastAdminRows);
    download(`uzman_puantaj_${$("#aFrom").value}_${$("#aTo").value}.csv`, csv);
  }catch(e){ setErr($("#aErr"), e.message); }
});

$("#btnAddUser").addEventListener("click", async ()=>{
  try{ requireAdmin(); await addUser(); }
  catch(e){ setErr($("#userMgmtErr"), e.message); }
});
$("#btnAddTerm").addEventListener("click", async ()=>{
  try{ requireAdmin(); await addTerminal(); }
  catch(e){ setErr($("#termMgmtErr"), e.message); }
});

$("#btnDangerReset").addEventListener("click", ()=>{
  if(!confirm("Bu cihazdaki kurulum ve oturum temizlenecek. Emin misiniz?")) return;
  sessionClear(); STORE.del(CFG_KEY); location.reload();
});

$("#btnSaveCfg").addEventListener("click", ()=>{
  const cfg=getCfg();
  cfg.supabaseUrl = $("#cfgUrl").value.trim();
  cfg.supabaseKey = $("#cfgKey").value.trim();
  setCfg(cfg);
  $("#cfgHint").textContent = "Kaydedildi. Bağlantıyı test edin.";
  $("#setupNotice").style.display = (cfg.supabaseUrl && cfg.supabaseKey) ? "none" : "";
});

$("#btnTestCfg").addEventListener("click", async ()=>{ await testCfg().catch(()=>{}); await refreshKPIs().catch(()=>{}); });

$("#btnCopySql").addEventListener("click", async ()=>{
  try{ await navigator.clipboard.writeText(SQL); $("#cfgHint").textContent = "SQL panoya kopyalandı."; }
  catch(e){ $("#cfgHint").textContent = "Kopyalama başarısız. SQL kutusundan manuel kopyalayın."; }
});

$("#btnSeedOwners").addEventListener("click", async ()=>{
  try{ await seedOwners(); $("#cfgHint").textContent = "Sahip adminler oluşturuldu/ güncellendi."; }
  catch(e){ setErr($("#sqlErr"), e.message); }
});

$("#btnCloseEdit").addEventListener("click", closeEdit);
$("#btnSaveEdit").addEventListener("click", async ()=>{
  try{ requireAdmin(); await saveEdit(); }
  catch(e){ setErr($("#eErr"), e.message); }
});

setInterval(()=>{
  if(state.user?.role==="personel") $("#pToday").value = fmtDT(new Date());
  if(state.view==="admin" && state.user?.role!=="admin") setView("home");
  if(state.view==="personel" && state.user?.role!=="personel") setView("home");
}, 1200);

init().catch(err=>{
  setConn(false,"Kapalı");
  $("#cfgHint").textContent = "Başlatma hatası: " + err.message;
});
