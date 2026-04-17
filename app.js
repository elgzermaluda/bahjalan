// ════════════════════════════════════════════════════════
//  BAH, JALAN MANA? — app.js
// ════════════════════════════════════════════════════════

const GH_TOKEN_KEY    = 'bjm_gh_token';
const GH_USER_KEY     = 'bjm_gh_user';
const GH_REPO_KEY     = 'bjm_gh_repo';
const GH_PROFILES_KEY = 'bjm_profiles';
const GH_ACTIVE_KEY   = 'bjm_active_profile';

function getGHUser()   { return localStorage.getItem(GH_USER_KEY)  || ''; }
function getGHRepo()   { return localStorage.getItem(GH_REPO_KEY)  || 'bahjalan'; }
function getToken()    { return localStorage.getItem(GH_TOKEN_KEY) || ''; }
function getProfiles() { try { return JSON.parse(localStorage.getItem(GH_PROFILES_KEY)) || []; } catch { return []; } }
function saveProfiles(p) { localStorage.setItem(GH_PROFILES_KEY, JSON.stringify(p)); }
function getActiveFile() { return localStorage.getItem(GH_ACTIVE_KEY) || ''; }
function setActiveFile(f) { localStorage.setItem(GH_ACTIVE_KEY, f); }

// ── STATE ────────────────────────────────────────────────
let map, userMarker, radiusCircle;
let userLat = 3.1390, userLng = 101.6869;
let places = [];
let markers = {};
let tentacleLines = [];
let eventsOnMap = true;
let routeLabelsVisible = true;
let filterState = { cat: 'all', tags: [], mode: 'r', km: 12, min: 20 };
let currentStep = 1;
let currentCategory = 'eatery';
let editingId = null;
let deleteTargetId = null;
let deleteCountdownTimer = null;
let profileImportData = null;

const routeCache = {};

// ── INIT ─────────────────────────────────────────────────
window.onload = async () => {
  initMap();
  if (!getGHUser()) await showSetupModal();
  const active = getActiveFile();
  if (active) {
    await loadData(active);
    updateProfileDisplay(active);
  } else {
    updateProfileDisplay(null);
  }
  renderFilterTags();
  renderPlaces();
  renderProfileDropdown();
};

function initMap() {
  map = L.map('map', { zoomControl: false }).setView([userLat, userLng], 13);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
    attribution: '© OpenStreetMap contributors © CARTO',
    subdomains: 'abcd', maxZoom: 19
  }).addTo(map);
  L.control.zoom({ position: 'topright' }).addTo(map);
  placeUserPin(userLat, userLng);
}

// ── PROFILE DROPDOWN ─────────────────────────────────────
function toggleProfileDropdown() {
  const dd    = document.getElementById('profile-dropdown');
  const bd    = document.getElementById('dropdown-backdrop');
  const caret = document.getElementById('profile-caret');
  const isOpen = dd.classList.contains('open');
  if (isOpen) {
    dd.classList.remove('open');
    bd.style.display = 'none';
    caret.classList.remove('open');
  } else {
    renderProfileDropdown();
    dd.classList.add('open');
    bd.style.display = 'block';
    caret.classList.add('open');
  }
}

function closeProfileDropdown() {
  document.getElementById('profile-dropdown').classList.remove('open');
  document.getElementById('dropdown-backdrop').style.display = 'none';
  document.getElementById('profile-caret').classList.remove('open');
}

function renderProfileDropdown() {
  const profiles  = getProfiles();
  const active    = getActiveFile();
  const list      = document.getElementById('pd-list');
  const deleteBtn = document.getElementById('pd-delete-btn');

  deleteBtn.style.display = (active && profiles.length) ? 'block' : 'none';

  if (!profiles.length) {
    list.innerHTML = '<div class="pd-empty">no maps yet — create one below</div>';
    return;
  }

  list.innerHTML = profiles.map(p => `
    <div class="pd-item ${p.file === active ? 'active' : ''}" onclick="switchProfile('${p.file}')">
      <div class="pd-dot ${p.file === active ? '' : 'dim'}"></div>
      <div class="pd-item-info">
        <div class="pd-item-name">${p.name}</div>
        <div class="pd-item-file">${p.file}</div>
      </div>
      <div class="pd-item-count" id="pdc-${p.file.replace(/\./g,'_')}">—</div>
    </div>
  `).join('');

  // Load counts in background
  profiles.forEach(async p => {
    try {
      const res = await fetch(`https://raw.githubusercontent.com/${getGHUser()}/${getGHRepo()}/main/${p.file}?t=${Date.now()}`);
      if (res.ok) {
        const d = await res.json();
        const n = (d.places || []).length;
        const el = document.getElementById(`pdc-${p.file.replace(/\./g,'_')}`);
        if (el) el.textContent = `${n} place${n !== 1 ? 's' : ''}`;
      }
    } catch {}
  });
}

function updateProfileDisplay(file) {
  const nameEl = document.getElementById('profile-name-display');
  if (!file) {
    nameEl.textContent = 'pick a map…';
    nameEl.className = 'placeholder';
    return;
  }
  const profile = getProfiles().find(p => p.file === file);
  if (profile) {
    nameEl.textContent = profile.name;
    nameEl.className = '';
  }
}

async function switchProfile(file) {
  closeProfileDropdown();
  setActiveFile(file);
  updateProfileDisplay(file);
  places = [];
  Object.values(markers).forEach(m => map.removeLayer(m));
  markers = {};
  tentacleLines.forEach(l => map.removeLayer(l));
  tentacleLines = [];
  Object.keys(routeCache).forEach(k => delete routeCache[k]);
  filterState.tags = [];
  renderPlaces();
  renderFilterTags();
  await loadData(file);
  renderPlaces();
  renderFilterTags();
}

// ── PROFILE MODAL ─────────────────────────────────────────
function openProfileModal() {
  closeProfileDropdown();
  document.getElementById('pm-name').value = '';
  document.getElementById('pm-filename').value = '';
  document.getElementById('pm-error').textContent = '';
  resetProfileImport();
  document.getElementById('profile-modal').style.display = 'flex';
  setTimeout(() => document.getElementById('pm-name').focus(), 100);

  document.getElementById('pm-name').oninput = function () {
    const slug = this.value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    document.getElementById('pm-filename').value = slug ? slug + '.json' : '';
  };
}

function closeProfileModal() {
  document.getElementById('profile-modal').style.display = 'none';
  profileImportData = null;
  resetProfileImport();
}

function resetProfileImport() {
  profileImportData = null;
  const dt = document.getElementById('pm-dropzone-text');
  if (dt) dt.innerHTML = `<span style="font-size:22px">📂</span><br><b style="color:var(--ink)">Saved Places.json</b> from Google Takeout<br><span style="font-size:10px">tap to choose or drag here</span>`;
  const inp = document.getElementById('pm-file-input');
  if (inp) inp.value = '';
}

function handleProfileImportDrop(e) {
  e.preventDefault();
  document.getElementById('pm-dropzone').classList.remove('drag');
  const file = e.dataTransfer.files[0];
  if (file) processProfileImportFile(file);
}

function handleProfileImportFile(inp) {
  const file = inp.files[0];
  if (file) processProfileImportFile(file);
}

function processProfileImportFile(file) {
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const raw = JSON.parse(e.target.result);
      const features = raw.features || (Array.isArray(raw) ? raw : []);
      const parsed = features
        .filter(f => f.geometry && f.geometry.coordinates)
        .map((f, i) => {
          const props  = f.properties || {};
          const coords = f.geometry.coordinates;
          const name   = props['Title'] || props['name'] || (props['Location'] && props['Location']['Address']) || 'Unnamed place';
          return {
            id: Date.now().toString() + '_' + i,
            name: name.trim(),
            lat: parseFloat(coords[1]),
            lng: parseFloat(coords[0]),
            mapsUrl: props['Google Maps URL'] || '',
            category: 'eatery', tags: [], note: '',
            savedAt: new Date().toISOString()
          };
        })
        .filter(p => p.lat && p.lng && !isNaN(p.lat) && !isNaN(p.lng));

      if (!parsed.length) { document.getElementById('pm-error').textContent = 'no places found in that file'; return; }
      profileImportData = parsed;
      document.getElementById('pm-dropzone-text').innerHTML = `<span style="font-size:22px">✅</span><br><b style="color:var(--ink)">${parsed.length} places ready</b><br><span style="font-size:10px;color:var(--ink3)">all set as eateries — edit after creating</span>`;
    } catch {
      document.getElementById('pm-error').textContent = "couldn't read file — make sure it's the right JSON";
    }
  };
  reader.readAsText(file);
}

