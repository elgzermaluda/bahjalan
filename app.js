// ═══════════════════════════════════════
//  BAH, JALAN MANA? — app.js
// ═══════════════════════════════════════

const K = { user:'bjm_user', repo:'bjm_repo', token:'bjm_token', profiles:'bjm_profiles', active:'bjm_active', mode:'bjm_mode' };
const getUser = () => localStorage.getItem(K.user)||'';
const getRepo = () => localStorage.getItem(K.repo)||'bahjalan';
const getToken = () => localStorage.getItem(K.token)||'';
const getProfiles = () => { try { return JSON.parse(localStorage.getItem(K.profiles))||[]; } catch { return []; } };
const saveProfiles = p => localStorage.setItem(K.profiles, JSON.stringify(p));
const getActive = () => localStorage.getItem(K.active)||'';
const setActive = f => localStorage.setItem(K.active, f);
const getMode = () => localStorage.getItem(K.mode)||'makan';
const setMode_ = m => localStorage.setItem(K.mode, m);

// ── STATE ─────────────────────────────
let map, userMarker, radiusCircle;
let uLat = 3.139, uLng = 101.687;
let places = [];
let markers = {};
let lines = [];
let showEvOnMap = true;
let showLabels = true;
let fs = { cat:'all', tags:[], dmode:'r', km:12, min:20 };
let curMode = 'makan';
let curCat2 = 'activity';
let editId = null;
let delTargetId = null;
let delTimer = null;
let profImportData = null;
let profEditFile = null; // when editing existing profile name
const routeCache = {};

// ── INIT ──────────────────────────────
// inject spin keyframe
(function(){const s=document.createElement('style');s.textContent='@keyframes spin{to{transform:rotate(360deg)}}';document.head.appendChild(s);})();

window.onload = async () => {
  curMode = getMode();
  applyMode(curMode, false);
  initMap();
  if (!getUser()) await showSetup();
  await migrateOldData();
  const active = getActive();
  if (active) { await loadData(active); updateProfileDisplay(active); }
  else updateProfileDisplay(null);
  renderFpTags(); renderPlaces(); renderDrop();
};

function initMap() {
  map = L.map('map',{zoomControl:false}).setView([uLat,uLng],13);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',{attribution:'© OpenStreetMap © CARTO',subdomains:'abcd',maxZoom:19}).addTo(map);
  L.control.zoom({position:'topright'}).addTo(map);
  placeUserPin(uLat,uLng);
}

// ── MODE ──────────────────────────────
function switchMode(m) {
  if (m === curMode) return;
  curMode = m; setMode_(m);
  applyMode(m, true);
  // clear current profile — switch to first profile of new mode
  const profiles = getProfiles().filter(p => p.mode === m);
  if (profiles.length) {
    setActive(profiles[0].file);
    loadData(profiles[0].file).then(() => { updateProfileDisplay(profiles[0].file); renderFpTags(); renderPlaces(); });
  } else {
    setActive(''); places = [];
    updateProfileDisplay(null); renderFpTags(); renderPlaces();
  }
  renderDrop();
}

function applyMode(m, animate) {
  document.body.classList.toggle('jalan', m === 'jalan');
  document.getElementById('mb-m').classList.toggle('on', m === 'makan');
  document.getElementById('mb-j').classList.toggle('on', m === 'jalan');
  // strip title
  const st = document.getElementById('strip-title');
  if (st) st.textContent = m === 'makan' ? 'makan mana' : 'jalan mana';
  // filter: show category row only in jalan
  const catrow = document.getElementById('fp-catrow');
  if (catrow) catrow.style.display = m === 'jalan' ? '' : 'none';
  // events button only in jalan
  const evbtn = document.getElementById('evtogbtn');
  if (evbtn) evbtn.style.display = m === 'jalan' ? 'flex' : 'none';
  // reset cat filter when switching
  fs.cat = 'all'; fs.tags = [];
  const catv = document.getElementById('fpcatv');
  if (catv) catv.textContent = 'all';
  document.querySelectorAll('#catseg .segb').forEach((b,i) => b.classList.toggle('on', i===0));
}

// ── PROFILE DROPDOWN ─────────────────
function toggleDrop() {
  const dd = document.getElementById('pdrop');
  const bd = document.getElementById('dropback');
  const c  = document.getElementById('pcaret');
  const open = dd.classList.contains('open');
  if (open) { dd.classList.remove('open'); bd.style.display='none'; c.classList.remove('open'); }
  else { renderDrop(); dd.classList.add('open'); bd.style.display='block'; c.classList.add('open'); }
}
function closeDrop() {
  document.getElementById('pdrop').classList.remove('open');
  document.getElementById('dropback').style.display='none';
  document.getElementById('pcaret').classList.remove('open');
}

function renderDrop() {
  const profiles = getProfiles().filter(p => p.mode === curMode);
  const active   = getActive();
  const bar      = document.getElementById('pd-bar');
  const list     = document.getElementById('pd-list');
  const delbtn   = document.getElementById('pd-delbtn');
  if (bar) { bar.textContent = curMode === 'makan' ? '🍴 Makan Mana maps' : '🗺️ Jalan Mana maps'; bar.className = 'pd-bar ' + curMode; }
  delbtn.style.display = (active && profiles.find(p=>p.file===active)) ? 'block' : 'none';
  if (!profiles.length) { list.innerHTML = '<div class="pd-empty">no maps yet — create one below</div>'; return; }
  list.innerHTML = profiles.map(p => `
    <div class="pdi ${p.file===active?'active':''}" onclick="switchProfile('${p.file}')">
      <div class="pd-dot ${p.file===active?'':'dim'}"></div>
      <div class="pdi-info">
        <div class="pdi-name">${p.name}</div>
        <div class="pdi-file">${p.file}</div>
      </div>
      <div class="pdi-cnt" id="pdcnt-${p.file.replace(/\W/g,'_')}">—</div>
      <div class="pdi-edit" onclick="event.stopPropagation();editProfile('${p.file}')">rename</div>
    </div>`).join('');
  // async counts
  profiles.forEach(async p => {
    try {
      const tok2=getToken();
      const h2=tok2?{'Authorization':`token ${tok2}`,'Accept':'application/vnd.github.v3+json'}:{'Accept':'application/vnd.github.v3+json'};
      const r = await fetch(`https://api.github.com/repos/${getUser()}/${getRepo()}/contents/${p.file}`,{headers:h2});
      if (r.ok) { const meta2=await r.json(); const dec2=decodeURIComponent(escape(atob(meta2.content.replace(/\n/g,'')))); const d=JSON.parse(dec2); const n=(d.places||[]).length; const el=document.getElementById(`pdcnt-${p.file.replace(/\W/g,'_')}`); if(el) el.textContent=`${n} place${n!==1?'s':''}`; }
    } catch {}
  });
}

function updateProfileDisplay(file) {
  const el = document.getElementById('pname');
  if (!file) { el.textContent='pick a map…'; el.className='ph'; return; }
  const p = getProfiles().find(x=>x.file===file);
  if (p) { el.textContent=p.name; el.className=''; }
}

async function switchProfile(file) {
  closeDrop();
  setActive(file); updateProfileDisplay(file);
  clearMap();
  await loadData(file); renderFpTags(); renderPlaces();
}

function clearMap() {
  places=[]; Object.values(markers).forEach(m=>map.removeLayer(m)); markers={};
  lines.forEach(l=>map.removeLayer(l)); lines=[];
  Object.keys(routeCache).forEach(k=>delete routeCache[k]);
  fs.tags=[]; renderPlaces();
}

// ── PROFILE MODAL ─────────────────────
function openProfModal(mode) {
  closeDrop();
  profImportData = null; profEditFile = null;
  document.getElementById('pminp-name').value='';
  document.getElementById('pminp-file').value='';
  document.getElementById('pmerr').textContent='';
  document.getElementById('pmdroptext').innerHTML=`<span style="font-size:22px">📂</span><br><b style="color:var(--ink)">Saved Places.json</b> from Google Takeout<br><span style="font-size:10px">tap to choose or drag here</span>`;
  document.getElementById('pmfileinp').value='';
  document.getElementById('pmtit').textContent='new map';
  const badge = document.getElementById('pmbadge');
  badge.innerHTML = `<span class="mbadge ${curMode}">${curMode==='makan'?'🍴 Makan Mana':'🗺️ Jalan Mana'}</span>`;
  document.getElementById('profmod').classList.add('open');
  setTimeout(()=>document.getElementById('pminp-name').focus(),100);
  document.getElementById('pminp-name').oninput = function() {
    const slug = this.value.trim().toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
    document.getElementById('pminp-file').value = slug ? `${slug}-${curMode}.json` : '';
  };
}

function editProfile(file) {
  closeDrop();
  const p = getProfiles().find(x=>x.file===file);
  if (!p) return;
  profEditFile = file; profImportData = null;
  document.getElementById('pminp-name').value = p.name;
  document.getElementById('pminp-file').value = p.file;
  document.getElementById('pmerr').textContent='';
  document.getElementById('pmtit').textContent='rename map';
  const badge = document.getElementById('pmbadge');
  badge.innerHTML = `<span class="mbadge ${curMode}">${curMode==='makan'?'🍴 Makan Mana':'🗺️ Jalan Mana'}</span>`;
  // hide the import drop zone when editing
  document.getElementById('pmdrop').style.display='none';
  document.getElementById('profmod').classList.add('open');
  setTimeout(()=>document.getElementById('pminp-name').focus(),100);
}

function closeProfMod() {
  document.getElementById('profmod').classList.remove('open');
  document.getElementById('pmdrop').style.display='';
  profEditFile=null; profImportData=null;
}

function handleProfDrop(e) { e.preventDefault(); document.getElementById('pmdrop').classList.remove('drag'); const f=e.dataTransfer.files[0]; if(f) parseProfFile(f); }
function handleProfFile(inp) { const f=inp.files[0]; if(f) parseProfFile(f); }

