// ════════════════════════════════════════════════════════
//  BAH, JALAN MANA? — app.js
// ════════════════════════════════════════════════════════

// These are read from localStorage — set on first launch via the setup modal
const GH_FILE = 'data.json';
const GH_TOKEN_KEY = 'bjm_gh_token';
const GH_USER_KEY  = 'bjm_gh_user';
const GH_REPO_KEY  = 'bjm_gh_repo';

function getGHUser() { return localStorage.getItem(GH_USER_KEY) || ''; }
function getGHRepo() { return localStorage.getItem(GH_REPO_KEY) || 'bahjalan'; }

// ── STATE ────────────────────────────────────────────────
let map, userMarker, radiusCircle;
let userLat = 3.1390, userLng = 101.6869; // default: KL
let places = [];
let markers = {};
let tentacleLines = [];
let filterState = {
  cat: 'all',
  tags: [],
  mode: 'r',
  km: 12,
  min: 20,
  when: 'any',
  whenDay: null,
  whenTime: null
};
let currentStep = 1;
let currentCategory = 'eatery';
let editingId = null;

// ── INIT ─────────────────────────────────────────────────
window.onload = async () => {
  initMap();
  // Check if GitHub setup is complete — if not, show setup modal first
  if (!getGHUser()) {
    await showSetupModal();
  }
  await loadData();
  renderFilterTags();
  renderPlaces();
  initWhenDay();
};

function initMap() {
  map = L.map('map', { zoomControl: false }).setView([userLat, userLng], 13);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors',
    maxZoom: 19
  }).addTo(map);
  L.control.zoom({ position: 'bottomright' }).addTo(map);
  placeUserPin(userLat, userLng);
}

function initWhenDay() {
  const d = new Date();
  document.getElementById('when-day').value = d.getDay();
  const h = String(d.getHours()).padStart(2,'0');
  const m = String(d.getMinutes()).padStart(2,'0');
  document.getElementById('when-time').value = `${h}:${m}`;
}

// ── GITHUB STORAGE ───────────────────────────────────────
function getToken() {
  return localStorage.getItem(GH_TOKEN_KEY) || '';
}

async function loadData() {
  try {
    const url = `https://raw.githubusercontent.com/${getGHUser()}/${getGHRepo()}/main/${GH_FILE}?t=${Date.now()}`;
    const res = await fetch(url);
    if (!res.ok) { places = []; return; }
    const d = await res.json();
    places = d.places || [];
  } catch(e) { places = []; }
}

// First-time setup modal — collects username, repo name, token
function showSetupModal() {
  return new Promise(resolve => {
    const overlay = document.getElementById('token-overlay');
    overlay.style.display = 'flex';
    // pre-fill repo if already stored
    const repoInp = document.getElementById('setup-repo');
    if (repoInp) repoInp.value = getGHRepo();
    setTimeout(() => {
      const u = document.getElementById('setup-user');
      if (u) u.focus();
    }, 100);

    document.getElementById('token-save-btn').onclick = () => {
      const user = (document.getElementById('setup-user').value || '').trim();
      const repo = (document.getElementById('setup-repo').value || '').trim() || 'bahjalan';
      const token = (document.getElementById('token-input').value || '').trim();
      const err = document.getElementById('token-error');

      if (!user) { err.textContent = 'enter your github username'; return; }
      if (!token) { err.textContent = 'paste your github token'; return; }
      if (!token.startsWith('ghp_') && !token.startsWith('github_pat_')) {
        err.textContent = "token should start with ghp_ or github_pat_";
        return;
      }
      localStorage.setItem(GH_USER_KEY, user);
      localStorage.setItem(GH_REPO_KEY, repo);
      localStorage.setItem(GH_TOKEN_KEY, token);
      overlay.style.display = 'none';
      resolve();
    };
    document.getElementById('token-cancel-btn').onclick = () => {
      overlay.style.display = 'none';
      resolve();
    };
    document.getElementById('token-input').onkeydown = e => {
      if (e.key === 'Enter') document.getElementById('token-save-btn').click();
    };
  });
}