async function saveNewProfile() {
  const name  = document.getElementById('pm-name').value.trim();
  const file  = document.getElementById('pm-filename').value.trim();
  const errEl = document.getElementById('pm-error');

  if (!name)               { errEl.textContent = 'enter a name for your map'; return; }
  if (!file.endsWith('.json')) { errEl.textContent = 'file name must end in .json'; return; }
  if (!getGHUser())        { errEl.textContent = 'connect to GitHub first (tap ⚙)'; return; }

  const profiles = getProfiles();
  if (profiles.find(p => p.file === file)) { errEl.textContent = 'a map with that file name already exists'; return; }

  const token = getToken();
  if (!token) { errEl.textContent = 'github token needed — tap ⚙'; return; }

  showToast('creating map…');
  const newPlaces = profileImportData || [];
  const content = btoa(unescape(encodeURIComponent(JSON.stringify({ places: newPlaces }, null, 2))));

  try {
    const res = await fetch(`https://api.github.com/repos/${getGHUser()}/${getGHRepo()}/contents/${file}`, {
      method: 'PUT',
      headers: { 'Authorization': `token ${token}`, 'Accept': 'application/vnd.github.v3+json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: `Create map: ${name}`, content })
    });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      errEl.textContent = 'github error: ' + (e.message || res.status);
      return;
    }
  } catch {
    errEl.textContent = 'network error — check connection';
    return;
  }

  profiles.push({ name, file });
  saveProfiles(profiles);
  closeProfileModal();
  showToast(`"${name}" created ✓`);
  await switchProfile(file);
  renderProfileDropdown();
}

async function deleteCurrentProfile() {
  const active   = getActiveFile();
  if (!active) return;
  const profiles = getProfiles();
  const profile  = profiles.find(p => p.file === active);
  if (!confirm(`Delete the map "${profile?.name || active}"?\n\nThis will also delete ${active} from your GitHub repo. Cannot be undone.`)) return;

  closeProfileDropdown();
  showToast('deleting map…');

  const token = getToken();
  if (token) {
    try {
      const getRes = await fetch(`https://api.github.com/repos/${getGHUser()}/${getGHRepo()}/contents/${active}`, {
        headers: { 'Authorization': `token ${token}`, 'Accept': 'application/vnd.github.v3+json' }
      });
      if (getRes.ok) {
        const j = await getRes.json();
        await fetch(`https://api.github.com/repos/${getGHUser()}/${getGHRepo()}/contents/${active}`, {
          method: 'DELETE',
          headers: { 'Authorization': `token ${token}`, 'Accept': 'application/vnd.github.v3+json', 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: `Delete map: ${active}`, sha: j.sha })
        });
      }
    } catch {}
  }

  saveProfiles(profiles.filter(p => p.file !== active));
  setActiveFile('');
  places = [];
  updateProfileDisplay(null);
  renderPlaces();
  renderFilterTags();
  renderProfileDropdown();
  showToast('map deleted');
}

// ── GITHUB STORAGE ───────────────────────────────────────
async function loadData(file) {
  if (!file) { places = []; return; }
  const user = getGHUser(), repo = getGHRepo();
  if (!user) { places = []; return; }
  showToast('loading…');
  try {
    const res = await fetch(`https://raw.githubusercontent.com/${user}/${repo}/main/${file}?t=${Date.now()}`);
    if (!res.ok) { showToast(`load failed ${res.status} — check ⚙`); places = []; return; }
    const d = await res.json();
    places = d.places || [];
    showToast(`${places.length} place${places.length !== 1 ? 's' : ''} loaded ✓`);
  } catch {
    showToast('network error — check connection');
    places = [];
  }
}

function showSetupModal() {
  return new Promise(resolve => {
    const overlay = document.getElementById('token-overlay');
    overlay.style.display = 'flex';
    const repoInp = document.getElementById('setup-repo');
    if (repoInp) repoInp.value = getGHRepo();
    setTimeout(() => { const u = document.getElementById('setup-user'); if (u) u.focus(); }, 100);

    document.getElementById('token-save-btn').onclick = () => {
      const user  = (document.getElementById('setup-user').value || '').trim();
      const repo  = (document.getElementById('setup-repo').value || '').trim() || 'bahjalan';
      const token = (document.getElementById('token-input').value || '').trim();
      const err   = document.getElementById('token-error');
      if (!user) { err.textContent = 'enter your github username'; return; }
      if (token && !token.startsWith('ghp_') && !token.startsWith('github_pat_')) {
        err.textContent = 'token should start with ghp_ or github_pat_'; return;
      }
      localStorage.setItem(GH_USER_KEY, user);
      localStorage.setItem(GH_REPO_KEY, repo);
      if (token) localStorage.setItem(GH_TOKEN_KEY, token);
      overlay.style.display = 'none';
      resolve();
    };
    document.getElementById('token-cancel-btn').onclick = () => { overlay.style.display = 'none'; resolve(); };
    document.getElementById('token-input').onkeydown = e => { if (e.key === 'Enter') document.getElementById('token-save-btn').click(); };
  });
}

function askForToken() {
  return new Promise(resolve => {
    const overlay = document.getElementById('token-overlay');
    overlay.style.display = 'flex';
    document.getElementById('token-input').value = '';
    document.getElementById('token-error').textContent = 'your token was rejected — paste a new one';
    setTimeout(() => document.getElementById('token-input').focus(), 100);
    document.getElementById('token-save-btn').onclick = () => {
      const token = (document.getElementById('token-input').value || '').trim();
      const err   = document.getElementById('token-error');
      if (!token) { err.textContent = 'paste your token first'; return; }
      if (!token.startsWith('ghp_') && !token.startsWith('github_pat_')) { err.textContent = 'should start with ghp_ or github_pat_'; return; }
      localStorage.setItem(GH_TOKEN_KEY, token);
      overlay.style.display = 'none';
      resolve(token);
    };
    document.getElementById('token-cancel-btn').onclick = () => { overlay.style.display = 'none'; resolve(null); };
  });
}

async function saveData(retryOnFail = true) {
  const file = getActiveFile();
  if (!file) { showToast('no map selected — pick one first'); return false; }
  let token = getToken();
  if (!token) { token = await askForToken(); if (!token) return false; }
  try {
    const apiUrl = `https://api.github.com/repos/${getGHUser()}/${getGHRepo()}/contents/${file}`;
    const getRes = await fetch(apiUrl, { headers: { 'Authorization': `token ${token}`, 'Accept': 'application/vnd.github.v3+json' } });
    if (getRes.status === 401) {
      localStorage.removeItem(GH_TOKEN_KEY);
      if (retryOnFail) { showToast('token rejected — enter it again'); token = await askForToken(); if (!token) return false; return saveData(false); }
      return false;
    }
    let sha = null;
    if (getRes.ok) { const j = await getRes.json(); sha = j.sha; }
    const content = btoa(unescape(encodeURIComponent(JSON.stringify({ places }, null, 2))));
    const putRes  = await fetch(apiUrl, {
      method: 'PUT',
      headers: { 'Authorization': `token ${token}`, 'Accept': 'application/vnd.github.v3+json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Update places', content, ...(sha && { sha }) })
    });
    if (!putRes.ok) {
      const errData = await putRes.json().catch(() => ({}));
      showToast('save failed — ' + (errData.message || putRes.status));
      return false;
    }
    return true;
  } catch {
    showToast('network error — check your internet');
    return false;
  }
}