function parseProfFile(file) {
  const r = new FileReader();
  r.onload = e => {
    try {
      const raw = JSON.parse(e.target.result);
      const feats = raw.features||(Array.isArray(raw)?raw:[]);
      const parsed = feats.filter(f=>f.geometry&&f.geometry.coordinates).map((f,i)=>{
        const p=f.properties||{}, c=f.geometry.coordinates;
        const name=(p['Title']||p['name']||(p['Location']&&p['Location']['Address'])||'Unnamed').trim();
        return {id:Date.now()+'_'+i, name, lat:parseFloat(c[1]), lng:parseFloat(c[0]), mapsUrl:p['Google Maps URL']||'', category:'eatery', tags:[], note:'', savedAt:new Date().toISOString()};
      }).filter(p=>p.lat&&p.lng&&!isNaN(p.lat)&&!isNaN(p.lng));
      if (!parsed.length) { document.getElementById('pmerr').textContent='no places found in that file'; return; }
      profImportData = parsed;
      document.getElementById('pmdroptext').innerHTML=`<span style="font-size:22px">✅</span><br><b style="color:var(--ink)">${parsed.length} places ready</b><br><span style="font-size:10px;color:var(--ink3)">all set as eateries — edit after creating</span>`;
    } catch { document.getElementById('pmerr').textContent="couldn't read file"; }
  };
  r.readAsText(file);
}

async function saveProfMod() {
  const name = document.getElementById('pminp-name').value.trim();
  const file = document.getElementById('pminp-file').value.trim();
  const err  = document.getElementById('pmerr');
  if (!name) { err.textContent='enter a name'; return; }

  // RENAME mode
  if (profEditFile) {
    const profiles = getProfiles();
    const idx = profiles.findIndex(p=>p.file===profEditFile);
    if (idx>-1) { profiles[idx].name=name; saveProfiles(profiles); }
    closeProfMod(); updateProfileDisplay(getActive()); renderDrop(); showToast('map renamed ✓');
    return;
  }

  // CREATE mode
  if (!file.endsWith('.json')) { err.textContent='file name must end in .json'; return; }
  if (!getUser()) { err.textContent='connect to GitHub first (tap ⚙)'; return; }
  const token = getToken();
  if (!token) { err.textContent='github token needed — tap ⚙'; return; }
  const profiles = getProfiles();
  if (profiles.find(p=>p.file===file)) { err.textContent='a map with that file name already exists'; return; }
  showToast('creating map…');
  const newPlaces = profImportData||[];
  const content = btoa(unescape(encodeURIComponent(JSON.stringify({places:newPlaces},null,2))));
  try {
    const res = await fetch(`https://api.github.com/repos/${getUser()}/${getRepo()}/contents/${file}`,{method:'PUT',headers:{'Authorization':`token ${token}`,'Accept':'application/vnd.github.v3+json','Content-Type':'application/json'},body:JSON.stringify({message:`Create map: ${name}`,content})});
    if (!res.ok) { const e=await res.json().catch(()=>{}); err.textContent='github error: '+(e?.message||res.status); return; }
  } catch { err.textContent='network error'; return; }
  profiles.push({name, file, mode:curMode});
  saveProfiles(profiles);
  closeProfMod();
  showToast(`"${name}" created ✓`);
  await switchProfile(file); renderDrop();
}

async function deleteCurrentProfile() {
  const active = getActive(); if (!active) return;
  const profiles = getProfiles();
  const p = profiles.find(x=>x.file===active);
  if (!confirm(`Delete the map "${p?.name||active}"?\n\nThis deletes ${active} from your GitHub repo. Cannot be undone.`)) return;
  closeDrop(); showToast('deleting…');
  const token=getToken();
  if (token) {
    try {
      const g=await fetch(`https://api.github.com/repos/${getUser()}/${getRepo()}/contents/${active}`,{headers:{'Authorization':`token ${token}`,'Accept':'application/vnd.github.v3+json'}});
      if (g.ok) { const j=await g.json(); await fetch(`https://api.github.com/repos/${getUser()}/${getRepo()}/contents/${active}`,{method:'DELETE',headers:{'Authorization':`token ${token}`,'Accept':'application/vnd.github.v3+json','Content-Type':'application/json'},body:JSON.stringify({message:`Delete map: ${active}`,sha:j.sha})}); }
    } catch {}
  }
  saveProfiles(profiles.filter(x=>x.file!==active));
  setActive(''); places=[];
  updateProfileDisplay(null); renderPlaces(); renderFpTags(); renderDrop();
  showToast('map deleted');
}

// ── MIGRATE OLD data.json ─────────────
async function migrateOldData() {
  if (!getUser()) return;
  const profiles = getProfiles();
  // check if data.json already migrated
  if (profiles.find(p=>p.file==='data.json'||p.file==='makan.json'||p.file==='jalan.json')) return;
  try {
    const tok3=getToken();
    const h3=tok3?{'Authorization':`token ${tok3}`,'Accept':'application/vnd.github.v3+json'}:{'Accept':'application/vnd.github.v3+json'};
    const res = await fetch(`https://api.github.com/repos/${getUser()}/${getRepo()}/contents/data.json`,{headers:h3});
    if (!res.ok) return;
    const meta3=await res.json();
    const d = JSON.parse(decodeURIComponent(escape(atob(meta3.content.replace(/\n/g,'')))));
    const all = d.places||[];
    if (!all.length) return;
    const makanPlaces = all.filter(p=>p.category==='eatery');
    const jalanPlaces = all.filter(p=>p.category!=='eatery');
    const token = getToken();
    showToast('migrating your places…');
    // write makan.json
    if (makanPlaces.length && token) {
      const content = btoa(unescape(encodeURIComponent(JSON.stringify({places:makanPlaces},null,2))));
      await fetch(`https://api.github.com/repos/${getUser()}/${getRepo()}/contents/makan.json`,{method:'PUT',headers:{'Authorization':`token ${token}`,'Accept':'application/vnd.github.v3+json','Content-Type':'application/json'},body:JSON.stringify({message:'Migrate: create makan.json',content})}).catch(()=>{});
      profiles.push({name:'My Places',file:'makan.json',mode:'makan'});
    }
    // write jalan.json
    if (jalanPlaces.length && token) {
      const content = btoa(unescape(encodeURIComponent(JSON.stringify({places:jalanPlaces},null,2))));
      await fetch(`https://api.github.com/repos/${getUser()}/${getRepo()}/contents/jalan.json`,{method:'PUT',headers:{'Authorization':`token ${token}`,'Accept':'application/vnd.github.v3+json','Content-Type':'application/json'},body:JSON.stringify({message:'Migrate: create jalan.json',content})}).catch(()=>{});
      profiles.push({name:'My Places',file:'jalan.json',mode:'jalan'});
    }
    // fallback if no token — just register data.json as makan
    if (!token) { profiles.push({name:'My Places',file:'data.json',mode:'makan'}); }
    saveProfiles(profiles);
    // set active to the mode we're currently in
    const modeFile = curMode==='makan' ? (makanPlaces.length?'makan.json':'') : (jalanPlaces.length?'jalan.json':'');
    if (modeFile) { setActive(modeFile); await loadData(modeFile); updateProfileDisplay(modeFile); }
    showToast('your places are back ✓');
  } catch(e) { console.warn('migrate error',e); }
}

// ── GITHUB STORAGE ────────────────────
async function loadData(file) {
  if (!file||!getUser()) { places=[]; return; }
  startProgress();
  showStripLoading('loading your places…');
  try {
    // Use GitHub API (not CDN) so we always get the latest file, not a cached version
    const tok = getToken();
    const headers = tok ? {'Authorization':`token ${tok}`,'Accept':'application/vnd.github.v3+json'} : {'Accept':'application/vnd.github.v3+json'};
    const r = await fetch(`https://api.github.com/repos/${getUser()}/${getRepo()}/contents/${file}`, {headers});
    if (!r.ok) {
      // file doesn't exist yet — that's fine for new profiles
      if(r.status===404){stopProgress(true);places=[];renderStrip([],new Set());return;}
      stopProgress(false); showToast(`load failed ${r.status}`); places=[]; renderStrip([],new Set()); return;
    }
    const meta = await r.json();
    // GitHub API returns base64 encoded content
    const decoded = decodeURIComponent(escape(atob(meta.content.replace(/\n/g,''))));
    const d = JSON.parse(decoded);
    places = d.places||[];
    stopProgress(true);
    showToast(`${places.length} place${places.length!==1?'s':''} loaded ✓`, true);
  } catch(e) { stopProgress(false); showToast('network error: '+e.message); places=[]; renderStrip([],new Set()); }
}

function showStripLoading(msg) {
  const list = document.getElementById('splist');
  if(list) list.innerHTML = `<div class="pcard empty" style="min-width:220px;display:flex;align-items:center;gap:8px"><div style="width:16px;height:16px;border-radius:50%;border:2px solid var(--A);border-top-color:transparent;animation:spin .7s linear infinite;flex-shrink:0"></div>${msg}</div>`;
}

function showSetup() {
  return new Promise(resolve=>{
    const ov=document.getElementById('tokov'); ov.classList.add('open');
    const ru=document.getElementById('setuprepo'); if(ru) ru.value=getRepo();
    setTimeout(()=>{const u=document.getElementById('setupuser');if(u)u.focus();},100);
    document.getElementById('toksave').onclick=()=>{
      const user=(document.getElementById('setupuser').value||'').trim();
      const repo=(document.getElementById('setuprepo').value||'').trim()||'bahjalan';
      const tok=(document.getElementById('tokinp').value||'').trim();
      const err=document.getElementById('tokerr');
      if(!user){err.textContent='enter your github username';return;}
      if(tok&&!tok.startsWith('ghp_')&&!tok.startsWith('github_pat_')){err.textContent='token should start with ghp_ or github_pat_';return;}
      localStorage.setItem(K.user,user); localStorage.setItem(K.repo,repo);
      if(tok) localStorage.setItem(K.token,tok);
      ov.classList.remove('open'); resolve();
    };
    document.getElementById('tokcancel').onclick=()=>{ov.classList.remove('open');resolve();};
    document.getElementById('tokinp').onkeydown=e=>{if(e.key==='Enter')document.getElementById('toksave').click();};
  });
}