// Re-ask for token only (when 401 received)
function askForToken() {
  return new Promise(resolve => {
    const overlay = document.getElementById('token-overlay');
    overlay.style.display = 'flex';
    document.getElementById('token-input').value = '';
    document.getElementById('token-error').textContent = 'your token was rejected — paste a new one';
    setTimeout(() => document.getElementById('token-input').focus(), 100);

    document.getElementById('token-save-btn').onclick = () => {
      const token = (document.getElementById('token-input').value || '').trim();
      const err = document.getElementById('token-error');
      if (!token) { err.textContent = 'paste your token first'; return; }
      if (!token.startsWith('ghp_') && !token.startsWith('github_pat_')) {
        err.textContent = "should start with ghp_ or github_pat_";
        return;
      }
      localStorage.setItem(GH_TOKEN_KEY, token);
      overlay.style.display = 'none';
      resolve(token);
    };
    document.getElementById('token-cancel-btn').onclick = () => {
      overlay.style.display = 'none';
      resolve(null);
    };
  });
}

async function saveData(retryOnFail = true) {
  let token = getToken();
  if (!token) {
    token = await askForToken();
    if (!token) return false;
  }
  try {
    const apiUrl = `https://api.github.com/repos/${getGHUser()}/${getGHRepo()}/contents/${GH_FILE}`;
    const getRes = await fetch(apiUrl, {
      headers: { 'Authorization': `token ${token}`, 'Accept': 'application/vnd.github.v3+json' }
    });
    if (getRes.status === 401) {
      localStorage.removeItem(GH_TOKEN_KEY);
      if (retryOnFail) {
        showToast('token rejected — please enter it again');
        token = await askForToken();
        if (!token) return false;
        return saveData(false);
      }
      return false;
    }
    let sha = null;
    if (getRes.ok) { const j = await getRes.json(); sha = j.sha; }
    const content = btoa(unescape(encodeURIComponent(JSON.stringify({ places }, null, 2))));
    const body = { message: 'Update places', content, ...(sha && { sha }) };
    const putRes = await fetch(apiUrl, {
      method: 'PUT',
      headers: { 'Authorization': `token ${token}`, 'Accept': 'application/vnd.github.v3+json', 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!putRes.ok) {
      const errData = await putRes.json().catch(() => ({}));
      if (putRes.status === 403 || putRes.status === 404) {
        localStorage.removeItem(GH_TOKEN_KEY);
        showToast('permission error — make sure your token has "repo" scope');
        return false;
      }
      showToast('save failed — ' + (errData.message || putRes.status));
      return false;
    }
    return true;
  } catch(e) {
    showToast('network error — check your internet and try again');
    return false;
  }
}

// ── USER LOCATION ─────────────────────────────────────────
function placeUserPin(lat, lng) {
  if (userMarker) map.removeLayer(userMarker);
  // Draggable person icon — clearly "you are here"
  const icon = L.divIcon({
    className: '',
    html: `<div style="
      width:36px;height:36px;border-radius:50%;
      background:#1a1a2e;border:3px solid #fff;
      box-shadow:0 2px 10px rgba(0,0,0,0.35);
      display:flex;align-items:center;justify-content:center;
      font-size:18px;cursor:grab;user-select:none;
      transition:box-shadow 0.2s;
    " title="drag me to change location">🧍</div>`,
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
    // Clear route cache — new start point means all routes must be re-fetched
    Object.keys(routeCache).forEach(k => delete routeCache[k]);
    renderPlaces();
    showToast('location moved — recalculating routes...');
  });
  userMarker.bindTooltip('drag to move your location', { permanent: false, direction: 'top', offset: [0, -20] });
  updateRadiusCircle();
}

function useMyLocation() {
  if (!navigator.geolocation) { showToast('geolocation not supported on this device'); return; }
  showToast('getting your location...');
  navigator.geolocation.getCurrentPosition(pos => {
    userLat = pos.coords.latitude;
    userLng = pos.coords.longitude;
    map.setView([userLat, userLng], 14);
    placeUserPin(userLat, userLng);
    renderPlaces();
    showToast('location updated ✓');
  }, err => {
    showToast('could not get location — drag the 🧍 icon instead');
  }, { timeout: 8000 });
}

function updateRadiusCircle() {
  if (radiusCircle) map.removeLayer(radiusCircle);
  if (filterState.mode === 'r' || filterState.mode === 'b') {
    radiusCircle = L.circle([userLat, userLng], {
      radius: filterState.km * 1000,
      color: '#7C3AED', fillColor: '#7C3AED', fillOpacity: 0.06,
      weight: 2, dashArray: '6 5'
    }).addTo(map);
  }
}

// ── URL EXTRACTION ────────────────────────────────────────
let extractedLat = null, extractedLng = null, extractedName = null, extractedMapsUrl = null;

function onUrlInput(val) {
  const btn = document.getElementById('btn-extract');
  if (val.length > 10) {
    btn.textContent = 'get info';
    btn.classList.remove('loading');
  }
}

async function extractUrl() {
  const raw = document.getElementById('url-input').value.trim();
  if (!raw) { showToast('paste a link first'); return; }

  const btn = document.getElementById('btn-extract');
  btn.textContent = 'loading...';
  btn.classList.add('loading');

  extractedLat = null; extractedLng = null; extractedName = null;
  extractedMapsUrl = raw;

  let workingUrl = raw;

  // ── Step 1: resolve short URLs (maps.app.goo.gl or goo.gl) via CORS proxy ──
  if (raw.includes('goo.gl') || raw.includes('maps.app')) {
    try {
      const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(raw)}`;
      const res = await fetch(proxyUrl);
      const data = await res.json();
      // allorigins returns the final URL in the status field or we extract from contents
      // Try to find a google maps URL in the returned content/headers
      const finalUrl = data.status && data.status.url ? data.status.url : '';
      if (finalUrl && finalUrl.includes('google.com/maps')) {
        workingUrl = finalUrl;
      } else {
        // Try extracting from contents - look for canonical URL
        const match = data.contents && data.contents.match(/href="(https:\/\/www\.google\.com\/maps\/[^"]+)"/);
        if (match) workingUrl = match[1];
      }
    } catch(e) {
      // fallback — try corsproxy.io
      try {
        const res2 = await fetch(`https://corsproxy.io/?${encodeURIComponent(raw)}`);
        const text = await res2.text();
        const match = text.match(/https:\/\/www\.google\.com\/maps\/place\/[^\s"']+/);
        if (match) workingUrl = match[0];
      } catch(e2) {}
    }
  }

  // ── Step 2: extract coords from the resolved URL ──
  const coordMatch = workingUrl.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (coordMatch) {
    extractedLat = parseFloat(coordMatch[1]);
    extractedLng = parseFloat(coordMatch[2]);
  }

  // ── Step 3: extract name from URL ──
  const placeMatch = workingUrl.match(/\/place\/([^/@?&]+)/);
  if (placeMatch) {
    extractedName = decodeURIComponent(placeMatch[1].replace(/\+/g, ' '))
      .replace(/_/g, ' ')
      .replace(/\+/g, ' ')
      .trim();
    // Clean up — remove anything after a comma if it looks like address noise
    if (extractedName.includes(',')) extractedName = extractedName.split(',')[0].trim();
  }

  // ── Step 4: also try query param q= for search-style URLs ──
  if (!extractedName) {
    const qMatch = workingUrl.match(/[?&]q=([^&]+)/);
    if (qMatch) extractedName = decodeURIComponent(qMatch[1].replace(/\+/g, ' '));
  }

  // ── Step 5: if still no coords, search Nominatim with extracted name ──
  if (!extractedLat && extractedName) {
    try {
      const q = encodeURIComponent(extractedName);
      const r = await fetch(`https://nominatim.openstreetmap.org/search?q=${q}&format=json&limit=1`, {
        headers: { 'Accept-Language': 'en', 'User-Agent': 'BahJalanMana/1.0' }
      });
      const data = await r.json();
      if (data.length > 0) {
        extractedLat = parseFloat(data[0].lat);
        extractedLng = parseFloat(data[0].lon);
      }
    } catch(e) {}
  }

  btn.textContent = 'get info';
  btn.classList.remove('loading');

  const nameEl = document.getElementById('extracted-name');
  const coordEl = document.getElementById('extracted-coords');

  if (extractedLat && extractedLng) {
    nameEl.textContent = extractedName || 'name not detected — add a note below';
    nameEl.className = 'row-val extracted';
    coordEl.textContent = `${extractedLat.toFixed(5)}° N, ${extractedLng.toFixed(5)}° E`;
    coordEl.className = 'row-val extracted';
    map.setView([extractedLat, extractedLng], 15);
    showToast('place found ✓');
  } else {
    nameEl.textContent = 'could not read link — try the full browser URL';
    nameEl.className = 'row-val auto';
    coordEl.textContent = 'open maps in browser → copy the full URL from address bar';
    coordEl.className = 'row-val auto';
    showToast('try the full URL from your browser instead');
  }
}

// ── SAVE PANEL ────────────────────────────────────────────
function openSavePanel() {
  editingId = null;
  extractedLat = null; extractedLng = null; extractedName = null; extractedMapsUrl = null;
  document.getElementById('url-input').value = '';
  document.getElementById('extracted-name').textContent = '— paste a link above';
  document.getElementById('extracted-name').className = 'row-val auto';
  document.getElementById('extracted-coords').textContent = '— extracted from link';
  document.getElementById('extracted-coords').className = 'row-val auto';
  document.getElementById('place-note').value = '';
  resetTags();
  resetHours();
  setCategory('eatery');
  goStep(1);
  document.getElementById('save-panel').classList.add('open');
}

function closeSavePanel() {
  document.getElementById('save-panel').classList.remove('open');
}

function goStep(n) {
  [1,2,3].forEach(i => {
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
  document.getElementById('cat-eatery').classList.toggle('on', cat === 'eatery');
  document.getElementById('cat-activity').classList.toggle('on', cat === 'activity');
  document.getElementById('eat-tag-block').style.display = cat === 'eatery' ? '' : 'none';
  document.getElementById('act-tag-block').style.display = cat === 'activity' ? '' : 'none';
}

function addCustomTag(presetId, inputId) {
  const inp = document.getElementById(inputId);
  const val = inp.value.trim();
  if (!val) return;
  const t = document.createElement('div');
  t.className = 'tp-tag custom-tag on';
  t.onclick = () => t.classList.toggle('on');
  const rm = document.createElement('span');
  rm.textContent = ' ×';
  rm.style.cssText = 'cursor:pointer;opacity:0.6;font-size:10px';
  rm.onclick = e => { e.stopPropagation(); t.remove(); };
  t.textContent = val;
  t.appendChild(rm);
  document.getElementById(presetId).appendChild(t);
  inp.value = '';
}

function resetTags() {
  document.querySelectorAll('.tp-tag.custom-tag').forEach(t => t.remove());
  document.querySelectorAll('.tp-tag').forEach(t => {
    const def = ['cafe','theme park'];
    t.classList.toggle('on', def.includes(t.textContent.trim()));
  });
}

function getSelectedTags(presetId) {
  const tags = [];
  document.querySelectorAll(`#${presetId} .tp-tag.on`).forEach(t => {
    tags.push(t.textContent.replace(' ×','').trim());
  });
  return tags;
}

// ── HOURS ─────────────────────────────────────────────────
function toggleDay(cb) {
  const day = cb.dataset.day;
  const disabled = !cb.checked;
  document.getElementById(`h${day}s`).disabled = disabled;
  document.getElementById(`h${day}e`).disabled = disabled;
  if (disabled) {
    document.getElementById(`h${day}s`).value = '';
    document.getElementById(`h${day}e`).value = '';
  }
}

function resetHours() {
  const defaults = { 1:'08:00', 2:'08:00', 3:'08:00', 4:'08:00', 5:'08:00', 6:'09:00' };
  const defaultsE = { 1:'22:00', 2:'22:00', 3:'22:00', 4:'22:00', 5:'23:00', 6:'23:00' };
  [0,1,2,3,4,5,6].forEach(d => {
    const cb = document.querySelector(`.day-check[data-day="${d}"]`);
    const open = d !== 0;
    cb.checked = open;
    const si = document.getElementById(`h${d}s`);
    const ei = document.getElementById(`h${d}e`);
    si.disabled = !open; ei.disabled = !open;
    si.value = open ? (defaults[d] || '') : '';
    ei.value = open ? (defaultsE[d] || '') : '';
  });
}

function getHours() {
  const hours = {};
  [0,1,2,3,4,5,6].forEach(d => {
    const cb = document.querySelector(`.day-check[data-day="${d}"]`);
    if (!cb.checked) { hours[d] = null; return; }
    const s = document.getElementById(`h${d}s`).value;
    const e = document.getElementById(`h${d}e`).value;
    hours[d] = (s && e) ? { open: s, close: e } : 'unknown';
  });
  return hours;
}

// ── SAVE PLACE ────────────────────────────────────────────
async function savePlace() {
  if (!extractedLat || !extractedLng) {
    showToast('go back to step 1 and extract a link first');
    return;
  }
  const presetId = currentCategory === 'eatery' ? 'eat-presets' : 'act-presets';
  const tags = getSelectedTags(presetId);
  const note = document.getElementById('place-note').value.trim();
  const hours = getHours();
  const name = extractedName || 'unnamed place';

  const place = {
    id: editingId || Date.now().toString(),
    name,
    lat: extractedLat,
    lng: extractedLng,
    mapsUrl: extractedMapsUrl,
    category: currentCategory,
    tags,
    note,
    hours,
    savedAt: new Date().toISOString()
  };

  if (editingId) {
    places = places.map(p => p.id === editingId ? place : p);
  } else {
    places.unshift(place);
  }

  showToast('saving...');
  const ok = await saveData();
  if (ok) {
    showToast(`"${name}" saved!`);
    closeSavePanel();
    renderPlaces();
    renderFilterTags();
  } else {
    showToast('save failed — check your GitHub token');
  }
}

async function deletePlace(id) {
  if (!confirm('Remove this place?')) return;
  places = places.filter(p => p.id !== id);
  showToast('removing...');
  await saveData();
  showToast('place removed');
  map.closePopup();
  renderPlaces();
  renderFilterTags();
}

// ── DISTANCE & ROUTING ────────────────────────────────────
function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// Cache routes so we don't re-fetch on every re-render
const routeCache = {};

async function getRouteData(lat, lng) {
  const key = `${userLat.toFixed(4)},${userLng.toFixed(4)}-${lat.toFixed(4)},${lng.toFixed(4)}`;
  if (routeCache[key]) return routeCache[key];
  try {
    // overview=full gives us the actual road geometry as encoded polyline
    const url = `https://router.project-osrm.org/route/v1/driving/${userLng},${userLat};${lng},${lat}?overview=full&geometries=geojson`;
    const res = await fetch(url);
    const data = await res.json();
    if (data.routes && data.routes[0]) {
      const route = data.routes[0];
      const result = {
        minutes: Math.round(route.duration / 60),
        coords: route.geometry.coordinates.map(c => [c[1], c[0]]) // flip lng,lat → lat,lng for Leaflet
      };
      routeCache[key] = result;
      return result;
    }
  } catch(e) {}
  // Fallback: straight line estimate
  const km = haversine(userLat, userLng, lat, lng);
  const result = {
    minutes: Math.round((km / 40) * 60),
    coords: null // null = draw straight dashed line as fallback
  };
  routeCache[key] = result;
  return result;
}

async function getTravelTime(lat, lng) {
  const r = await getRouteData(lat, lng);
  return r.minutes;
}

// ── HOURS CHECK ───────────────────────────────────────────
function isOpenAt(place, targetDay, targetTime) {
  if (!place.hours) return null; // unknown
  const dayHours = place.hours[targetDay];
  if (dayHours === null) return false; // closed
  if (dayHours === 'unknown') return null; // unknown
  const [oh, om] = dayHours.open.split(':').map(Number);
  const [ch, cm] = dayHours.close.split(':').map(Number);
  const [th, tm] = targetTime.split(':').map(Number);
  const openMins = oh*60+om, closeMins = ch*60+cm, targetMins = th*60+tm;
  return targetMins >= openMins && targetMins <= closeMins;
}

function getOpenStatus(place) {
  if (filterState.when === 'any') return null;
  let day, time;
  if (filterState.when === 'now') {
    const now = new Date();
    day = now.getDay();
    const h = String(now.getHours()).padStart(2,'0');
    const m = String(now.getMinutes()).padStart(2,'0');
    time = `${h}:${m}`;
  } else {
    day = parseInt(document.getElementById('when-day').value);
    time = document.getElementById('when-time').value;
  }
  return isOpenAt(place, day, time);
}

function getStatusLabel(place) {
  const s = getOpenStatus(place);
  if (s === true) {
    // check if still open in 1hr for "right now"
    if (filterState.when === 'now') {
      const now = new Date();
      const day = now.getDay();
      const future = new Date(now.getTime() + 60*60*1000);
      const fh = String(future.getHours()).padStart(2,'0');
      const fm = String(future.getMinutes()).padStart(2,'0');
      const stillOpen = isOpenAt(place, day, `${fh}:${fm}`);
      if (stillOpen === false) return { label: 'closes within 1hr', open: true };
    }
    return { label: 'open now', open: true };
  }
  if (s === false) return { label: 'closed', open: false };
  if (!place.hours) return { label: 'no hours saved', open: null };
  return { label: 'unknown hours', open: null };
}

// ── FILTERING ─────────────────────────────────────────────
async function renderPlaces() {
  // Clear existing markers and tentacles
  Object.values(markers).forEach(m => map.removeLayer(m));
  markers = {};
  tentacleLines.forEach(l => map.removeLayer(l));
  tentacleLines = [];

  updateRadiusCircle();

  const matchedPlaces = [];
  const allWithDist = [];

  for (const p of places) {
    const dist = haversine(userLat, userLng, p.lat, p.lng);
    const routeData = await getRouteData(p.lat, p.lng);
    allWithDist.push({ ...p, dist, travelMin: routeData.minutes, routeData });
  }

  // filter
  const filtered = allWithDist.filter(p => {
    // category
    if (filterState.cat !== 'all' && p.category !== filterState.cat) return false;
    // tags
    if (filterState.tags.length > 0) {
      const has = filterState.tags.some(t => p.tags && p.tags.includes(t));
      if (!has) return false;
    }
    // distance
    if (filterState.mode === 'r' || filterState.mode === 'b') {
      if (p.dist > filterState.km) return false;
    }
    if (filterState.mode === 't' || filterState.mode === 'b') {
      if (p.travelMin > filterState.min) return false;
    }
    // hours
    if (filterState.when !== 'any') {
      const s = getOpenStatus(p);
      if (s === false) return false;
    }
    return true;
  });

  // Render all pins
  allWithDist.forEach(p => {
    const isMatch = filtered.some(f => f.id === p.id);
    addMarker(p, isMatch, p.dist, p.travelMin);
    if (isMatch) matchedPlaces.push({ ...p, isMatch });
  });

  // Road routes to matched places — using actual OSRM geometry
  for (const p of filtered) {
    const isEatery = p.category === 'eatery';
    // White outline first, then coloured line on top — makes it pop against any map colour
    const lineColor = isEatery ? '#6D28D9' : '#0284C7';
    const routeData = p.routeData || await getRouteData(p.lat, p.lng);
    const coords = routeData.coords || [[userLat, userLng], [p.lat, p.lng]];
    const isDashed = !routeData.coords;

    // White casing — makes line readable against red OSM roads
    const casing = L.polyline(coords, {
      color: '#ffffff', weight: 7, opacity: 0.85,
      ...(isDashed ? { dashArray: '8 6' } : {})
    }).addTo(map);
    tentacleLines.push(casing);

    // Coloured line on top
    const line = L.polyline(coords, {
      color: lineColor, weight: 4, opacity: 0.92,
      ...(isDashed ? { dashArray: '8 6' } : {})
    }).addTo(map);
    tentacleLines.push(line);

    // ── Route label: distance + time, floating at midpoint of the route ──
    const mid = coords[Math.floor(coords.length / 2)];
    const km = p.dist.toFixed(1);
    const mins = routeData.minutes;
    const labelHtml = `
      <div style="
        background:#ffffff;
        color:${lineColor};
        font-family:'DM Sans',sans-serif;font-size:11px;font-weight:700;
        padding:4px 9px;border-radius:20px;
        white-space:nowrap;
        box-shadow:0 2px 8px rgba(0,0,0,0.30);
        border:2px solid ${lineColor};
        pointer-events:none;
        letter-spacing:0.01em;
      ">${km} km · ${mins} min</div>`;
    const labelIcon = L.divIcon({
      className: '',
      html: labelHtml,
      iconAnchor: [44, 14]
    });
    const labelMarker = L.marker(mid, { icon: labelIcon, interactive: false }).addTo(map);
    tentacleLines.push(labelMarker);
  }

  renderStrip(allWithDist, filtered.map(f => f.id));
  renderFilterTags();
}

function addMarker(place, isMatch, dist, travelMin) {
  const isEatery = place.category === 'eatery';
  // Colours: purple for eateries, teal/blue for activities — both distinct from OSM red roads
  const matchColor = isEatery ? '#7C3AED' : '#0EA5E9';
  const matchBorder = isEatery ? '#EDE9FE' : '#E0F2FE';
  const dimColor = isEatery ? '#C4B5FD' : '#7DD3FC';
  const icon_emoji = isEatery ? '🍴' : '⭐';

  const color = isMatch ? matchColor : '#c8b8a0';
  const border = isMatch ? matchBorder : '#f0ebe3';
  const size = isMatch ? 32 : 26;
  const emoji = isMatch ? icon_emoji : (isEatery ? '🍴' : '⭐');
  const opacity = isMatch ? '1' : '0.72';

  const icon = L.divIcon({
    className: '',
    html: `<div style="
      width:${size}px;height:${size}px;border-radius:50%;
      background:${color};border:2.5px solid ${border};
      box-shadow:0 2px 6px rgba(0,0,0,0.22);
      display:flex;align-items:center;justify-content:center;
      font-size:${isMatch?14:10}px;opacity:${opacity};
      transition:all 0.2s;
    ">${emoji}</div>`,
    iconSize: [size, size], iconAnchor: [size/2, size/2]
  });
  const m = L.marker([place.lat, place.lng], { icon }).addTo(map);

  const status = getStatusLabel(place);
  const tagsHtml = (place.tags || []).map(t =>
    `<span class="popup-tag ${place.category==='activity'?'a':''}">${t}</span>`
  ).join('');
  const statusHtml = status.open === true
    ? `<div class="popup-status-open">${status.label}</div>`
    : status.open === false
    ? `<div class="popup-status-closed">${status.label}</div>`
    : status.label !== 'no hours saved'
    ? `<div class="popup-status-closed">${status.label}</div>` : '';
  const mapsHref = place.mapsUrl || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place.name)}`;
  const catLabel = isEatery ? '🍴 eatery' : '⭐ activity';

  m.bindPopup(`
    <div class="popup-inner">
      <div style="font-size:9px;color:${matchColor};font-weight:600;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:2px">${catLabel}</div>
      <div class="popup-name">${place.name}</div>
      <div class="popup-dist">${dist.toFixed(1)} km · ~${travelMin} min drive</div>
      ${place.note ? `<div style="font-size:10px;color:var(--ink2);margin-top:3px;font-style:italic">${place.note}</div>` : ''}
      <div class="popup-tags">${tagsHtml}</div>
      ${statusHtml}
      <div class="popup-btns">
        <a class="popup-btn primary" href="${mapsHref}" target="_blank">open in maps</a>
        <div class="popup-btn del" onclick="deletePlace('${place.id}')">remove</div>
      </div>
    </div>
  `);
  markers[place.id] = m;
}

function renderStrip(all, matchedIds) {
  const list = document.getElementById('ps-list');
  const count = document.getElementById('ps-count');

  if (all.length === 0) {
    list.innerHTML = '<div class="pcard no-places">no places saved yet — tap + save place to start</div>';
    count.textContent = '0 saved';
    return;
  }

  count.textContent = `${matchedIds.length} of ${all.length} match`;

  // Sort: matched first
  const sorted = [...all].sort((a,b) => {
    const am = matchedIds.includes(a.id) ? 0 : 1;
    const bm = matchedIds.includes(b.id) ? 0 : 1;
    return am - bm || a.dist - b.dist;
  });

  list.innerHTML = sorted.map(p => {
    const isMatch = matchedIds.includes(p.id);
    const status = getStatusLabel(p);
    const isEatery = p.category === 'eatery';
    const catIcon = isEatery ? '🍴' : '⭐';
    const catColor = isEatery ? '#7C3AED' : '#0EA5E9';
    const tagsHtml = (p.tags || []).map(t => `<span class="pctag ${p.category==='activity'?'a':''}">${t}</span>`).join('');
    const statusHtml = status.open === true
      ? `<div class="pc-status-open">${status.label}</div>`
      : `<div class="pc-status-closed">${status.label}</div>`;
    return `<div class="pcard ${isMatch ? 'match' : 'faded'}" onclick="focusPlace('${p.id}')" style="${isMatch ? `border-color:${catColor}40;` : ''}">
      <div style="display:flex;align-items:center;gap:5px;margin-bottom:3px">
        <span style="font-size:14px">${catIcon}</span>
        <div class="pc-name">${p.name}</div>
      </div>
      <div class="pc-dist">${p.dist.toFixed(1)} km</div>
      <div class="pc-time">~${p.travelMin} min drive</div>
      <div class="pc-tags">${tagsHtml}</div>
      ${filterState.when !== 'any' ? statusHtml : ''}
    </div>`;
  }).join('');
}

function focusPlace(id) {
  const m = markers[id];
  if (m) { map.setView(m.getLatLng(), 15); m.openPopup(); }
}

// ── FILTER TAG CHIPS ──────────────────────────────────────
function renderFilterTags() {
  const allTags = new Set();
  places.forEach(p => (p.tags || []).forEach(t => allTags.add(t)));
  const wrap = document.getElementById('filter-tags');
  const activeTags = new Set(filterState.tags);
  wrap.innerHTML = '';
  if (allTags.size === 0) {
    wrap.innerHTML = '<span style="font-size:11px;color:var(--ink3)">tags appear here once you save places</span>';
    return;
  }
  allTags.forEach(tag => {
    const el = document.createElement('div');
    el.className = 'ftag' + (activeTags.has(tag) ? ' on' : '');
    el.textContent = tag;
    el.onclick = () => {
      el.classList.toggle('on');
      if (el.classList.contains('on')) filterState.tags.push(tag);
      else filterState.tags = filterState.tags.filter(t => t !== tag);
      renderPlaces();
    };
    wrap.appendChild(el);
  });
}

// ── FILTER CONTROLS ───────────────────────────────────────
function setCat(cat, el) {
  document.querySelectorAll('.seg-btn').forEach(b => b.classList.remove('on'));
  el.classList.add('on');
  filterState.cat = cat;
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
  } else {
    filterState.min = parseInt(val);
    document.getElementById('tv-label').textContent = `${val} min`;
  }
  renderPlaces();
}

function setWhen(w) {
  ['any','now','pick'].forEach(x => document.getElementById(`wc-${x}`).classList.remove('on'));
  document.getElementById(`wc-${w}`).classList.add('on');
  filterState.when = w;
  const cc = document.getElementById('when-custom');
  const hint = document.getElementById('when-hint');
  if (w === 'any') { cc.classList.remove('show'); hint.textContent = 'showing all places regardless of hours'; }
  else if (w === 'now') { cc.classList.remove('show'); hint.textContent = 'only places open right now (still open in 1hr)'; }
  else { cc.classList.add('show'); hint.textContent = 'only places open at this day & time'; }
  renderPlaces();
}

document.getElementById('when-day').addEventListener('change', renderPlaces);
document.getElementById('when-time').addEventListener('change', renderPlaces);

// ── SEARCH ────────────────────────────────────────────────
function searchPlaces(q) {
  const lower = q.toLowerCase().trim();
  if (!lower) { renderPlaces(); return; }
  Object.entries(markers).forEach(([id, m]) => {
    const p = places.find(x => x.id === id);
    if (!p) return;
    const match = p.name.toLowerCase().includes(lower) || (p.tags || []).some(t => t.toLowerCase().includes(lower));
    m.setOpacity(match ? 1 : 0.2);
  });
}

// ── SETTINGS RESET ───────────────────────────────────────
function resetGitHubSettings() {
  localStorage.removeItem(GH_TOKEN_KEY);
  localStorage.removeItem(GH_USER_KEY);
  localStorage.removeItem(GH_REPO_KEY);
  showToast('settings cleared — reload to reconnect');
}

function openSettings() {
  // pre-fill existing values
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
    const user = (u.value || '').trim();
    const repo = (r.value || '').trim() || 'bahjalan';
    const token = (t.value || '').trim();
    if (!user) { e.textContent = 'enter your github username'; return; }
    if (!token) { e.textContent = 'paste your github token'; return; }
    if (!token.startsWith('ghp_') && !token.startsWith('github_pat_')) {
      e.textContent = "token should start with ghp_ or github_pat_";
      return;
    }
    localStorage.setItem(GH_USER_KEY, user);
    localStorage.setItem(GH_REPO_KEY, repo);
    localStorage.setItem(GH_TOKEN_KEY, token);
    document.getElementById('token-overlay').style.display = 'none';
    showToast('settings saved ✓');
    loadData().then(() => { renderPlaces(); renderFilterTags(); });
  };
  document.getElementById('token-cancel-btn').onclick = () => {
    document.getElementById('token-overlay').style.display = 'none';
  };
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