// ── USER LOCATION ─────────────────────────────────────────
function placeUserPin(lat, lng) {
  if (userMarker) map.removeLayer(userMarker);
  const icon = L.divIcon({
    className: '',
    html: `<div style="width:36px;height:36px;border-radius:50%;background:#1a1a2e;border:3px solid #fff;box-shadow:0 2px 10px rgba(0,0,0,0.35);display:flex;align-items:center;justify-content:center;font-size:18px;cursor:grab" title="drag to move">🧍</div>`,
    iconSize: [36, 36], iconAnchor: [18, 18]
  });
  userMarker = L.marker([lat, lng], { icon, draggable: true }).addTo(map);
  userMarker.on('drag', () => {
    const p = userMarker.getLatLng();
    userLat = p.lat; userLng = p.lng;
    updateRadiusCircle();
  });
  userMarker.on('dragend', () => {
    const p = userMarker.getLatLng();
    userLat = p.lat; userLng = p.lng;
    Object.keys(routeCache).forEach(k => delete routeCache[k]);
    renderPlaces();
    showToast('location moved ✓');
  });
  updateRadiusCircle();
}

function useMyLocation() {
  if (!navigator.geolocation) { openManualLocation(); return; }
  showToast('getting your location…');
  navigator.geolocation.getCurrentPosition(pos => {
    userLat = pos.coords.latitude; userLng = pos.coords.longitude;
    map.setView([userLat, userLng], 14);
    placeUserPin(userLat, userLng);
    Object.keys(routeCache).forEach(k => delete routeCache[k]);
    renderPlaces();
    showToast('location updated ✓');
  }, () => {
    showToast('GPS failed — enter location manually');
    setTimeout(openManualLocation, 600);
  }, { timeout: 8000 });
}

function openManualLocation() {
  const el = document.getElementById('manual-loc-overlay');
  el.style.display = 'flex';
  document.getElementById('manual-loc-input').value = '';
  document.getElementById('manual-loc-error').textContent = '';
  setTimeout(() => document.getElementById('manual-loc-input').focus(), 100);
}