function askToken() {
  return new Promise(resolve=>{
    const ov=document.getElementById('tokov'); ov.classList.add('open');
    document.getElementById('tokinp').value='';
    document.getElementById('tokerr').textContent='token rejected — paste a new one';
    setTimeout(()=>document.getElementById('tokinp').focus(),100);
    document.getElementById('toksave').onclick=()=>{
      const tok=(document.getElementById('tokinp').value||'').trim();
      const err=document.getElementById('tokerr');
      if(!tok){err.textContent='paste your token';return;}
      if(!tok.startsWith('ghp_')&&!tok.startsWith('github_pat_')){err.textContent='should start with ghp_ or github_pat_';return;}
      localStorage.setItem(K.token,tok); ov.classList.remove('open'); resolve(tok);
    };
    document.getElementById('tokcancel').onclick=()=>{ov.classList.remove('open');resolve(null);};
  });
}

async function saveData(retry=true) {
  const file = localStorage.getItem(K.active) || '';
  if(!file){showToast('no map selected — pick one first');return false;}
  let tok=getToken(); if(!tok){tok=await askToken();if(!tok)return false;}
  try {
    const url=`https://api.github.com/repos/${getUser()}/${getRepo()}/contents/${file}`;
    const gr=await fetch(url,{headers:{'Authorization':`token ${tok}`,'Accept':'application/vnd.github.v3+json'}});
    if(gr.status===401){localStorage.removeItem(K.token);if(retry){tok=await askToken();if(!tok)return false;return saveData(false);}return false;}
    let sha=null;
    if(gr.ok){const j=await gr.json();sha=j.sha;}
    else if(gr.status!==404){showToast(`read error ${gr.status} — check ⚙`);return false;}
    const content=btoa(unescape(encodeURIComponent(JSON.stringify({places},null,2))));
    const pr=await fetch(url,{method:'PUT',headers:{'Authorization':`token ${tok}`,'Accept':'application/vnd.github.v3+json','Content-Type':'application/json'},body:JSON.stringify({message:'Update places',content,...(sha&&{sha})})});
    if(!pr.ok){const e=await pr.json().catch(()=>{});showToast('❌ save failed — '+(e?.message||pr.status));return false;}
    const prof=getProfiles().find(p=>p.file===file);
    showToast(`✓ saved to "${prof?.name||file}" — ${places.length} places`,true);
    return true;
  } catch(err){showToast('network error: '+err.message);return false;}
}

// ── USER LOCATION ─────────────────────
function placeUserPin(lat,lng) {
  if(userMarker) map.removeLayer(userMarker);
  const icon=L.divIcon({className:'',html:`<div style="width:36px;height:36px;border-radius:50%;background:#1a1a2e;border:3px solid #fff;box-shadow:0 2px 10px rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;font-size:18px;cursor:grab" title="drag to move">🧍</div>`,iconSize:[36,36],iconAnchor:[18,18]});
  userMarker=L.marker([lat,lng],{icon,draggable:true}).addTo(map);
  userMarker.on('drag',()=>{const p=userMarker.getLatLng();uLat=p.lat;uLng=p.lng;updateRC();});
  userMarker.on('dragend',()=>{const p=userMarker.getLatLng();uLat=p.lat;uLng=p.lng;Object.keys(routeCache).forEach(k=>delete routeCache[k]);renderPlaces();showToast('location moved ✓');});
  updateRC();
}

function useGPS() {
  if(!navigator.geolocation){openManLoc();return;}
  showToast('getting GPS…');
  navigator.geolocation.getCurrentPosition(pos=>{uLat=pos.coords.latitude;uLng=pos.coords.longitude;map.setView([uLat,uLng],14);placeUserPin(uLat,uLng);Object.keys(routeCache).forEach(k=>delete routeCache[k]);renderPlaces();showToast('location updated ✓');},()=>{showToast('GPS failed — enter manually');setTimeout(openManLoc,600);},{timeout:8000});
}

function openManLoc() {
  const ov=document.getElementById('manlocov'); ov.classList.add('open');
  document.getElementById('manlocinp').value=''; document.getElementById('manlocerr').textContent='';
  document.getElementById('manlocres').style.display='none';
  setTimeout(()=>document.getElementById('manlocinp').focus(),100);
}