async function searchManualLocation() {
  const q   = document.getElementById('manual-loc-input').value.trim();
  const err = document.getElementById('manual-loc-error');
  if (!q) { err.textContent = 'enter a place name'; return; }
  const btn = document.getElementById('manual-loc-btn');
  btn.textContent = 'searching…';
  try {
    const res  = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=5`, { headers: { 'Accept-Language': 'en', 'User-Agent': 'BahJalanMana/1.0' } });
    const data = await res.json();
    if (!data.length) { err.textContent = 'place not found'; btn.textContent = 'search'; return; }
    const resultsEl = document.getElementById('manual-loc-results');
    resultsEl.innerHTML = data.map(r => `
      <div onclick="setManualLocation(${r.lat},${r.lon},'${r.display_name.split(',')[0].replace(/'/g, '')}')"
           style="padding:8px 10px;border-bottom:1px solid var(--border);cursor:pointer;font-size:12px"
           onmouseover="this.style.background='var(--cream2)'" onmouseout="this.style.background=''">
        <div style="font-weight:500">${r.display_name.split(',')[0]}</div>
        <div style="font-size:10px;color:var(--ink3)">${r.display_name.split(',').slice(1,3).join(',')}</div>
      </div>`).join('');
    resultsEl.style.display = 'block';
  } catch { err.textContent = 'search failed — check connection'; }
  btn.textContent = 'search';
}

function setManualLocation(lat, lng, name) {
  userLat = parseFloat(lat); userLng = parseFloat(lng);
  document.getElementById('manual-loc-overlay').style.display = '';
  map.setView([userLat, userLng], 14);
  placeUserPin(userLat, userLng);
  Object.keys(routeCache).forEach(k => delete routeCache[k]);
  renderPlaces();
  showToast(`location set to ${name} ✓`);
}

function updateRadiusCircle() {
  if (radiusCircle) map.removeLayer(radiusCircle);
  if (filterState.mode === 'r' || filterState.mode === 'b') {
    radiusCircle = L.circle([userLat, userLng], {
      radius: filterState.km * 1000,
      color: '#7C3AED', fillColor: '#7C3AED', fillOpacity: 0.05, weight: 2, dashArray: '6 5'
    }).addTo(map);
  }
}

// ── URL EXTRACTION ────────────────────────────────────────
let extractedLat = null, extractedLng = null, extractedName = null, extractedMapsUrl = null;

function onUrlInput(val) {
  const btn = document.getElementById('btn-extract');
  if (val.length > 10) { btn.textContent = 'get info'; btn.classList.remove('loading'); }
}

async function extractUrl() {
  const raw = document.getElementById('url-input').value.trim();
  if (!raw) { showToast('paste a link first'); return; }
  const btn = document.getElementById('btn-extract');
  btn.textContent = 'loading…'; btn.classList.add('loading');
  extractedLat = null; extractedLng = null; extractedName = null; extractedMapsUrl = raw;
  let workingUrl = raw;

  if (raw.includes('goo.gl') || raw.includes('maps.app')) {
    try {
      const res  = await fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(raw)}`);
      const data = await res.json();
      const finalUrl = data.status?.url || '';
      if (finalUrl.includes('google.com/maps')) workingUrl = finalUrl;
      else {
        const m = data.contents?.match(/href="(https:\/\/www\.google\.com\/maps\/[^"]+)"/);
        if (m) workingUrl = m[1];
      }
    } catch {
      try {
        const res2 = await fetch(`https://corsproxy.io/?${encodeURIComponent(raw)}`);
        const text = await res2.text();
        const m    = text.match(/https:\/\/www\.google\.com\/maps\/place\/[^\s"']+/);
        if (m) workingUrl = m[0];
      } catch {}
    }
  }

  const coordMatch = workingUrl.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (coordMatch) { extractedLat = parseFloat(coordMatch[1]); extractedLng = parseFloat(coordMatch[2]); }

  const placeMatch = workingUrl.match(/\/place\/([^/@?&]+)/);
  if (placeMatch) {
    extractedName = decodeURIComponent(placeMatch[1].replace(/\+/g, ' ')).replace(/_/g, ' ').trim();
    if (extractedName.includes(',')) extractedName = extractedName.split(',')[0].trim();
  }
  if (!extractedName) {
    const qMatch = workingUrl.match(/[?&]q=([^&]+)/);
    if (qMatch) extractedName = decodeURIComponent(qMatch[1].replace(/\+/g, ' '));
  }

  if (!extractedLat && extractedName) {
    try {
      const r    = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(extractedName)}&format=json&limit=1`, { headers: { 'Accept-Language': 'en', 'User-Agent': 'BahJalanMana/1.0' } });
      const data = await r.json();
      if (data.length) { extractedLat = parseFloat(data[0].lat); extractedLng = parseFloat(data[0].lon); }
    } catch {}
  }

  btn.textContent = 'get info'; btn.classList.remove('loading');
  const nameEl  = document.getElementById('extracted-name');
  const coordEl = document.getElementById('extracted-coords');
  if (extractedLat && extractedLng) {
    nameEl.textContent  = extractedName || 'name not detected';
    nameEl.className    = 'row-val extracted';
    coordEl.textContent = `${extractedLat.toFixed(5)}° N, ${extractedLng.toFixed(5)}° E`;
    coordEl.className   = 'row-val extracted';
    map.setView([extractedLat, extractedLng], 15);
    showToast('place found ✓');
  } else {
    nameEl.textContent  = 'could not read link — try the full browser URL';
    nameEl.className    = 'row-val auto';
    coordEl.textContent = '—';
    coordEl.className   = 'row-val auto';
    showToast('try copying the full URL from your browser');
  }
}

// ── SAVE PANEL ────────────────────────────────────────────
function openSavePanel() {
  if (!getActiveFile()) { showToast('pick a map first'); toggleProfileDropdown(); return; }
  editingId = null;
  extractedLat = null; extractedLng = null; extractedName = null; extractedMapsUrl = null;
  document.getElementById('url-input').value = '';
  document.getElementById('extracted-name').textContent = '— paste a link above';
  document.getElementById('extracted-name').className = 'row-val auto';
  document.getElementById('extracted-coords').textContent = '— from link';
  document.getElementById('extracted-coords').className = 'row-val auto';
  document.getElementById('place-note').value = '';
  clearEventFields();
  resetTags();
  setCategory('eatery');
  goStep(1);
  document.getElementById('save-panel-title').textContent = 'save a place';
  document.getElementById('save-panel').classList.add('open');
}

function closeSavePanel() {
  document.getElementById('save-panel').classList.remove('open');
  editingId = null;
}

function editPlace(id) {
  const place = places.find(p => p.id === id);
  if (!place) return;
  map.closePopup();
  editingId = id;
  extractedLat = place.lat; extractedLng = place.lng;
  extractedName = place.name; extractedMapsUrl = place.mapsUrl;

  document.getElementById('url-input').value = place.mapsUrl || '';
  const nameEl  = document.getElementById('extracted-name');
  nameEl.textContent = place.name; nameEl.className = 'row-val extracted';
  const coordEl = document.getElementById('extracted-coords');
  coordEl.textContent = `${place.lat.toFixed(5)}° N, ${place.lng.toFixed(5)}° E`;
  coordEl.className = 'row-val extracted';

  setCategory(place.category || 'eatery');
  resetTags();
  const presetId = place.category === 'activity' ? 'act-presets' : place.category === 'event' ? 'evt-presets' : 'eat-presets';
  document.querySelectorAll(`#${presetId} .tp-tag`).forEach(t => t.classList.remove('on'));
  (place.tags || []).forEach(tag => {
    let found = false;
    document.querySelectorAll(`#${presetId} .tp-tag`).forEach(t => {
      if (t.textContent.replace(' ×', '').trim() === tag) { t.classList.add('on'); found = true; }
    });
    if (!found) {
      const customId = place.category === 'activity' ? 'act-custom' : place.category === 'event' ? 'evt-custom' : 'eat-custom';
      const inp = document.getElementById(customId);
      const saved = inp.value; inp.value = tag;
      addCustomTag(presetId, customId);
      inp.value = saved;
    }
  });
  document.getElementById('place-note').value = place.note || '';

  if (place.category === 'event') {
    const radio = document.querySelector(`input[name="evtype"][value="${place.eventType || 'once'}"]`);
    if (radio) radio.checked = true;
    toggleEventType();
    if (place.eventDateStart) document.getElementById('ev-date-start').value = place.eventDateStart;
    if (place.eventDateEnd)   document.getElementById('ev-date-end').value   = place.eventDateEnd;
    if (place.eventDay != null) document.getElementById('ev-day').value = place.eventDay;
    if (place.eventStart) document.getElementById('ev-start').value = place.eventStart;
    if (place.eventEnd)   document.getElementById('ev-end').value   = place.eventEnd;
  }

  document.getElementById('save-panel-title').textContent = 'edit place';
  goStep(1);
  document.getElementById('save-panel').classList.add('open');
}

function goStep(n) {
  [1, 2].forEach(i => {
    document.getElementById(`step-${i}`).style.display = i === n ? 'flex' : 'none';
    const tab = document.getElementById(`step-tab-${i}`);
    tab.classList.remove('on', 'done');
    if (i === n) tab.classList.add('on');
    else if (i < n) tab.classList.add('done');
  });
  currentStep = n;
}

function setCategory(cat) {
  currentCategory = cat;
  ['eatery', 'activity', 'event'].forEach(c =>
    document.getElementById(`cat-${c}`).classList.toggle('on', cat === c)
  );
  document.getElementById('eat-tag-block').style.display   = cat === 'eatery'   ? '' : 'none';
  document.getElementById('act-tag-block').style.display   = cat === 'activity' ? '' : 'none';
  document.getElementById('event-tag-block').style.display = cat === 'event'    ? '' : 'none';
  document.getElementById('event-fields').style.display    = cat === 'event'    ? '' : 'none';
}

function toggleEventType() {
  const isRecurring = document.querySelector('input[name="evtype"]:checked')?.value === 'recurring';
  document.getElementById('ev-once-row').style.display  = isRecurring ? 'none' : '';
  document.getElementById('ev-recur-row').style.display = isRecurring ? '' : 'none';
}

function clearEventFields() {
  const once = document.querySelector('input[name="evtype"][value="once"]');
  if (once) once.checked = true;
  ['ev-date-start', 'ev-date-end', 'ev-start', 'ev-end'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  const d = document.getElementById('ev-day'); if (d) d.value = '6';
  toggleEventType();
}

function addCustomTag(presetId, inputId) {
  const inp = document.getElementById(inputId);
  const val = inp.value.trim();
  if (!val) return;
  const t  = document.createElement('div');
  t.className = 'tp-tag custom-tag on';
  const rm = document.createElement('span');
  rm.textContent = ' ×';
  rm.style.cssText = 'cursor:pointer;opacity:0.6;font-size:10px';
  rm.onclick = e => { e.stopPropagation(); t.remove(); };
  t.textContent = val;
  t.appendChild(rm);
  t.onclick = () => t.classList.toggle('on');
  document.getElementById(presetId).appendChild(t);
  inp.value = '';
}

function resetTags() {
  document.querySelectorAll('.tp-tag.custom-tag').forEach(t => t.remove());
  document.querySelectorAll('.tp-tag').forEach(t => {
    t.classList.toggle('on', ['cafe', 'theme park', 'market'].includes(t.textContent.trim()));
  });
}

function getSelectedTags(presetId) {
  const tags = [];
  document.querySelectorAll(`#${presetId} .tp-tag.on`).forEach(t =>
    tags.push(t.textContent.replace(' ×', '').trim())
  );
  return tags;
}

// ── SAVE PLACE ────────────────────────────────────────────
async function savePlace() {
  if (!extractedLat || !extractedLng) { showToast('go back to step 1 and extract a link first'); return; }
  const presetId = currentCategory === 'activity' ? 'act-presets' : currentCategory === 'event' ? 'evt-presets' : 'eat-presets';
  const tags = getSelectedTags(presetId);
  const note = document.getElementById('place-note').value.trim();
  const name = extractedName || 'unnamed place';

  let eventType = null, eventDay = null, eventDateStart = null, eventDateEnd = null, eventStart = null, eventEnd = null;
  if (currentCategory === 'event') {
    eventType      = document.querySelector('input[name="evtype"]:checked')?.value || 'once';
    eventDay       = eventType === 'recurring' ? document.getElementById('ev-day').value : null;
    eventDateStart = eventType === 'once' ? document.getElementById('ev-date-start').value : null;
    eventDateEnd   = eventType === 'once' ? document.getElementById('ev-date-end').value   : null;
    eventStart     = document.getElementById('ev-start').value || null;
    eventEnd       = document.getElementById('ev-end').value   || null;
  }

  const place = {
    id: editingId || Date.now().toString(),
    name, lat: extractedLat, lng: extractedLng,
    mapsUrl: extractedMapsUrl, category: currentCategory,
    tags, note,
    ...(currentCategory === 'event' && { eventType, eventDay, eventDateStart, eventDateEnd, eventStart, eventEnd }),
    savedAt: new Date().toISOString()
  };

  if (editingId) places = places.map(p => p.id === editingId ? place : p);
  else places.unshift(place);

  showToast('saving…');
  const ok = await saveData();
  if (ok) {
    showToast(`"${name}" saved ✓`);
    closeSavePanel();
    renderPlaces();
    renderFilterTags();
  } else {
    // Revert optimistic update
    if (!editingId) places = places.filter(p => p.id !== place.id);
    showToast('save failed — check ⚙ settings');
  }
}

// ── DELETE MODAL ──────────────────────────────────────────
function promptDeletePlace(id) {
  const place = places.find(p => p.id === id);
  if (!place) return;
  map.closePopup();
  deleteTargetId = id;
  document.getElementById('dm-place-name').textContent = place.name;
  document.getElementById('dm-delete-btn').disabled = true;
  document.getElementById('dm-countdown').textContent = 'wait 3 seconds…';
  document.getElementById('delete-modal').classList.add('open');

  let secs = 3;
  clearInterval(deleteCountdownTimer);
  deleteCountdownTimer = setInterval(() => {
    secs--;
    if (secs <= 0) {
      clearInterval(deleteCountdownTimer);
      document.getElementById('dm-delete-btn').disabled = false;
      document.getElementById('dm-countdown').textContent = '';
    } else {
      document.getElementById('dm-countdown').textContent = `wait ${secs} second${secs !== 1 ? 's' : ''}…`;
    }
  }, 1000);
}

function closeDeleteModal() {
  document.getElementById('delete-modal').classList.remove('open');
  clearInterval(deleteCountdownTimer);
  deleteTargetId = null;
}

async function confirmDelete() {
  if (!deleteTargetId) return;
  const id = deleteTargetId;
  closeDeleteModal();
  places = places.filter(p => p.id !== id);
  showToast('removing…');
  await saveData();
  showToast('place removed ✓');
  renderPlaces();
  renderFilterTags();
}

// ── DISTANCE & ROUTING ────────────────────────────────────
function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371, dLat = (lat2-lat1)*Math.PI/180, dLng = (lng2-lng1)*Math.PI/180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

async function getRouteData(lat, lng) {
  const key = `${userLat.toFixed(4)},${userLng.toFixed(4)}-${lat.toFixed(4)},${lng.toFixed(4)}`;
  if (routeCache[key]) return routeCache[key];
  try {
    const res  = await fetch(`https://router.project-osrm.org/route/v1/driving/${userLng},${userLat};${lng},${lat}?overview=full&geometries=geojson`);
    const data = await res.json();
    if (data.routes?.[0]) {
      const route  = data.routes[0];
      const result = { minutes: Math.round(route.duration / 60), coords: route.geometry.coordinates.map(c => [c[1], c[0]]) };
      routeCache[key] = result; return result;
    }
  } catch {}
  const km     = haversine(userLat, userLng, lat, lng);
  const result = { minutes: Math.round((km/40)*60), coords: null };
  routeCache[key] = result; return result;
}

// ── RENDER PLACES ─────────────────────────────────────────
async function renderPlaces() {
  Object.values(markers).forEach(m => map.removeLayer(m));
  markers = {};
  tentacleLines.forEach(l => map.removeLayer(l));
  tentacleLines = [];
  updateRadiusCircle();

  const allWithDist = places.map(p => {
    const dist    = haversine(userLat, userLng, p.lat, p.lng);
    const cacheKey = `${userLat.toFixed(4)},${userLng.toFixed(4)}-${p.lat.toFixed(4)},${p.lng.toFixed(4)}`;
    const cached  = routeCache[cacheKey];
    const travelMin = cached ? cached.minutes : Math.round((dist/40)*60);
    return { ...p, dist, travelMin };
  });

  const filtered = allWithDist.filter(p => {
    if (filterState.cat === 'eatery'   && p.category !== 'eatery')   return false;
    if (filterState.cat === 'activity' && p.category !== 'activity') return false;
    if (filterState.cat === 'event'    && p.category !== 'event')    return false;
    if (filterState.tags.length > 0 && !filterState.tags.some(t => p.tags?.includes(t))) return false;
    if ((filterState.mode === 'r' || filterState.mode === 'b') && p.dist > filterState.km) return false;
    if ((filterState.mode === 't' || filterState.mode === 'b') && p.travelMin > filterState.min) return false;
    return true;
  });

  allWithDist.forEach(p => {
    if (p.category === 'event' && !eventsOnMap) return;
    addMarker(p, filtered.some(f => f.id === p.id), p.dist, p.travelMin);
  });

  for (const p of filtered) {
    if (p.category === 'event' && !eventsOnMap) continue;
    const lineColor = p.category === 'eatery' ? '#6D28D9' : p.category === 'event' ? '#D97706' : '#0284C7';
    const routeData = await getRouteData(p.lat, p.lng);
    const coords    = routeData.coords || [[userLat, userLng], [p.lat, p.lng]];
    const isDashed  = !routeData.coords;

    const casing = L.polyline(coords, { color: '#ffffff', weight: 7, opacity: 0.85, ...(isDashed ? { dashArray: '8 6' } : {}) }).addTo(map);
    const line   = L.polyline(coords, { color: lineColor, weight: 4, opacity: 0.92, ...(isDashed ? { dashArray: '8 6' } : {}) }).addTo(map);
    tentacleLines.push(casing, line);

    if (routeLabelsVisible) {
      const mid = coords[Math.floor(coords.length / 2)];
      const labelIcon = L.divIcon({
        className: '',
        html: `<div style="pointer-events:none"><div style="background:#fff;border:2px solid ${lineColor};border-radius:6px;padding:4px 9px;font-family:'DM Sans',sans-serif;font-size:11px;font-weight:700;color:#1a1a1a;white-space:nowrap;box-shadow:0 2px 10px rgba(0,0,0,0.22);text-align:center;line-height:1.25"><div style="color:${lineColor}">${routeData.minutes} min</div><div style="font-size:9px;font-weight:500;color:#666">${p.dist.toFixed(1)} km</div></div></div>`,
        iconAnchor: [35, 46]
      });
      tentacleLines.push(L.marker(mid, { icon: labelIcon, interactive: false }).addTo(map));
    }
  }

  renderStrip(allWithDist, filtered.map(f => f.id));
  renderFilterTags();
  const ep = document.getElementById('events-panel');
  if (ep?.classList.contains('open')) renderEventsPanel();
}

function addMarker(place, isMatch, dist, travelMin) {
  const isEatery = place.category === 'eatery', isEvent = place.category === 'event';
  const matchColor  = isEatery ? '#7C3AED' : isEvent ? '#D97706' : '#0EA5E9';
  const matchBorder = isEatery ? '#EDE9FE' : isEvent ? '#FEF3C7' : '#E0F2FE';
  const emoji       = isEatery ? '🍴'      : isEvent ? '📅'      : '⭐';
  const color  = isMatch ? matchColor  : '#c8b8a0';
  const border = isMatch ? matchBorder : '#f0ebe3';
  const size   = isMatch ? 32 : 26;

  const icon = L.divIcon({
    className: '',
    html: `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${color};border:2.5px solid ${border};box-shadow:0 2px 6px rgba(0,0,0,0.22);display:flex;align-items:center;justify-content:center;font-size:${isMatch?14:10}px;opacity:${isMatch?1:0.7}">${emoji}</div>`,
    iconSize: [size, size], iconAnchor: [size/2, size/2]
  });

  const m = L.marker([place.lat, place.lng], { icon }).addTo(map);
  const tagClass = place.category === 'activity' ? 'a' : place.category === 'event' ? 'e' : '';
  const tagsHtml = (place.tags || []).map(t => `<span class="popup-tag ${tagClass}">${t}</span>`).join('');
  const mapsHref = place.mapsUrl || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place.name)}`;
  const catLabel = isEatery ? '🍴 eatery' : isEvent ? '📅 event' : '⭐ activity';

  m.bindPopup(`
    <div class="popup-inner">
      <div style="font-size:9px;color:${matchColor};font-weight:600;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:2px">${catLabel}</div>
      <div class="popup-name">${place.name}</div>
      <div class="popup-dist">${dist.toFixed(1)} km · ~${travelMin} min drive</div>
      ${place.note ? `<div style="font-size:10px;color:var(--ink2);margin-top:3px;font-style:italic">${place.note}</div>` : ''}
      <div class="popup-tags">${tagsHtml}</div>
      <div class="popup-btns">
        <a class="popup-btn primary" href="${mapsHref}" target="_blank">open in maps</a>
        <div class="popup-btn" onclick="editPlace('${place.id}')">edit</div>
        <div class="popup-btn del" onclick="promptDeletePlace('${place.id}')">remove</div>
      </div>
    </div>
  `);
  markers[place.id] = m;
}

function renderStrip(all, matchedIds) {
  const list  = document.getElementById('ps-list');
  const count = document.getElementById('ps-count');

  if (all.length === 0) {
    list.innerHTML = '<div class="pcard no-places">no places yet — tap + save to add</div>';
    count.textContent = '';
    return;
  }

  count.textContent = `${matchedIds.length} / ${all.length}`;

  const sorted = [...all].sort((a, b) => {
    const am = matchedIds.includes(a.id) ? 0 : 1;
    const bm = matchedIds.includes(b.id) ? 0 : 1;
    return am - bm || a.dist - b.dist;
  });

  list.innerHTML = sorted.map(p => {
    const isMatch  = matchedIds.includes(p.id);
    const catIcon  = p.category === 'eatery' ? '🍴' : p.category === 'event' ? '📅' : '⭐';
    const catColor = p.category === 'eatery' ? '#7C3AED' : p.category === 'event' ? '#D97706' : '#0EA5E9';
    const tcls     = p.category === 'activity' ? 'a' : p.category === 'event' ? 'e' : '';
    const tagsHtml = (p.tags || []).map(t => `<span class="pctag ${tcls}">${t}</span>`).join('');
    return `<div class="pcard ${isMatch ? 'match' : 'faded'}" style="${isMatch ? `border-color:${catColor}40;` : ''}">
      <div style="display:flex;align-items:center;gap:5px;margin-bottom:3px" onclick="focusPlace('${p.id}')">
        <span style="font-size:13px">${catIcon}</span>
        <div class="pc-name">${p.name}</div>
      </div>
      <div class="pc-dist" onclick="focusPlace('${p.id}')">${p.dist.toFixed(1)} km · ~${p.travelMin} min</div>
      <div class="pc-tags" onclick="focusPlace('${p.id}')">${tagsHtml}</div>
      <div style="display:flex;gap:4px;margin-top:6px">
        <div onclick="editPlace('${p.id}')" style="flex:1;text-align:center;font-size:10px;padding:3px 0;border:1px solid var(--border);border-radius:20px;color:var(--ink2);cursor:pointer;background:var(--cream)">edit</div>
        <div onclick="focusPlace('${p.id}')" style="flex:1;text-align:center;font-size:10px;padding:3px 0;border:1px solid var(--border);border-radius:20px;color:var(--ink2);cursor:pointer;background:var(--cream)">view</div>
      </div>
    </div>`;
  }).join('');
}

function focusPlace(id) {
  const m = markers[id];
  if (m) { map.setView(m.getLatLng(), 15); m.openPopup(); }
}

// ── FILTER TAG CHIPS ──────────────────────────────────────
let tagsExpanded = false;

function renderFilterTags() {
  const allTags = new Set();
  places.forEach(p => {
    if (filterState.cat === 'all' || p.category === filterState.cat)
      (p.tags || []).forEach(t => allTags.add(t));
  });
  const wrap       = document.getElementById('filter-tags');
  const activeTags = new Set(filterState.tags);
  wrap.innerHTML   = '';

  if (!allTags.size) {
    wrap.innerHTML = '<span style="font-size:11px;color:var(--ink3)">no tags yet</span>';
    updateFpTagsVal(); return;
  }

  const tagArr = [...allTags];
  const MAX    = 5;
  const visible = tagsExpanded ? tagArr : tagArr.slice(0, MAX);
  visible.forEach(tag => {
    const el = document.createElement('div');
    el.className = 'ftag' + (activeTags.has(tag) ? ' on' : '');
    el.textContent = tag;
    el.onclick = () => {
      el.classList.toggle('on');
      if (el.classList.contains('on')) filterState.tags.push(tag);
      else filterState.tags = filterState.tags.filter(t => t !== tag);
      updateFpTagsVal();
      renderPlaces();
    };
    wrap.appendChild(el);
  });
  if (tagArr.length > MAX) {
    const more = document.createElement('div');
    more.className = 'ftag';
    more.style.cssText = 'background:var(--cream2);color:var(--ink3);border-style:dashed';
    more.textContent = tagsExpanded ? 'less' : `+${tagArr.length - MAX}`;
    more.onclick = () => { tagsExpanded = !tagsExpanded; renderFilterTags(); };
    wrap.appendChild(more);
  }
  updateFpTagsVal();
}

function updateFpTagsVal() {
  const el = document.getElementById('fp-tags-val');
  if (el) el.textContent = filterState.tags.length ? filterState.tags.length + ' on' : '';
}

// ── FILTER CONTROLS ───────────────────────────────────────
function toggleFpSection(toggleEl) {
  const body  = toggleEl.nextElementSibling;
  const caret = toggleEl.querySelector('.fp-caret');
  const isOpen = body.classList.contains('open');
  body.classList.toggle('open', !isOpen);
  if (caret) caret.classList.toggle('open', !isOpen);
}

function setCat(cat, el) {
  document.querySelectorAll('.seg-btn').forEach(b => b.classList.remove('on'));
  el.classList.add('on');
  filterState.cat  = cat;
  filterState.tags = [];
  const catVal = document.getElementById('fp-cat-val');
  if (catVal) catVal.textContent = cat;
  renderFilterTags();
  renderPlaces();
}

function setMode(m) {
  ['r','t','b'].forEach(x => document.getElementById(`mc-${x}`).classList.remove('on'));
  document.getElementById(`mc-${m}`).classList.add('on');
  document.getElementById('sl-r').classList.toggle('off', m === 't');
  document.getElementById('sl-t').classList.toggle('off', m === 'r');
  document.getElementById('both-note').classList.toggle('show', m === 'b');
  filterState.mode = m;
  renderPlaces();
}

function updateSlider(type, val) {
  if (type === 'km') {
    filterState.km = parseInt(val);
    document.getElementById('rv-label').textContent = `${val} km`;
    const distVal = document.getElementById('fp-dist-val');
    if (distVal) distVal.textContent = `${val} km`;
  } else {
    filterState.min = parseInt(val);
    document.getElementById('tv-label').textContent = `${val} min`;
  }
  renderPlaces();
}

// ── PLACES STRIP TOGGLE ───────────────────────────────────
let placesStripOpen = false;

function togglePlacesStrip() {
  placesStripOpen = !placesStripOpen;
  const body    = document.getElementById('ps-body');
  const chevron = document.getElementById('ps-chevron');
  body.classList.toggle('open', placesStripOpen);
  chevron.classList.toggle('open', placesStripOpen);
}

// ── EVENTS ────────────────────────────────────────────────
const DAYS   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function getNextOccurrence(event) {
  const now = new Date();
  if (event.eventType === 'once') {
    if (!event.eventDateStart) return null;
    const endStr  = event.eventDateEnd || event.eventDateStart;
    const endDate = new Date(endStr + 'T23:59:59');
    if (endDate < now) return null;
    return new Date(event.eventDateStart + 'T' + (event.eventStart || '00:00'));
  }
  if (event.eventType === 'recurring' && event.eventDay != null) {
    const target = parseInt(event.eventDay);
    const d = new Date(now); d.setHours(0,0,0,0);
    const diff = (target - d.getDay() + 7) % 7;
    d.setDate(d.getDate() + (diff === 0 ? 0 : diff));
    if (event.eventStart) {
      const [h,mn] = event.eventStart.split(':').map(Number);
      d.setHours(h, mn, 0, 0);
      if (d < now) d.setDate(d.getDate() + 7);
    }
    return d;
  }
  return null;
}

function formatEventDate(event, nextDate) {
  if (!nextDate) return '';
  const now   = new Date();
  const today = new Date(now); today.setHours(0,0,0,0);
  const dDay  = new Date(nextDate); dDay.setHours(0,0,0,0);
  const diff  = Math.round((dDay - today) / 86400000);
  const timeStr = (nextDate.getHours() || nextDate.getMinutes())
    ? ` · ${String(nextDate.getHours()).padStart(2,'0')}:${String(nextDate.getMinutes()).padStart(2,'0')}` : '';

  // Multi-day event: show date range
  if (event.eventDateEnd && event.eventDateEnd !== event.eventDateStart) {
    const start = new Date(event.eventDateStart);
    const end   = new Date(event.eventDateEnd);
    return `${start.getDate()} ${MONTHS[start.getMonth()]} – ${end.getDate()} ${MONTHS[end.getMonth()]}`;
  }
  if (diff === 0) return `today${timeStr}`;
  if (diff === 1) return `tomorrow${timeStr}`;
  if (diff < 7)   return `${DAYS[nextDate.getDay()]}${timeStr}`;
  return `${nextDate.getDate()} ${MONTHS[nextDate.getMonth()]}${timeStr}`;
}

function renderEventsPanel() {
  const panel    = document.getElementById('events-panel');
  const upcoming = places
    .filter(p => p.category === 'event')
    .map(p => ({ ...p, _next: getNextOccurrence(p), _dist: haversine(userLat, userLng, p.lat, p.lng) }))
    .filter(p => {
      if (!p._next) return false;
      if ((filterState.mode === 'r' || filterState.mode === 'b') && p._dist > filterState.km) return false;
      return true;
    })
    .sort((a, b) => a._next - b._next);

  const showAll    = panel.dataset.showAll === 'true';
  const visible    = showAll ? upcoming : upcoming.slice(0, 7);
  const list       = document.getElementById('events-list');
  const seeMoreBtn = document.getElementById('events-seemore');

  if (!upcoming.length) {
    list.innerHTML = `<div style="font-size:12px;color:var(--ink3);text-align:center;padding:20px 0">no upcoming events</div>`;
    seeMoreBtn.style.display = 'none'; return;
  }

  let html = '', lastGroup = '';
  visible.forEach(p => {
    const dateStr = formatEventDate(p, p._next);
    const today   = new Date(); today.setHours(0,0,0,0);
    const dDay    = new Date(p._next); dDay.setHours(0,0,0,0);
    const diff    = Math.round((dDay - today) / 86400000);
    const group   = diff === 0 ? 'today' : diff <= 6 ? 'this week' : 'coming up';
    if (group !== lastGroup) {
      html += `<div style="font-size:9px;font-weight:600;color:var(--ink3);text-transform:uppercase;letter-spacing:0.1em;padding:8px 0 4px">${group}</div>`;
      lastGroup = group;
    }
    const tagsHtml  = (p.tags||[]).slice(0,2).map(t=>`<span style="font-size:9px;padding:1px 6px;border-radius:8px;background:#FEF3C7;color:#92400E;border:1px solid #FDE68A">${t}</span>`).join('');
    const recurStr  = p.eventType === 'recurring' ? `every ${DAYS[p.eventDay]}` : '';
    const timeRange = [p.eventStart, p.eventEnd].filter(Boolean).join(' – ');
    html += `
      <div onclick="focusPlace('${p.id}')" style="display:flex;align-items:flex-start;gap:10px;padding:9px 10px;background:var(--white);border:1px solid var(--border);border-radius:var(--radius-sm);cursor:pointer;margin-bottom:5px;transition:border-color 0.15s" onmouseover="this.style.borderColor='#D97706'" onmouseout="this.style.borderColor='var(--border)'">
        <div style="font-size:20px;flex-shrink:0;margin-top:1px">📅</div>
        <div style="flex:1;min-width:0">
          <div style="font-size:12px;font-weight:500;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${p.name}</div>
          <div style="font-size:11px;color:#D97706;font-weight:500;margin-top:1px">${dateStr}${timeRange ? ' · ' + timeRange : ''}</div>
          ${recurStr ? `<div style="font-size:10px;color:var(--ink3)">${recurStr}</div>` : ''}
          <div style="display:flex;align-items:center;gap:6px;margin-top:4px;flex-wrap:wrap">
            <span style="font-size:10px;color:var(--ink3)">${p._dist.toFixed(1)} km away</span>
            ${tagsHtml}
          </div>
        </div>
      </div>`;
  });
  list.innerHTML = html;
  if (upcoming.length > 7 && !showAll) {
    seeMoreBtn.style.display = 'block';
    seeMoreBtn.textContent   = `see all ${upcoming.length} events`;
  } else seeMoreBtn.style.display = 'none';
}

function toggleEventsPanel() {
  const panel  = document.getElementById('events-panel');
  const isOpen = panel.classList.contains('open');
  if (isOpen) panel.classList.remove('open');
  else { panel.dataset.showAll = 'false'; renderEventsPanel(); panel.classList.add('open'); }
}

function toggleEventsOnMap() {
  eventsOnMap = !eventsOnMap;
  const btn = document.getElementById('events-map-toggle');
  if (btn) {
    btn.textContent   = eventsOnMap ? '📍 on map' : '📍 hidden';
    btn.style.background  = eventsOnMap ? '#FEF3C7' : 'var(--cream2)';
    btn.style.borderColor = eventsOnMap ? '#FDE68A' : 'var(--border)';
    btn.style.color       = eventsOnMap ? '#92400E' : 'var(--ink3)';
  }
  renderPlaces();
}

function toggleRouteLabels() {
  routeLabelsVisible = !routeLabelsVisible;
  const btn = document.getElementById('route-labels-toggle');
  if (btn) { btn.textContent = routeLabelsVisible ? 'labels' : 'labels off'; btn.style.opacity = routeLabelsVisible ? '1' : '0.5'; }
  renderPlaces();
}

// ── IMPORT ────────────────────────────────────────────────
let importedPlaces = [], importState = {};

function openImportPanel() {
  if (!getActiveFile()) { showToast('pick a map first'); toggleProfileDropdown(); return; }
  importedPlaces = []; importState = {};
  showImportStep(1);
  document.getElementById('import-panel').style.display = 'flex';
}

function closeImportPanel() {
  document.getElementById('import-panel').style.display = 'none';
}

function showImportStep(n) {
  document.getElementById('import-step1').style.display   = n === 1 ? 'flex' : 'none';
  document.getElementById('import-step2').style.display   = n === 2 ? 'flex' : 'none';
  document.getElementById('import-save-wrap').style.display = n === 2 ? 'block' : 'none';
  document.getElementById('istep-1').style.color = n === 1 ? 'var(--red)' : 'var(--green)';
  document.getElementById('istep-1').style.borderBottomColor = n === 1 ? 'var(--red)' : 'var(--green)';
  document.getElementById('istep-2').style.color = n === 2 ? 'var(--red)' : 'var(--ink3)';
  document.getElementById('istep-2').style.borderBottomColor = n === 2 ? 'var(--red)' : 'transparent';
}

function handleImportDrop(e) {
  e.preventDefault();
  document.getElementById('import-dropzone').style.borderColor = 'var(--border)';
  document.getElementById('import-dropzone').style.background  = 'var(--white)';
  const file = e.dataTransfer.files[0];
  if (file) parseImportFile(file);
}

function handleImportFile(inp) { const file = inp.files[0]; if (file) parseImportFile(file); }

function parseImportFile(file) {
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const raw      = JSON.parse(e.target.result);
      const features = raw.features || (Array.isArray(raw) ? raw : []);
      importedPlaces = features
        .filter(f => f.geometry && f.geometry.coordinates)
        .map((f, i) => {
          const props  = f.properties || {}, coords = f.geometry.coordinates;
          const name   = props['Title'] || props['name'] || (props['Location'] && props['Location']['Address']) || 'Unnamed';
          return { _id: 'imp_' + i, name: name.trim(), lat: parseFloat(coords[1]), lng: parseFloat(coords[0]), mapsUrl: props['Google Maps URL'] || '', address: props['Location']?.Address || '' };
        })
        .filter(p => p.lat && p.lng && !isNaN(p.lat) && !isNaN(p.lng));

      if (!importedPlaces.length) { showToast('no places found — wrong file?'); return; }
      importedPlaces.forEach(p => { importState[p._id] = { selected: true, category: 'eatery', tags: [] }; });
      renderImportList();
      showImportStep(2);
      document.getElementById('import-total-count').textContent  = `${importedPlaces.length} places found`;
      document.getElementById('import-select-all').checked = true;
      updateImportSelectedCount();
      showToast(`${importedPlaces.length} places loaded ✓`);
    } catch { showToast("couldn't read file"); }
  };
  reader.readAsText(file);
}

function renderImportList() {
  const list = document.getElementById('import-place-list');
  list.innerHTML = importedPlaces.map(p => {
    const state     = importState[p._id];
    const dist      = haversine(userLat, userLng, p.lat, p.lng);
    const tagsHtml  = state.tags.map(t => `<span onclick="removeImportTag('${p._id}','${t}')" style="font-size:10px;padding:2px 7px;border-radius:10px;background:var(--red-soft);color:#712B13;border:1px solid var(--red-border);cursor:pointer">${t} ×</span>`).join('');
    const catColors = { eatery: ['#7C3AED','#EDE9FE'], activity: ['#0EA5E9','#E0F2FE'], event: ['#D97706','#FEF3C7'] };
    const catIcons  = { eatery: '🍴', activity: '⭐', event: '📅' };
    const catBtns   = ['eatery','activity','event'].map(c => {
      const [col, bg] = catColors[c];
      const active    = state.category === c;
      return `<div onclick="setImportCategory('${p._id}','${c}')" style="padding:3px 9px;border-radius:20px;font-size:11px;cursor:pointer;border:1px solid ${active?col:'var(--border)'};background:${active?bg:'var(--cream)'};color:${active?col:'var(--ink3)'}">${catIcons[c]}</div>`;
    }).join('');
    return `<div id="irow-${p._id}" style="background:var(--white);border:1px solid var(--border);border-radius:var(--radius-sm);padding:10px 12px;opacity:${state.selected?'1':'0.45'}">
      <div style="display:flex;align-items:flex-start;gap:8px">
        <input type="checkbox" ${state.selected?'checked':''} onchange="toggleImportSelect('${p._id}',this.checked)" style="width:15px;height:15px;accent-color:var(--red);cursor:pointer;flex-shrink:0;margin-top:2px">
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;flex-wrap:wrap">
            <div style="font-size:13px;font-weight:500;color:var(--ink);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${p.name}</div>
            <div style="font-size:10px;color:var(--ink3)">${dist.toFixed(1)} km</div>
          </div>
          ${p.address ? `<div style="font-size:10px;color:var(--ink3);margin-bottom:6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${p.address}</div>` : ''}
          <div style="display:flex;gap:4px;margin-bottom:7px">${catBtns}</div>
          <div style="display:flex;flex-wrap:wrap;gap:4px;align-items:center">
            ${tagsHtml}
            <input placeholder="+ tag" onkeydown="if(event.key==='Enter'||event.key===','){addImportTag('${p._id}',this.value);this.value='';event.preventDefault()}" onblur="if(this.value.trim()){addImportTag('${p._id}',this.value);this.value=''}" style="border:1px dashed var(--border);border-radius:20px;padding:2px 8px;font-size:11px;width:60px;outline:none;background:transparent;font-family:inherit;color:var(--ink)"/>
          </div>
        </div>
      </div>
    </div>`;
  }).join('');
}

function toggleImportSelect(id, checked) {
  importState[id].selected = checked;
  updateImportSelectedCount();
  const row = document.getElementById('irow-' + id);
  if (row) row.style.opacity = checked ? '1' : '0.45';
}
function toggleSelectAll(checked) { Object.keys(importState).forEach(id => { importState[id].selected = checked; }); renderImportList(); updateImportSelectedCount(); }
function updateImportSelectedCount() { document.getElementById('import-selected-count').textContent = `${Object.values(importState).filter(s=>s.selected).length} selected`; }
function setImportCategory(id, cat) { importState[id].category = cat; renderImportList(); }
function batchSetCategory(cat) { Object.keys(importState).forEach(id => { if (importState[id].selected) importState[id].category = cat; }); renderImportList(); }
function addImportTag(id, val) { const tag = val.trim().replace(',',''); if (tag && !importState[id].tags.includes(tag)) { importState[id].tags.push(tag); renderImportList(); } }
function removeImportTag(id, tag) { importState[id].tags = importState[id].tags.filter(t => t !== tag); renderImportList(); }

async function saveImportedPlaces() {
  const toSave = importedPlaces.filter(p => importState[p._id].selected);
  if (!toSave.length) { showToast('select at least one place'); return; }
  showToast(`saving ${toSave.length} places…`);
  const newPlaces = toSave.map(p => ({
    id: Date.now().toString() + '_' + Math.random().toString(36).slice(2,6),
    name: p.name, lat: p.lat, lng: p.lng,
    mapsUrl: p.mapsUrl || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.name)}`,
    category: importState[p._id].category, tags: importState[p._id].tags, note: '',
    savedAt: new Date().toISOString()
  }));
  const existingKeys = new Set(places.map(p => `${p.name}|${p.lat.toFixed(4)}|${p.lng.toFixed(4)}`));
  const deduped = newPlaces.filter(p => !existingKeys.has(`${p.name}|${p.lat.toFixed(4)}|${p.lng.toFixed(4)}`));
  if (deduped.length < newPlaces.length) showToast(`${newPlaces.length - deduped.length} duplicates skipped`);
  places = [...deduped, ...places];
  const ok = await saveData();
  if (ok) { showToast(`${deduped.length} places saved ✓`); closeImportPanel(); renderPlaces(); renderFilterTags(); }
  else showToast('save failed — check ⚙ settings');
}

// ── EXPORT LIST ───────────────────────────────────────────
async function exportPlacesList() {
  const allWithDist = places.map(p => {
    const dist      = haversine(userLat, userLng, p.lat, p.lng);
    const cacheKey  = `${userLat.toFixed(4)},${userLng.toFixed(4)}-${p.lat.toFixed(4)},${p.lng.toFixed(4)}`;
    const cached    = routeCache[cacheKey];
    const travelMin = cached ? cached.minutes : Math.round((dist/40)*60);
    return { ...p, dist, travelMin };
  });
  const filtered = allWithDist.filter(p => {
    if (filterState.cat !== 'all' && p.category !== filterState.cat) return false;
    if (filterState.tags.length > 0 && !filterState.tags.some(t => (p.tags||[]).includes(t))) return false;
    if ((filterState.mode === 'r' || filterState.mode === 'b') && p.dist > filterState.km) return false;
    if ((filterState.mode === 't' || filterState.mode === 'b') && p.travelMin > filterState.min) return false;
    return true;
  }).sort((a,b) => a.dist - b.dist);

  const profiles = getProfiles(), active = getActiveFile();
  const profile  = profiles.find(p => p.file === active);
  const header   = `bah, jalan mana? — ${profile?.name || 'places'} (${filtered.length})\nsorted nearest → furthest\n${'─'.repeat(40)}\n`;
  const lines    = filtered.map((p,i) => {
    const cat  = p.category === 'eatery' ? '🍴' : p.category === 'activity' ? '⭐' : '📅';
    const tags = (p.tags||[]).join(', ');
    const maps = p.mapsUrl ? '\n   → ' + p.mapsUrl : '';
    const note = p.note ? '\n   "' + p.note + '"' : '';
    return `${i+1}. ${cat} ${p.name}\n   ${p.dist.toFixed(1)} km · ~${p.travelMin} min${tags ? ' · ' + tags : ''}${note}${maps}`;
  }).join('\n\n');

  try {
    await navigator.clipboard.writeText(header + '\n' + lines);
    showToast('list copied ✓');
  } catch {
    const a = document.createElement('a');
    a.href     = URL.createObjectURL(new Blob([header + '\n' + lines], { type: 'text/plain' }));
    a.download = `${profile?.name || 'places'}.txt`;
    a.click();
    showToast('list downloaded ✓');
  }
}