async function searchManLoc() {
  const q=document.getElementById('manlocinp').value.trim();
  const err=document.getElementById('manlocerr');
  if(!q){err.textContent='enter a place name';return;}
  const btn=document.getElementById('manlocbtn'); btn.textContent='searching…';
  try {
    const r=await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=5`,{headers:{'Accept-Language':'en','User-Agent':'BahJalanMana/1.0'}});
    const data=await r.json();
    if(!data.length){err.textContent='place not found';btn.textContent='search';return;}
    const res=document.getElementById('manlocres');
    res.innerHTML=data.map(x=>`<div onclick="setManLoc(${x.lat},${x.lon},'${x.display_name.split(',')[0].replace(/'/g,'')}')" style="padding:8px 10px;border-bottom:1px solid var(--border);cursor:pointer;font-size:12px" onmouseover="this.style.background='var(--cream2)'" onmouseout="this.style.background=''"><div style="font-weight:500">${x.display_name.split(',')[0]}</div><div style="font-size:10px;color:var(--ink3)">${x.display_name.split(',').slice(1,3).join(',')}</div></div>`).join('');
    res.style.display='block';
  } catch {err.textContent='search failed';}
  btn.textContent='search';
}

function setManLoc(lat,lng,name) {
  uLat=parseFloat(lat);uLng=parseFloat(lng);
  document.getElementById('manlocov').classList.remove('open');
  map.setView([uLat,uLng],14); placeUserPin(uLat,uLng);
  Object.keys(routeCache).forEach(k=>delete routeCache[k]);
  renderPlaces(); showToast(`location set to ${name} ✓`);
}

function updateRC() {
  if(radiusCircle) map.removeLayer(radiusCircle);
  if(fs.dmode==='r'||fs.dmode==='b') radiusCircle=L.circle([uLat,uLng],{radius:fs.km*1000,color:'#7C3AED',fillColor:'#7C3AED',fillOpacity:.05,weight:2,dashArray:'6 5'}).addTo(map);
}

// ── URL EXTRACTION ────────────────────
let exLat=null,exLng=null,exName=null,exUrl=null;

function onUrlInp(v) { if(v.length>10){const b=document.getElementById('bget');b.textContent='get info';b.classList.remove('loading');} }

async function extractUrl() {
  const raw=document.getElementById('urlinp').value.trim(); if(!raw){showToast('paste a link first');return;}
  const btn=document.getElementById('bget'); btn.textContent='loading…'; btn.classList.add('loading');
  exLat=null;exLng=null;exName=null;exUrl=raw;
  let url=raw;
  if(raw.includes('goo.gl')||raw.includes('maps.app')) {
    try { const r=await fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(raw)}`); const d=await r.json(); const fu=d.status?.url||''; if(fu.includes('google.com/maps')) url=fu; else { const m=d.contents?.match(/href="(https:\/\/www\.google\.com\/maps\/[^"]+)"/); if(m) url=m[1]; } } catch {}
    if(!url.includes('google.com/maps')) { try { const r=await fetch(`https://corsproxy.io/?${encodeURIComponent(raw)}`); const t=await r.text(); const m=t.match(/https:\/\/www\.google\.com\/maps\/place\/[^\s"']+/); if(m) url=m[0]; } catch {} }
  }
  const cm=url.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/); if(cm){exLat=parseFloat(cm[1]);exLng=parseFloat(cm[2]);}
  const pm=url.match(/\/place\/([^/@?&]+)/);
  if(pm){exName=decodeURIComponent(pm[1].replace(/\+/g,' ')).replace(/_/g,' ').trim();if(exName.includes(','))exName=exName.split(',')[0].trim();}
  if(!exName){const qm=url.match(/[?&]q=([^&]+)/);if(qm)exName=decodeURIComponent(qm[1].replace(/\+/g,' '));}
  if(!exLat&&exName){try{const r=await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(exName)}&format=json&limit=1`,{headers:{'Accept-Language':'en','User-Agent':'BahJalanMana/1.0'}});const d=await r.json();if(d.length){exLat=parseFloat(d[0].lat);exLng=parseFloat(d[0].lon);}}catch{}}
  btn.textContent='get info'; btn.classList.remove('loading');
  const ne=document.getElementById('exname'), ce=document.getElementById('excoords');
  if(exLat&&exLng){ne.textContent=exName||'name not found';ne.className='rv got';ce.textContent=`${exLat.toFixed(5)}° N, ${exLng.toFixed(5)}° E`;ce.className='rv got';map.setView([exLat,exLng],15);showToast('place found ✓');}
  else{ne.textContent='could not read link — try the full browser URL';ne.className='rv auto';ce.textContent='—';ce.className='rv auto';showToast('try the full URL from your browser');}
}

// ── SAVE PANEL ────────────────────────
function openSavePanel() {
  if(!getActive()){showToast('pick a map first');toggleDrop();return;}
  editId=null; exLat=null;exLng=null;exName=null;exUrl=null;
  document.getElementById('urlinp').value='';
  document.getElementById('exname').textContent='— paste a link above'; document.getElementById('exname').className='rv auto';
  document.getElementById('excoords').textContent='— from link'; document.getElementById('excoords').className='rv auto';
  document.getElementById('pnote').value='';
  clearEvFields(); resetTags();
  // set initial category based on mode
  if(curMode==='makan'){curCat2='eatery';}else{curCat2='activity';setCat2('activity');}
  showSaveBlocks();
  goStep(1);
  document.getElementById('sptit').textContent='save a place';
  document.getElementById('sp').classList.add('open');
}

function closeSavePanel() { document.getElementById('sp').classList.remove('open'); editId=null; }

function showSaveBlocks() {
  // In makan: hide category picker, show eatery tags only
  // In jalan: show category picker, show activity/event tags
  document.getElementById('sp-catblock').style.display = curMode==='jalan'?'':'none';
  document.getElementById('eatblock').style.display    = curMode==='makan'?'':'none';
  document.getElementById('actblock').style.display    = (curMode==='jalan'&&curCat2==='activity')?'':'none';
  document.getElementById('evtblock').style.display    = (curMode==='jalan'&&curCat2==='event')?'':'none';
  document.getElementById('evfields').style.display    = (curMode==='jalan'&&curCat2==='event')?'':'none';
}

function setCat2(cat) {
  curCat2=cat;
  ['activity','event'].forEach(c=>document.getElementById(`cat-${c}`)?.classList.toggle('on',cat===c));
  showSaveBlocks();
}

function editPlace(id) {
  const p=places.find(x=>x.id===id); if(!p) return;
  map.closePopup(); editId=id;
  exLat=p.lat;exLng=p.lng;exName=p.name;exUrl=p.mapsUrl;
  document.getElementById('urlinp').value=p.mapsUrl||'';
  const ne=document.getElementById('exname'); ne.textContent=p.name; ne.className='rv got';
  const ce=document.getElementById('excoords'); ce.textContent=`${p.lat.toFixed(5)}° N, ${p.lng.toFixed(5)}° E`; ce.className='rv got';
  resetTags();
  if(curMode==='makan'){
    curCat2='eatery';
    document.querySelectorAll('#eatpre .ttag').forEach(t=>t.classList.remove('on'));
    (p.tags||[]).forEach(tag=>{let found=false;document.querySelectorAll('#eatpre .ttag').forEach(t=>{if(t.textContent.replace(' ×','').trim()===tag){t.classList.add('on');found=true;}});if(!found){const i=document.getElementById('eatinp');i.value=tag;addTag('eatpre','eatinp');}});
  } else {
    curCat2=p.category||'activity'; setCat2(curCat2);
    const preId=curCat2==='event'?'evtpre':'actpre';
    document.querySelectorAll(`#${preId} .ttag`).forEach(t=>t.classList.remove('on'));
    (p.tags||[]).forEach(tag=>{let found=false;document.querySelectorAll(`#${preId} .ttag`).forEach(t=>{if(t.textContent.replace(' ×','').trim()===tag){t.classList.add('on');found=true;}});if(!found){const inpId=curCat2==='event'?'evtinp':'actinp';const i=document.getElementById(inpId);i.value=tag;addTag(preId,inpId);}});
    if(p.category==='event'){
      const radio=document.querySelector(`input[name="evtype"][value="${p.eventType||'once'}"]`);if(radio)radio.checked=true;toggleEvType();
      if(p.eventDateStart)document.getElementById('evd1').value=p.eventDateStart;
      if(p.eventDateEnd)document.getElementById('evd2').value=p.eventDateEnd;
      if(p.eventDay!=null)document.getElementById('evday').value=p.eventDay;
      if(p.eventStart)document.getElementById('evt1').value=p.eventStart;
      if(p.eventEnd)document.getElementById('evt2').value=p.eventEnd;
    }
  }
  document.getElementById('pnote').value=p.note||'';
  showSaveBlocks();
  document.getElementById('sptit').textContent='edit place';
  goStep(1); document.getElementById('sp').classList.add('open');
}

function goStep(n) {
  [1,2].forEach(i=>{
    document.getElementById(`step${i}`).style.display=i===n?'flex':'none';
    const t=document.getElementById(`stab${i}`); t.classList.remove('on','done');
    if(i===n) t.classList.add('on'); else if(i<n) t.classList.add('done');
  });
}

function toggleEvType() {
  const rec=document.querySelector('input[name="evtype"]:checked')?.value==='recurring';
  document.getElementById('evonce').style.display=rec?'none':'flex';
  document.getElementById('evrecur').style.display=rec?'':'none';
}

function clearEvFields() {
  const o=document.querySelector('input[name="evtype"][value="once"]'); if(o) o.checked=true;
  ['evd1','evd2','evt1','evt2'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
  const d=document.getElementById('evday');if(d)d.value='6';
  toggleEvType();
}

function addTag(preId,inpId) {
  const inp=document.getElementById(inpId); const val=inp.value.trim(); if(!val) return;
  const t=document.createElement('div'); t.className='ttag cust on';
  const rm=document.createElement('span'); rm.textContent=' ×'; rm.style.cssText='cursor:pointer;opacity:.6;font-size:10px';
  rm.onclick=e=>{e.stopPropagation();t.remove();}; t.textContent=val; t.appendChild(rm);
  t.onclick=()=>t.classList.toggle('on');
  document.getElementById(preId).appendChild(t); inp.value='';
}

function resetTags() {
  document.querySelectorAll('.ttag.cust').forEach(t=>t.remove());
  document.querySelectorAll('.ttag').forEach(t=>t.classList.toggle('on',['cafe','theme park','market'].includes(t.textContent.trim())));
}

function getSelectedTags(preId) {
  const tags=[]; document.querySelectorAll(`#${preId} .ttag.on`).forEach(t=>tags.push(t.textContent.replace(' ×','').trim())); return tags;
}

async function savePlace() {
  if(!exLat||!exLng){showToast('extract a link first (step 1)');return;}
  const preId=curMode==='makan'?'eatpre':(curCat2==='event'?'evtpre':'actpre');
  const tags=getSelectedTags(preId);
  const note=document.getElementById('pnote').value.trim();
  const name=exName||'unnamed place';
  const category=curMode==='makan'?'eatery':curCat2;
  let evType=null,evDay=null,evD1=null,evD2=null,evT1=null,evT2=null;
  if(category==='event'){
    evType=document.querySelector('input[name="evtype"]:checked')?.value||'once';
    evDay=evType==='recurring'?document.getElementById('evday').value:null;
    evD1=evType==='once'?document.getElementById('evd1').value:null;
    evD2=evType==='once'?document.getElementById('evd2').value:null;
    evT1=document.getElementById('evt1').value||null;
    evT2=document.getElementById('evt2').value||null;
  }
  const placeId = editId||Date.now().toString();
  const place={id:placeId,name,lat:exLat,lng:exLng,mapsUrl:exUrl,category,tags,note,...(category==='event'&&{eventType:evType,eventDay:evDay,eventDateStart:evD1,eventDateEnd:evD2,eventStart:evT1,eventEnd:evT2}),savedAt:new Date().toISOString(),_pending:true};
  if(editId) places=places.map(p=>p.id===editId?place:p); else places.unshift(place);
  // show only THIS place in the save queue
  showSaveQueue([name], null);
  const saveBtn=document.querySelector('#step2 .bpri');
  if(saveBtn){saveBtn.disabled=true;saveBtn.textContent='saving…';saveBtn.style.opacity='.6';}
  startProgress();
  renderPlaces(); // show immediately with pending spinner
  closeSavePanel();
  const ok=await saveData();
  stopProgress(ok);
  if(saveBtn){saveBtn.disabled=false;saveBtn.textContent='save to map ✓';saveBtn.style.opacity='';}
  if(ok){
    // clear pending flag
    places=places.map(p=>p.id===placeId?{...p,_pending:false}:p);
    showSaveQueue([name], true);
    renderPlaces(); renderFpTags();
  } else {
    hideSaveQueue();
    places=places.filter(p=>p.id!==placeId);
    renderPlaces();
  }
}

// ── DELETE MODAL ──────────────────────
function promptDel(id) {
  const p=places.find(x=>x.id===id); if(!p) return;
  map.closePopup(); delTargetId=id;
  document.getElementById('dmname').textContent=p.name;
  document.getElementById('dmdelbtn').disabled=true;
  document.getElementById('dmcd').textContent='wait 3 seconds…';
  document.getElementById('delmod').classList.add('open');
  let s=3; clearInterval(delTimer);
  delTimer=setInterval(()=>{s--;if(s<=0){clearInterval(delTimer);document.getElementById('dmdelbtn').disabled=false;document.getElementById('dmcd').textContent='';}else{document.getElementById('dmcd').textContent=`wait ${s} second${s!==1?'s':''}…`;}},1000);
}
function closeDelMod(){document.getElementById('delmod').classList.remove('open');clearInterval(delTimer);delTargetId=null;}
async function confirmDel(){if(!delTargetId)return;const id=delTargetId;closeDelMod();places=places.filter(p=>p.id!==id);showToast('removing…');await saveData();showToast('place removed ✓');renderPlaces();renderFpTags();}

// ── HAVERSINE & ROUTING ───────────────
function hav(a1,o1,a2,o2){const R=6371,dA=(a2-a1)*Math.PI/180,dO=(o2-o1)*Math.PI/180,a=Math.sin(dA/2)**2+Math.cos(a1*Math.PI/180)*Math.cos(a2*Math.PI/180)*Math.sin(dO/2)**2;return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));}

async function getRoute(lat,lng){
  const key=`${uLat.toFixed(4)},${uLng.toFixed(4)}-${lat.toFixed(4)},${lng.toFixed(4)}`;
  if(routeCache[key]) return routeCache[key];
  try {
    const r=await fetch(`https://router.project-osrm.org/route/v1/driving/${uLng},${uLat};${lng},${lat}?overview=full&geometries=geojson`);
    const d=await r.json();
    if(d.routes?.[0]){const route=d.routes[0];const res={minutes:Math.round(route.duration/60),coords:route.geometry.coordinates.map(c=>[c[1],c[0]])};routeCache[key]=res;return res;}
  } catch {}
  const km=hav(uLat,uLng,lat,lng);
  const res={minutes:Math.round((km/40)*60),coords:null};routeCache[key]=res;return res;
}

// ── RENDER PLACES ─────────────────────
async function renderPlaces() {
  Object.values(markers).forEach(m=>map.removeLayer(m)); markers={};
  lines.forEach(l=>map.removeLayer(l)); lines=[];
  updateRC();
  // filter by mode first
  const moded = places.filter(p=> curMode==='makan'?p.category==='eatery':(p.category==='activity'||p.category==='event'));
  const withDist = moded.map(p=>{const dist=hav(uLat,uLng,p.lat,p.lng);const ck=`${uLat.toFixed(4)},${uLng.toFixed(4)}-${p.lat.toFixed(4)},${p.lng.toFixed(4)}`;const c=routeCache[ck];return{...p,dist,travelMin:c?c.minutes:Math.round((dist/40)*60)};});
  const filtered = withDist.filter(p=>{
    if(curMode==='jalan'){if(fs.cat==='activity'&&p.category!=='activity')return false;if(fs.cat==='event'&&p.category!=='event')return false;}
    if(fs.tags.length>0&&!fs.tags.some(t=>p.tags?.includes(t)))return false;
    if((fs.dmode==='r'||fs.dmode==='b')&&p.dist>fs.km)return false;
    if((fs.dmode==='t'||fs.dmode==='b')&&p.travelMin>fs.min)return false;
    return true;
  });
  const matchIds = new Set(filtered.map(f=>f.id));
  withDist.forEach(p=>{if(p.category==='event'&&!showEvOnMap)return;addMarker(p,matchIds.has(p.id),p.dist,p.travelMin);});
  for(const p of filtered){
    if(p.category==='event'&&!showEvOnMap)continue;
    const lineColor=p.category==='eatery'?'#993C1D':p.category==='event'?'#D97706':'#5B21B6';
    const rd=await getRoute(p.lat,p.lng);
    const coords=rd.coords||[[uLat,uLng],[p.lat,p.lng]];
    const dash=!rd.coords;
    const cas=L.polyline(coords,{color:'#ffffff',weight:7,opacity:.85,...(dash?{dashArray:'8 6'}:{})}).addTo(map);
    const ln=L.polyline(coords,{color:lineColor,weight:4,opacity:.92,...(dash?{dashArray:'8 6'}:{})}).addTo(map);
    lines.push(cas,ln);
    if(showLabels){
      const mid=coords[Math.floor(coords.length/2)];
      const li=L.divIcon({className:'',html:`<div style="pointer-events:none;display:inline-block"><div style="background:#fff;border:2px solid ${lineColor};border-radius:8px;padding:5px 10px;font-family:'DM Sans',sans-serif;white-space:nowrap;box-shadow:0 2px 10px rgba(0,0,0,.22);text-align:center;line-height:1.3"><div style="font-size:12px;font-weight:700;color:${lineColor}">${rd.minutes} min</div><div style="font-size:10px;font-weight:500;color:#888">${p.dist.toFixed(1)} km</div></div></div>`,iconSize:[80,42],iconAnchor:[40,42]});
      lines.push(L.marker(mid,{icon:li,interactive:false}).addTo(map));
    }
  }
  renderStrip(withDist,matchIds);
  renderFpTags();
  if(document.getElementById('evpanel').classList.contains('open')) renderEvents();
}

function addMarker(place,isMatch,dist,travelMin){
  const isEat=place.category==='eatery',isEv=place.category==='event';
  const mc=isEat?'#993C1D':isEv?'#D97706':'#5B21B6';
  const mb=isEat?'#FAECE7':isEv?'#FEF3C7':'#EDE9FE';
  const emoji=isEat?'🍴':isEv?'📅':'⭐';
  const col=isMatch?mc:'#c8b8a0', bor=isMatch?mb:'#f0ebe3', sz=isMatch?32:26;
  const icon=L.divIcon({className:'',html:`<div style="width:${sz}px;height:${sz}px;border-radius:50%;background:${col};border:2.5px solid ${bor};box-shadow:0 2px 6px rgba(0,0,0,.22);display:flex;align-items:center;justify-content:center;font-size:${isMatch?14:10}px;opacity:${isMatch?1:.7}">${emoji}</div>`,iconSize:[sz,sz],iconAnchor:[sz/2,sz/2]});
  const m=L.marker([place.lat,place.lng],{icon}).addTo(map);
  const tcls=isEv?'ev':'';
  const tagsHtml=(place.tags||[]).map(t=>`<span class="poptag ${tcls}">${t}</span>`).join('');
  const href=place.mapsUrl||`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place.name)}`;
  const catLbl=isEat?'🍴 eatery':isEv?'📅 event':'⭐ activity';
  m.bindPopup(`<div class="popi"><div style="font-size:9px;color:${mc};font-weight:600;text-transform:uppercase;letter-spacing:.08em;margin-bottom:2px">${catLbl}</div><div class="popn">${place.name}</div><div class="popd">${dist.toFixed(1)} km · ~${travelMin} min drive</div>${place.note?`<div style="font-size:10px;color:var(--ink2);margin-top:3px;font-style:italic">${place.note}</div>`:''}<div class="poptags">${tagsHtml}</div><div class="popbtns"><a class="popbtn pri" href="${href}" target="_blank">open in maps</a><div class="popbtn" onclick="editPlace('${place.id}')">edit</div><div class="popbtn del" onclick="promptDel('${place.id}')">remove</div></div></div>`);
  markers[place.id]=m;
}

function renderStrip(all,matchIds){
  const list=document.getElementById('splist'), cnt=document.getElementById('spcnt');
  if(!all.length){list.innerHTML='<div class="pcard empty">no places yet — tap + save</div>';cnt.textContent='';return;}
  cnt.textContent=`${matchIds.size} / ${all.length}`;
  const sorted=[...all].sort((a,b)=>(matchIds.has(a.id)?0:1)-(matchIds.has(b.id)?0:1)||a.dist-b.dist);
  list.innerHTML=sorted.map(p=>{
    const isMatch=matchIds.has(p.id);
    const icon=p.category==='eatery'?'🍴':p.category==='event'?'📅':'⭐';
    const acol=p.category==='eatery'?'#993C1D':p.category==='event'?'#D97706':'#5B21B6';
    const tcls=p.category==='event'?'ev':'';
    const tags=(p.tags||[]).map(t=>`<span class="pctag ${tcls}">${t}</span>`).join('');
    const isPending = p._pending;
    return `<div class="pcard ${isMatch?'match':'faded'}" style="${isMatch?`border-color:${acol}40;`:''} ${isPending?'opacity:.75;':''}">
      <div style="display:flex;align-items:center;gap:5px;margin-bottom:3px" onclick="focusPlace('${p.id}')">
        <span style="font-size:13px">${icon}</span>
        <div class="pcn">${p.name}</div>
        ${isPending?`<div style="width:12px;height:12px;border-radius:50%;border:2px solid var(--A);border-top-color:transparent;animation:spin .7s linear infinite;flex-shrink:0;margin-left:auto"></div>`:''}
      </div>
      ${isPending?`<div style="font-size:10px;color:var(--ink3);margin-bottom:3px">saving…</div>`:`<div class="pcd" onclick="focusPlace('${p.id}')">${p.dist.toFixed(1)} km · ~${p.travelMin} min</div>`}
      <div class="pctags" onclick="focusPlace('${p.id}')">${tags}</div>
      <div style="display:flex;gap:4px;margin-top:6px">
        <div onclick="editPlace('${p.id}')" style="flex:1;text-align:center;font-size:10px;padding:3px 0;border:1px solid var(--border);border-radius:20px;color:var(--ink2);cursor:pointer;background:var(--cream)">edit</div>
        <div onclick="focusPlace('${p.id}')" style="flex:1;text-align:center;font-size:10px;padding:3px 0;border:1px solid var(--border);border-radius:20px;color:var(--ink2);cursor:pointer;background:var(--cream)">view</div>
      </div>
    </div>`;
  }).join('');
}

function focusPlace(id){const m=markers[id];if(m){map.setView(m.getLatLng(),15);m.openPopup();}}

// ── FILTER TAGS ───────────────────────
let tagsExpanded=false;
function renderFpTags(){
  const all=new Set();
  const moded=places.filter(p=>curMode==='makan'?p.category==='eatery':(p.category==='activity'||p.category==='event'));
  moded.forEach(p=>{if(fs.cat==='all'||p.category===fs.cat)(p.tags||[]).forEach(t=>all.add(t));});
  const wrap=document.getElementById('filter-tags'), active=new Set(fs.tags);
  wrap.innerHTML='';
  if(!all.size){wrap.innerHTML='<span style="font-size:11px;color:var(--ink3)">no tags yet</span>';updateTagsVal();return;}
  const arr=[...all]; const MAX=5; const vis=tagsExpanded?arr:arr.slice(0,MAX);
  vis.forEach(tag=>{const el=document.createElement('div');el.className='ftag'+(active.has(tag)?' on':'');el.textContent=tag;el.onclick=()=>{el.classList.toggle('on');if(el.classList.contains('on'))fs.tags.push(tag);else fs.tags=fs.tags.filter(t=>t!==tag);updateTagsVal();renderPlaces();};wrap.appendChild(el);});
  if(arr.length>MAX){const m=document.createElement('div');m.className='ftag';m.style.cssText='background:var(--cream2);color:var(--ink3);border-style:dashed';m.textContent=tagsExpanded?'less':`+${arr.length-MAX}`;m.onclick=()=>{tagsExpanded=!tagsExpanded;renderFpTags();};wrap.appendChild(m);}
  updateTagsVal();
}
function updateTagsVal(){const el=document.getElementById('fptagsv');if(el)el.textContent=fs.tags.length?fs.tags.length+' on':'';}

// ── FILTER CONTROLS ───────────────────
function toggleFps(tog){const b=tog.nextElementSibling,c=tog.querySelector('.fpc'),o=b.classList.contains('open');b.classList.toggle('open',!o);if(c)c.classList.toggle('open',!o);}
function setCat(cat,el){document.querySelectorAll('#catseg .segb').forEach(b=>b.classList.remove('on'));el.classList.add('on');fs.cat=cat;fs.tags=[];const v=document.getElementById('fpcatv');if(v)v.textContent=cat;renderFpTags();renderPlaces();}
function setDistMode(m){['r','t','b'].forEach(x=>document.getElementById(`mc-${x}`).classList.remove('on'));document.getElementById(`mc-${m}`).classList.add('on');document.getElementById('sl-r').classList.toggle('off',m==='t');document.getElementById('sl-t').classList.toggle('off',m==='r');document.getElementById('bnote').classList.toggle('show',m==='b');fs.dmode=m;renderPlaces();}
function updateSlider(type,val){if(type==='km'){fs.km=parseInt(val);document.getElementById('rvlbl').textContent=`${val} km`;const v=document.getElementById('fpdistv');if(v)v.textContent=`${val} km`;}else{fs.min=parseInt(val);document.getElementById('tvlbl').textContent=`${val} min`;}renderPlaces();}

// ── STRIP TOGGLE ──────────────────────
let stripOpen=false;
function toggleStrip(){stripOpen=!stripOpen;document.getElementById('spbody').classList.toggle('open',stripOpen);document.getElementById('spchev').classList.toggle('open',stripOpen);}

// ── EVENTS ────────────────────────────
const DAYS=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const MONTHS=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function getNextOcc(ev){
  const now=new Date();
  if(ev.eventType==='once'){if(!ev.eventDateStart)return null;const end=new Date((ev.eventDateEnd||ev.eventDateStart)+'T23:59:59');if(end<now)return null;return new Date(ev.eventDateStart+'T'+(ev.eventStart||'00:00'));}
  if(ev.eventType==='recurring'&&ev.eventDay!=null){const tgt=parseInt(ev.eventDay),d=new Date(now);d.setHours(0,0,0,0);const diff=(tgt-d.getDay()+7)%7;d.setDate(d.getDate()+(diff===0?0:diff));if(ev.eventStart){const[h,mn]=ev.eventStart.split(':').map(Number);d.setHours(h,mn,0,0);if(d<now)d.setDate(d.getDate()+7);}return d;}
  return null;
}

function fmtEvDate(ev,nd){
  if(!nd)return '';
  const now=new Date(),tod=new Date(now);tod.setHours(0,0,0,0);
  const dd=new Date(nd);dd.setHours(0,0,0,0);
  const diff=Math.round((dd-tod)/86400000);
  const tStr=(nd.getHours()||nd.getMinutes())?` · ${String(nd.getHours()).padStart(2,'0')}:${String(nd.getMinutes()).padStart(2,'0')}`:'';
  if(ev.eventDateEnd&&ev.eventDateEnd!==ev.eventDateStart){const s=new Date(ev.eventDateStart),e=new Date(ev.eventDateEnd);return `${s.getDate()} ${MONTHS[s.getMonth()]} – ${e.getDate()} ${MONTHS[e.getMonth()]}`;}
  if(diff===0)return`today${tStr}`;if(diff===1)return`tomorrow${tStr}`;if(diff<7)return`${DAYS[nd.getDay()]}${tStr}`;
  return`${nd.getDate()} ${MONTHS[nd.getMonth()]}${tStr}`;
}

function renderEvents(){
  const panel=document.getElementById('evpanel');
  const upcoming=places.filter(p=>p.category==='event').map(p=>({...p,_next:getNextOcc(p),_dist:hav(uLat,uLng,p.lat,p.lng)})).filter(p=>{if(!p._next)return false;if((fs.dmode==='r'||fs.dmode==='b')&&p._dist>fs.km)return false;return true;}).sort((a,b)=>a._next-b._next);
  const showAll=panel.dataset.all==='true', vis=showAll?upcoming:upcoming.slice(0,7);
  const list=document.getElementById('evlist'), moreBtn=document.getElementById('evmorebtn');
  if(!upcoming.length){list.innerHTML='<div style="font-size:12px;color:var(--ink3);text-align:center;padding:20px 0">no upcoming events</div>';moreBtn.style.display='none';return;}
  let html='',lastGrp='';
  vis.forEach(p=>{
    const ds=fmtEvDate(p,p._next),tod=new Date(),todH=new Date(tod);todH.setHours(0,0,0,0);
    const dd=new Date(p._next);dd.setHours(0,0,0,0);const diff=Math.round((dd-todH)/86400000);
    const grp=diff===0?'today':diff<=6?'this week':'coming up';
    if(grp!==lastGrp){html+=`<div style="font-size:9px;font-weight:600;color:var(--ink3);text-transform:uppercase;letter-spacing:.1em;padding:8px 0 4px">${grp}</div>`;lastGrp=grp;}
    const tags=(p.tags||[]).slice(0,2).map(t=>`<span style="font-size:9px;padding:1px 6px;border-radius:8px;background:#FEF3C7;color:#92400E;border:1px solid #FDE68A">${t}</span>`).join('');
    const recStr=p.eventType==='recurring'?`every ${DAYS[p.eventDay]}`:'';
    const tRange=[p.eventStart,p.eventEnd].filter(Boolean).join(' – ');
    html+=`<div onclick="focusPlace('${p.id}')" style="display:flex;align-items:flex-start;gap:10px;padding:9px 10px;background:var(--white);border:1px solid var(--border);border-radius:var(--radius-sm);cursor:pointer;margin-bottom:5px;transition:border-color .15s" onmouseover="this.style.borderColor='#D97706'" onmouseout="this.style.borderColor='var(--border)'"><div style="font-size:20px;flex-shrink:0;margin-top:1px">📅</div><div style="flex:1;min-width:0"><div style="font-size:12px;font-weight:500;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${p.name}</div><div style="font-size:11px;color:#D97706;font-weight:500;margin-top:1px">${ds}${tRange?' · '+tRange:''}</div>${recStr?`<div style="font-size:10px;color:var(--ink3)">${recStr}</div>`:''}<div style="display:flex;align-items:center;gap:6px;margin-top:4px;flex-wrap:wrap"><span style="font-size:10px;color:var(--ink3)">${p._dist.toFixed(1)} km away</span>${tags}</div></div></div>`;
  });
  list.innerHTML=html;
  if(upcoming.length>7&&!showAll){moreBtn.style.display='block';moreBtn.textContent=`see all ${upcoming.length} events`;}else moreBtn.style.display='none';
}

function toggleEvPanel(){const p=document.getElementById('evpanel');if(p.classList.contains('open'))p.classList.remove('open');else{p.dataset.all='false';renderEvents();p.classList.add('open');}}
function toggleEvOnMap(){showEvOnMap=!showEvOnMap;const b=document.getElementById('evmaptog');if(b){b.textContent=showEvOnMap?'📍 on map':'📍 hidden';b.style.background=showEvOnMap?'#FEF3C7':'var(--cream2)';b.style.borderColor=showEvOnMap?'#FDE68A':'var(--border)';b.style.color=showEvOnMap?'#92400E':'var(--ink3)';}renderPlaces();}
function toggleLabels(){showLabels=!showLabels;const b=document.getElementById('lblbtn');if(b){b.textContent=showLabels?'labels':'labels off';b.style.opacity=showLabels?'1':'.5';}renderPlaces();}

// ── IMPORT ────────────────────────────
let impPlaces=[],impState={};

function openImportPanel(){if(!getActive()){showToast('pick a map first');toggleDrop();return;}impPlaces=[];impState={};showImpStep(1);document.getElementById('imppanel').classList.add('open');}
function closeImp(){document.getElementById('imppanel').classList.remove('open');}
function showImpStep(n){const il=document.getElementById('imp-loading');if(il)il.style.display='none';document.getElementById('imps1').style.display=n===1?'flex':'none';document.getElementById('imps2').style.display=n===2?'flex':'none';document.getElementById('impsavewrap').style.display=n===2?'block':'none';document.getElementById('istep1').style.color=n===1?'var(--A)':'var(--green)';document.getElementById('istep1').style.borderBottomColor=n===1?'var(--A)':'var(--green)';document.getElementById('istep2').style.color=n===2?'var(--A)':'var(--ink3)';document.getElementById('istep2').style.borderBottomColor=n===2?'var(--A)':'transparent';}
function handleImpDrop(e){e.preventDefault();document.getElementById('impdrop').style.borderColor='var(--border)';document.getElementById('impdrop').style.background='var(--white)';const f=e.dataTransfer.files[0];if(f)parseImp(f);}
function handleImpFile(inp){const f=inp.files[0];if(f)parseImp(f);}

function parseImp(file){
  const r=new FileReader(); r.onload=async e=>{
    try {
      // Strip BOM and normalize line endings
      let raw = e.target.result.replace(/^\uFEFF/,'').replace(/\r\n/g,'\n').replace(/\r/g,'\n').trim();

      // Detect CSV/TSV FIRST (before any JSON.parse attempt)
      const firstLine = raw.split('\n')[0];
      // Support both tab-separated and comma-separated
      const sep = firstLine.includes('\t') ? '\t' : ',';
      const hasTitle = firstLine.toLowerCase().replace(/["\']/g,'').includes('title');

      if(hasTitle) {
        const lines = raw.split('\n').filter(l=>l.trim());
        const header = lines[0].split(sep).map(h=>h.trim().replace(/^["']|["']$/g,'').toLowerCase());
        const titleIdx = header.findIndex(h=>h==='title'||h==='name'||h==='place name');
        const urlIdx   = header.findIndex(h=>h==='url'||h==='link'||h==='google maps url');
        const noteIdx  = header.findIndex(h=>h==='note'||h==='notes'||h==='comment');
        if(titleIdx===-1){showToast('CSV: no Title column found');return;}
        const rows = lines.slice(1).filter(l=>{const c=l.split(sep);return c[titleIdx]&&c[titleIdx].trim().length>0;});
        if(!rows.length){showToast('no places found in file');return;}

        // Parse instantly — NO geocoding here, show list immediately
        const parsed = rows.map((row,i)=>{
          const cols = row.split(sep).map(c=>c.trim().replace(/^["']|["']$/g,''));
          const name = (cols[titleIdx]||'').trim();
          const url  = urlIdx>-1?(cols[urlIdx]||'').trim():'';
          const note = noteIdx>-1?(cols[noteIdx]||'').trim():'';
          // try coords in URL
          let lat=null,lng=null;
          const cm = url.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
          if(cm){lat=parseFloat(cm[1]);lng=parseFloat(cm[2]);}
          return {_id:'imp_'+i, name, lat, lng, mapsUrl:url, address: (!lat||!lng)?'\u26a0\ufe0f coords will be looked up on save':'', note, _noCoords:(!lat||!lng)};
        }).filter(p=>p.name);

        if(!parsed.length){showToast('no places found in file');return;}
        impPlaces=parsed;
        impPlaces.forEach(p=>{impState[p._id]={selected:true,category:curMode==='makan'?'eatery':'activity',tags:[]};});
        hideImpLoading(); renderImpList(); showImpStep(2);
        document.getElementById('imptotcnt').textContent=`${impPlaces.length} places found`;
        document.getElementById('impall').checked=true; updateImpCnt();
        const needsGeo = parsed.filter(p=>p._noCoords).length;
        showToast(`${impPlaces.length} places loaded ✓${needsGeo?' ('+needsGeo+' need location lookup)':''}`);
        return;
      }

      // Only try JSON if it didn't look like TSV
      let rawJ;
      try { rawJ=JSON.parse(raw); } catch(je) { showToast("couldn't read file — wrong format?"); return; }
      const feats=rawJ.features||(Array.isArray(rawJ)?rawJ:[]);
      impPlaces=feats.filter(f=>f.geometry&&f.geometry.coordinates).map((f,i)=>{
        const p=f.properties||{},c=f.geometry.coordinates;
        const name=(p['Title']||p['name']||(p['Location']&&p['Location']['Address'])||'Unnamed').trim();
        return{_id:'imp_'+i,name,lat:parseFloat(c[1]),lng:parseFloat(c[0]),mapsUrl:p['Google Maps URL']||'',address:p['Location']?.Address||''};
      }).filter(p=>p.lat&&p.lng&&!isNaN(p.lat)&&!isNaN(p.lng));
      if(!impPlaces.length){showToast('no places found in JSON');return;}
      impPlaces.forEach(p=>{impState[p._id]={selected:true,category:curMode==='makan'?'eatery':'activity',tags:[]};});
      renderImpList(); showImpStep(2);
      document.getElementById('imptotcnt').textContent=`${impPlaces.length} places found`;
      document.getElementById('impall').checked=true; updateImpCnt();
      showToast(`${impPlaces.length} places loaded ✓`);
    } catch(err){console.error(err);showToast("couldn't read file: "+err.message);}
  };r.readAsText(file);
}

function showImpLoading(total) {
  // Show a progress screen in the import panel instead of blocking
  document.getElementById('imps1').style.display='none';
  document.getElementById('imps2').style.display='none';
  let screen = document.getElementById('imp-loading');
  if(!screen){
    screen = document.createElement('div');
    screen.id = 'imp-loading';
    screen.style.cssText='flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:30px 20px;';
    document.getElementById('imppanel').appendChild(screen);
  }
  screen.style.display='flex';
  screen.innerHTML=`
    <div style="width:48px;height:48px;border-radius:50%;border:4px solid var(--As);border-top-color:var(--A);animation:spin .8s linear infinite"></div>
    <div style="text-align:center">
      <div style="font-size:14px;font-weight:500;color:var(--ink);margin-bottom:4px">looking up ${total} places</div>
      <div id="imp-load-status" style="font-size:12px;color:var(--ink3)">starting…</div>
    </div>
    <div style="width:100%;max-width:280px;background:var(--border);border-radius:100px;height:4px;overflow:hidden">
      <div id="imp-load-bar" style="height:100%;background:var(--A);width:0%;transition:width .3s;border-radius:100px"></div>
    </div>
    <div style="font-size:11px;color:var(--ink3);text-align:center;max-width:260px;line-height:1.6">your places are being looked up on the map — this takes a few seconds, you can still use the app</div>
  `;
}
function updateImpLoading(current, total, name) {
  const status = document.getElementById('imp-load-status');
  const bar    = document.getElementById('imp-load-bar');
  if(status) status.textContent = `${current}/${total}: ${name}`;
  if(bar)    bar.style.width = `${Math.round((current/total)*100)}%`;
}
function hideImpLoading() {
  const screen = document.getElementById('imp-loading');
  if(screen) screen.style.display='none';
}

function renderImpList(){
  const list=document.getElementById('implist');
  list.innerHTML=impPlaces.map(p=>{
    const st=impState[p._id];
    const hasCoords=p.lat&&p.lng&&!isNaN(p.lat)&&!isNaN(p.lng)&&(p.lat!==0||p.lng!==0);
    const dist=hasCoords?hav(uLat,uLng,p.lat,p.lng):null;
    const plausible=dist!==null&&dist<500;
    let locTxt,locCol,locBg,locBorder;
    if(!hasCoords){locTxt='📍 tap to set location';locCol='#DC2626';locBg='#FEF2F2';locBorder='#FCA5A5';}
    else if(!plausible){locTxt=`⚠️ ${dist.toFixed(0)} km away — looks wrong? tap to fix`;locCol='#D97706';locBg='#FFFBEB';locBorder='#FDE68A';}
    else{locTxt=`✓ ${dist.toFixed(1)} km away`;locCol='#059669';locBg='#ECFDF5';locBorder='#6EE7B7';}
    const cats=['eatery','activity','event'];
    const catC={eatery:'#993C1D',activity:'#5B21B6',event:'#D97706'};
    const catB={eatery:'#FAECE7',activity:'#EDE9FE',event:'#FEF3C7'};
    const catI={eatery:'🍴',activity:'⭐',event:'📅'};
    const catBtns=cats.map(c=>{const act=st.category===c;return`<div onclick="setImpCat('${p._id}','${c}')" style="padding:3px 9px;border-radius:20px;font-size:11px;cursor:pointer;border:1px solid ${act?catC[c]:'var(--border)'};background:${act?catB[c]:'var(--cream)'};color:${act?catC[c]:'var(--ink3)'}">${catI[c]}</div>`;}).join('');
    const tags=st.tags.map(t=>`<span onclick="remImpTag('${p._id}','${t}')" style="font-size:10px;padding:2px 7px;border-radius:10px;background:var(--As);color:var(--Atf);border:1px solid var(--Ab);cursor:pointer">${t} ×</span>`).join('');
    const mapPicker=st.fixingLocation?`<div style="margin:8px 0;border:1px solid var(--border);border-radius:var(--radius-sm);overflow:hidden"><div id="imp-map-${p._id}" style="height:160px"></div><div style="padding:6px 8px;display:flex;align-items:center;justify-content:space-between;background:var(--cream2)"><span style="font-size:11px;color:var(--ink2)">drag pin to correct spot</span><button onclick="confirmImpLoc('${p._id}')" style="background:var(--A);color:var(--As);border:none;border-radius:20px;padding:4px 12px;font-size:11px;font-weight:500;cursor:pointer;font-family:inherit">confirm ✓</button></div></div>`:'';
    return `<div id="irow-${p._id}" style="background:var(--white);border:1px solid ${!plausible?locBorder:'var(--border)'};border-radius:var(--radius-sm);padding:10px 12px;opacity:${st.selected?'1':'.45'}">
      <div style="display:flex;align-items:flex-start;gap:8px">
        <input type="checkbox" ${st.selected?'checked':''} onchange="togImpSel('${p._id}',this.checked)" style="width:15px;height:15px;accent-color:var(--A);cursor:pointer;flex-shrink:0;margin-top:2px">
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;font-weight:500;color:var(--ink);margin-bottom:5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${p.name}</div>
          <div onclick="toggleImpFix('${p._id}')" style="display:inline-flex;align-items:center;gap:4px;padding:3px 9px;border-radius:20px;font-size:10px;font-weight:500;background:${locBg};color:${locCol};cursor:pointer;margin-bottom:6px;max-width:100%;overflow:hidden;text-overflow:ellipsis">${locTxt}</div>
          ${mapPicker}
          <div style="display:flex;gap:4px;margin-bottom:6px">${catBtns}</div>
          <div style="display:flex;flex-wrap:wrap;gap:4px;align-items:center">${tags}<input placeholder="+ tag" onkeydown="if(event.key==='Enter'||event.key===','){addImpTag('${p._id}',this.value);this.value='';event.preventDefault()}" onblur="if(this.value.trim()){addImpTag('${p._id}',this.value);this.value=''}" style="border:1px dashed var(--border);border-radius:20px;padding:2px 8px;font-size:11px;width:60px;outline:none;background:transparent;font-family:inherit;color:var(--ink)"/></div>
        </div>
      </div>
    </div>`;
  }).join('');
  impPlaces.forEach(p=>{if(impState[p._id].fixingLocation)setTimeout(()=>initImpMap(p._id),50);});
}

let impMiniMaps={};

function toggleImpFix(id){
  impState[id].fixingLocation=!impState[id].fixingLocation;
  renderImpList();
}

function initImpMap(id){
  if(impMiniMaps[id]) return;
  const el=document.getElementById(`imp-map-${id}`);
  if(!el) return;
  const p=impPlaces.find(x=>x._id===id);
  const lat=(p.lat&&!isNaN(p.lat)&&p.lat!==0)?p.lat:uLat;
  const lng=(p.lng&&!isNaN(p.lng)&&p.lng!==0)?p.lng:uLng;
  const m=L.map(el,{zoomControl:true,scrollWheelZoom:true}).setView([lat,lng],14);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',{subdomains:'abcd',maxZoom:19}).addTo(m);
  const icon=L.divIcon({className:'',html:`<div style="width:28px;height:28px;border-radius:50%;background:var(--A);border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.3);display:flex;align-items:center;justify-content:center;font-size:14px;cursor:grab">📍</div>`,iconSize:[28,28],iconAnchor:[14,14]});
  const marker=L.marker([lat,lng],{icon,draggable:true}).addTo(m);
  impMiniMaps[id]={map:m,marker};
}

function confirmImpLoc(id){
  const mm=impMiniMaps[id]; if(!mm) return;
  const pos=mm.marker.getLatLng();
  const p=impPlaces.find(x=>x._id===id);
  if(p){p.lat=pos.lat;p.lng=pos.lng;}
  impState[id].fixingLocation=false;
  mm.map.remove(); delete impMiniMaps[id];
  renderImpList();
  showToast('location set ✓');
}

function togImpSel(id,v){impState[id].selected=v;updateImpCnt();const r=document.getElementById('irow-'+id);if(r)r.style.opacity=v?'1':'.45';}
function selAll(v){Object.keys(impState).forEach(id=>{impState[id].selected=v;});renderImpList();updateImpCnt();}
function updateImpCnt(){document.getElementById('impselcnt').textContent=`${Object.values(impState).filter(s=>s.selected).length} selected`;}
function setImpCat(id,cat){impState[id].category=cat;renderImpList();}
function batchCat(cat){Object.keys(impState).forEach(id=>{if(impState[id].selected)impState[id].category=cat;});renderImpList();}
function addImpTag(id,val){const t=val.trim().replace(',','');if(t&&!impState[id].tags.includes(t)){impState[id].tags.push(t);renderImpList();}}
function remImpTag(id,tag){impState[id].tags=impState[id].tags.filter(t=>t!==tag);renderImpList();}

async function saveImported(){
  const toSave=impPlaces.filter(p=>impState[p._id].selected);
  if(!toSave.length){showToast('select at least one');return;}
  const newP=toSave.map(p=>({
    id:Date.now()+'_'+Math.random().toString(36).slice(2,6),
    name:p.name, lat:p.lat||0, lng:p.lng||0,
    mapsUrl:p.mapsUrl||`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.name)}`,
    category:impState[p._id].category, tags:impState[p._id].tags,
    note:p.note||'', savedAt:new Date().toISOString(),
    _needsGeo:(!p.lat||!p.lng)
  }));
  const keys=new Set(places.map(p=>p.name));
  const deduped=newP.filter(p=>!keys.has(p.name));
  if(deduped.length<newP.length) showToast(`${newP.length-deduped.length} duplicates skipped`);
  places=[...deduped,...places];
  const ok=await saveData();
  if(!ok){places=places.filter(p=>!deduped.find(d=>d.id===p.id));return;}
  closeImp(); renderPlaces(); renderFpTags();
  const needsGeo=deduped.filter(p=>p._needsGeo);
  if(needsGeo.length){
    showToast(`saved ✓ — finding locations for ${needsGeo.length} place${needsGeo.length!==1?'s':''} in background…`,true);
    geocodeInBackground(needsGeo);
  }
}

async function geocodeInBackground(toGeocode){
  let updated=0;
  for(const p of toGeocode){
    try{
      await new Promise(r=>setTimeout(r,1300));
      const r=await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(p.name)}&format=json&limit=1`,{headers:{'Accept-Language':'en','User-Agent':'BahJalanMana/1.0'}});
      const d=await r.json();
      if(d.length){
        const lat=parseFloat(d[0].lat),lng=parseFloat(d[0].lon);
        const idx=places.findIndex(x=>x.id===p.id);
        if(idx>-1){places[idx].lat=lat;places[idx].lng=lng;delete places[idx]._needsGeo;updated++;}
      }
    }catch{}
  }
  if(updated){
    await saveData();
    renderPlaces();renderFpTags();
    showToast(`✓ locations found for ${updated} place${updated!==1?'s':''}`,true);
  }
}

// ── EXPORT ────────────────────────────
async function exportList(){
  const moded=places.filter(p=>curMode==='makan'?p.category==='eatery':(p.category==='activity'||p.category==='event'));
  const withD=moded.map(p=>{const dist=hav(uLat,uLng,p.lat,p.lng);const ck=`${uLat.toFixed(4)},${uLng.toFixed(4)}-${p.lat.toFixed(4)},${p.lng.toFixed(4)}`;const c=routeCache[ck];return{...p,dist,travelMin:c?c.minutes:Math.round((dist/40)*60)};});
  const filtered=withD.filter(p=>{if(fs.tags.length>0&&!fs.tags.some(t=>p.tags?.includes(t)))return false;if((fs.dmode==='r'||fs.dmode==='b')&&p.dist>fs.km)return false;if((fs.dmode==='t'||fs.dmode==='b')&&p.travelMin>fs.min)return false;return true;}).sort((a,b)=>a.dist-b.dist);
  const profs=getProfiles(),active=getActive(),prof=profs.find(p=>p.file===active);
  const header=`bah, jalan mana? — ${prof?.name||'places'} (${filtered.length})\nsorted nearest → furthest\n${'─'.repeat(40)}\n`;
  const lines=filtered.map((p,i)=>{const icon=p.category==='eatery'?'🍴':p.category==='activity'?'⭐':'📅';const tags=(p.tags||[]).join(', ');return`${i+1}. ${icon} ${p.name}\n   ${p.dist.toFixed(1)} km · ~${p.travelMin} min${tags?' · '+tags:''}${p.note?'\n   "'+p.note+'"':''}${p.mapsUrl?'\n   → '+p.mapsUrl:''}`;}).join('\n\n');
  try{await navigator.clipboard.writeText(header+'\n'+lines);showToast('list copied ✓');}
  catch{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([header+'\n'+lines],{type:'text/plain'}));a.download=`${prof?.name||'places'}.txt`;a.click();showToast('list downloaded ✓');}
}

// ── SETTINGS ──────────────────────────
function resetSettings(){[K.token,K.user,K.repo].forEach(k=>localStorage.removeItem(k));showToast('settings cleared — reload');}

function openSettings(){
  const ov=document.getElementById('tokov');
  document.getElementById('setupuser').value=getUser();
  document.getElementById('setuprepo').value=getRepo();
  document.getElementById('tokinp').value=localStorage.getItem(K.token)||'';
  document.getElementById('tokerr').textContent='';
  ov.classList.add('open');
  document.getElementById('toksave').onclick=()=>{
    const user=(document.getElementById('setupuser').value||'').trim();
    const repo=(document.getElementById('setuprepo').value||'').trim()||'bahjalan';
    const tok=(document.getElementById('tokinp').value||'').trim();
    const err=document.getElementById('tokerr');
    if(!user){err.textContent='enter your github username';return;}
    if(tok&&!tok.startsWith('ghp_')&&!tok.startsWith('github_pat_')){err.textContent='token should start with ghp_ or github_pat_';return;}
    localStorage.setItem(K.user,user);localStorage.setItem(K.repo,repo);if(tok)localStorage.setItem(K.token,tok);
    ov.classList.remove('open');showToast('settings saved ✓');
    loadData(getActive()).then(()=>{renderPlaces();renderFpTags();});
  };
  document.getElementById('tokcancel').onclick=()=>ov.classList.remove('open');
}

// ── MOBILE FILTER ─────────────────────
function toggleMobFp(){const p=document.getElementById('fp'),b=document.getElementById('fback');const o=p.classList.contains('mob-open');p.classList.toggle('mob-open',!o);b.classList.toggle('show',!o);}
function closeMobFp(){document.getElementById('fp').classList.remove('mob-open');document.getElementById('fback').classList.remove('show');}

// ── TOAST ─────────────────────────────
// ── PROGRESS BAR ──────────────────────
let progressTimer;
function startProgress(){
  const bar=document.getElementById('prog-bar');
  if(!bar)return;
  bar.style.transition='none';bar.style.width='0%';bar.style.opacity='1';
  requestAnimationFrame(()=>{
    bar.style.transition='width 8s cubic-bezier(.1,0,.2,1)';
    bar.style.width='85%';
  });
}
function stopProgress(ok){
  const bar=document.getElementById('prog-bar');
  if(!bar)return;
  bar.style.transition='width .2s ease';
  bar.style.width='100%';
  setTimeout(()=>{bar.style.opacity='0';setTimeout(()=>{bar.style.width='0%';},300);},400);
}

// ── SAVE QUEUE BOX ────────────────────
function showSaveQueue(names, done) {
  let box = document.getElementById('save-queue');
  if(!box){ box=document.createElement('div'); box.id='save-queue'; box.style.cssText='position:fixed;bottom:80px;right:14px;background:var(--white);border:1px solid var(--border);border-radius:var(--radius);padding:12px 14px;box-shadow:var(--shadow-lg);z-index:3000;min-width:220px;max-width:280px;font-family:sans-serif;transition:opacity .3s'; document.body.appendChild(box); }
  box.style.opacity='1'; box.style.pointerEvents='auto';
  const icon = done===null ? `<div style="width:14px;height:14px;border-radius:50%;border:2px solid var(--A);border-top-color:transparent;animation:spin .7s linear infinite;flex-shrink:0"></div>` : done ? `<span style="color:var(--green);font-size:14px">✓</span>` : `<span style="color:#DC2626;font-size:14px">✕</span>`;
  const label = done===null ? `saving ${names.length} place${names.length!==1?'s':''}…` : done ? `saved ✓` : `save failed`;
  const nameList = names.slice(0,5).map((n,i)=>`<div style="display:flex;align-items:center;gap:6px;padding:3px 0;border-bottom:1px solid var(--border);font-size:11px;color:var(--ink2)">${done===null&&i===0?'<span style="color:var(--A)">&#9656;</span>':'<span style="color:var(--ink3)">&middot;</span>'} <span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${n}</span></div>`).join('');
  const more = names.length>5 ? `<div style="font-size:10px;color:var(--ink3);padding-top:4px">+${names.length-5} more</div>` : '';
  box.innerHTML = `<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">${icon}<span style="font-size:12px;font-weight:600;color:var(--ink)">${label}</span></div>${nameList}${more}`;
  if(done!==null) setTimeout(hideSaveQueue, done?3000:5000);
}
function hideSaveQueue(){ const b=document.getElementById('save-queue'); if(b){b.style.opacity='0';setTimeout(()=>b.remove(),300);} }

let toastT;
function showToast(msg,long=false){const t=document.getElementById('toast');t.textContent=msg;t.classList.add('show');clearTimeout(toastT);toastT=setTimeout(()=>t.classList.remove('show'),long?6000:2800);}