// ── SETTINGS ──────────────────────────────────────────────
function resetGitHubSettings() {
  [GH_TOKEN_KEY, GH_USER_KEY, GH_REPO_KEY].forEach(k => localStorage.removeItem(k));
  showToast('settings cleared — reload to reconnect');
}

function openSettings() {
  const u = document.getElementById('setup-user');
  const r = document.getElementById('setup-repo');
  const t = document.getElementById('token-input');
  const e = document.getElementById('token-error');
  if (u) u.value = getGHUser();
  if (r) r.value = getGHRepo();
  if (t) t.value = localStorage.getItem(GH_TOKEN_KEY) || '';
  if (e) e.textContent = '';
  document.getElementById('token-overlay').style.display = 'flex';

  document.getElementById('token-save-btn').onclick = () => {
    const user  = (u.value||'').trim();
    const repo  = (r.value||'').trim() || 'bahjalan';
    const token = (t.value||'').trim();
    if (!user) { e.textContent = 'enter your github username'; return; }
    if (token && !token.startsWith('ghp_') && !token.startsWith('github_pat_')) {
      e.textContent = 'token should start with ghp_ or github_pat_'; return;
    }
    localStorage.setItem(GH_USER_KEY, user);
    localStorage.setItem(GH_REPO_KEY, repo);
    if (token) localStorage.setItem(GH_TOKEN_KEY, token);
    document.getElementById('token-overlay').style.display = 'none';
    showToast('settings saved ✓');
    loadData(getActiveFile()).then(() => { renderPlaces(); renderFilterTags(); });
  };
  document.getElementById('token-cancel-btn').onclick = () => {
    document.getElementById('token-overlay').style.display = 'none';
  };
}

// ── MOBILE FILTER ─────────────────────────────────────────
function toggleMobileFilter() {
  const panel    = document.getElementById('filter-panel');
  const backdrop = document.getElementById('filter-backdrop');
  const isOpen   = panel.classList.contains('mobile-open');
  panel.classList.toggle('mobile-open', !isOpen);
  backdrop.classList.toggle('show', !isOpen);
}

function closeMobileFilter() {
  document.getElementById('filter-panel').classList.remove('mobile-open');
  document.getElementById('filter-backdrop').classList.remove('show');
}

// ── TOAST ─────────────────────────────────────────────────
let toastTimeout;
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => t.classList.remove('show'), 2800);
}
