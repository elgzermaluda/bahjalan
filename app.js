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
let eventsOnMap = true;      // toggle show/hide event pins on map
let routeLabelsVisible = true; // toggle show/hide km/min labels on routes
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
  // If no username stored on this device/browser, show setup modal
  // This fires on every new device — phone, laptop, friend's browser etc
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
  L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
    attribution: '© OpenStreetMap contributors © CARTO',
    subdomains: 'abcd',
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
  const user = getGHUser();
  const repo = getGHRepo();
  if (!user) {
    showToast('no username set — tap ⚙ to set up');
    places = [];
    return;
  }
  const url = `https://raw.githubusercontent.com/${user}/${repo}/main/${GH_FILE}?t=${Date.now()}`;
  showToast('loading from github...');
  try {
    const res = await fetch(url);
    if (!res.ok) {
      showToast(`load failed ${res.status} — check ⚙ username/repo`);
      places = [];
      return;
    }
    const d = await res.json();
    places = d.places || [];
    showToast(`loaded ${places.length} place${places.length !== 1 ? 's' : ''} ✓`);
  } catch(e) {
    showToast('network error loading data — check connection');
    places = [];
  }
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
      // Token is optional — only needed for saving/deleting
      if (token && !token.startsWith('ghp_') && !token.startsWith('github_pat_')) {
        err.textContent = "token should start with ghp_ or github_pat_";
        return;
      }
      localStorage.setItem(GH_USER_KEY, user);
      localStorage.setItem(GH_REPO_KEY, repo);
      if (token) localStorage.setItem(GH_TOKEN_KEY, token);
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
  if (!navigator.geolocation) {
    openManualLocation();
    return;
  }
  showToast('getting your location...');
  navigator.geolocation.getCurrentPosition(pos => {
    userLat = pos.coords.latitude;
    userLng = pos.coords.longitude;
    map.setView([userLat, userLng], 14);
    placeUserPin(userLat, userLng);
    Object.keys(routeCache).forEach(k => delete routeCache[k]);
    renderPlaces();
    showToast('location updated ✓');
  }, err => {
    showToast("GPS failed — enter location manually");
    setTimeout(openManualLocation, 600);
  }, { timeout: 8000 });
}

function openManualLocation() {
  document.getElementById('manual-loc-overlay').style.display = 'flex';
  document.getElementById('manual-loc-input').value = '';
  document.getElementById('manual-loc-error').textContent = '';
  setTimeout(() => document.getElementById('manual-loc-input').focus(), 100);
}

async function searchManualLocation() {
  const q = document.getElementById('manual-loc-input').value.trim();
  const err = document.getElementById('manual-loc-error');
  if (!q) { err.textContent = "enter a place name or area"; return; }
  const btn = document.getElementById('manual-loc-btn');
  btn.textContent = 'searching...';
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=5&countrycodes=my`, {
      headers: { 'Accept-Language': 'en', 'User-Agent': 'BahJalanMana/1.0' }
    });
    const data = await res.json();
    if (!data.length) { err.textContent = "place not found — try a different name"; btn.textContent = 'search'; return; }
    // Show results
    const resultsEl = document.getElementById('manual-loc-results');
    resultsEl.innerHTML = data.map((r,i) => `
      <div onclick="setManualLocation(${r.lat},${r.lon},'${r.display_name.split(',')[0].replace(/'/g,"")}')" style="
        padding:8px 10px;border-bottom:1px solid var(--border);cursor:pointer;font-size:12px;
        color:var(--ink);transition:background 0.1s;
      " onmouseover="this.style.background='var(--cream2)'" onmouseout="this.style.background=''">
        <div style="font-weight:500">${r.display_name.split(',')[0]}</div>
        <div style="font-size:10px;color:var(--ink3)">${r.display_name.split(',').slice(1,3).join(',')}</div>
      </div>`).join('');
    resultsEl.style.display = 'block';
  } catch(e) {
    err.textContent = "search failed — check connection";
  }
  btn.textContent = 'search';
}

function setManualLocation(lat, lng, name) {
  userLat = parseFloat(lat);
  userLng = parseFloat(lng);
  document.getElementById('manual-loc-overlay').style.display = 'none';
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
  // reset event fields
  const evOnce = document.querySelector('input[name="evtype"][value="once"]');
  if (evOnce) evOnce.checked = true;
  ['ev-date','ev-start','ev-end'].forEach(id => { const el = document.getElementById(id); if(el) el.value=''; });
  const evDay = document.getElementById('ev-day'); if(evDay) evDay.value='6';
  toggleEventType();
  resetTags();
  resetHours();
  setCategory('eatery');
  goStep(1);
  document.getElementById('save-panel').classList.add('open');
}

function closeSavePanel() {
  document.getElementById('save-panel').classList.remove('open');
  document.querySelector('.sp-title').textContent = 'save a place';
  editingId = null;
}

function editPlace(id) {
  const place = places.find(p => p.id === id);
  if (!place) return;
  map.closePopup();

  // Pre-fill step 1
  editingId = id;
  extractedLat = place.lat;
  extractedLng = place.lng;
  extractedName = place.name;
  extractedMapsUrl = place.mapsUrl;

  document.getElementById('url-input').value = place.mapsUrl || '';
  const nameEl = document.getElementById('extracted-name');
  const coordEl = document.getElementById('extracted-coords');
  nameEl.textContent = place.name;
  nameEl.className = 'row-val extracted';
  coordEl.textContent = `${place.lat.toFixed(5)}° N, ${place.lng.toFixed(5)}° E`;
  coordEl.className = 'row-val extracted';

  // Pre-fill step 2
  setCategory(place.category || 'eatery');
  resetTags();
  const presetId = place.category === 'activity' ? 'act-presets' : 'eat-presets';
  // First deselect all
  document.querySelectorAll(`#${presetId} .tp-tag`).forEach(t => t.classList.remove('on'));
  // Select saved tags
  (place.tags || []).forEach(tag => {
    let found = false;
    document.querySelectorAll(`#${presetId} .tp-tag`).forEach(t => {
      if (t.textContent.trim() === tag) { t.classList.add('on'); found = true; }
    });
    // If not a preset tag, add as custom
    if (!found) {
      const customInpId = place.category === 'activity' ? 'act-custom' : 'eat-custom';
      const fakeInp = document.getElementById(customInpId);
      const saved = fakeInp.value;
      fakeInp.value = tag;
      addCustomTag(presetId, customInpId);
      fakeInp.value = saved;
    }
  });
  document.getElementById('place-note').value = place.note || '';

  // Pre-fill step 3 (only for non-events)
  if (place.category !== 'event') {
    loadHoursIntoForm(place.hours);
  } else {
    // pre-fill event fields
    const evType = place.eventType || 'once';
    const radioEl = document.querySelector(`input[name="evtype"][value="${evType}"]`);
    if (radioEl) radioEl.checked = true;
    toggleEventType();
    if (place.eventDate) document.getElementById('ev-date').value = place.eventDate;
    if (place.eventDay != null) document.getElementById('ev-day').value = place.eventDay;
    if (place.eventStart) document.getElementById('ev-start').value = place.eventStart;
    if (place.eventEnd) document.getElementById('ev-end').value = place.eventEnd;
  }

  // Update panel title
  document.querySelector('.sp-title').textContent = 'edit place';
  goStep(1);
  document.getElementById('save-panel').classList.add('open');
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
  document.getElementById('cat-event').classList.toggle('on', cat === 'event');
  document.getElementById('eat-tag-block').style.display   = cat === 'eatery'   ? '' : 'none';
  document.getElementById('act-tag-block').style.display   = cat === 'activity' ? '' : 'none';
  document.getElementById('event-tag-block').style.display = cat === 'event'    ? '' : 'none';
  document.getElementById('event-fields').style.display    = cat === 'event'    ? '' : 'none';
  // hide hours step tab for events — events use date/time fields instead
  document.getElementById('step-tab-3').style.display = cat === 'event' ? 'none' : '';
  // update next button on step 2
  const nextBtn = document.getElementById('step2-next-btn');
  if (nextBtn) {
    nextBtn.textContent = cat === 'event' ? 'save to my map ✓' : 'next: hours →';
    nextBtn.onclick = cat === 'event' ? () => savePlace() : () => goStep(3);
  }
}

function toggleEventType() {
  const isRecurring = document.querySelector('input[name="evtype"]:checked')?.value === 'recurring';
  document.getElementById('ev-once-row').style.display  = isRecurring ? 'none' : '';
  document.getElementById('ev-recur-row').style.display = isRecurring ? '' : 'none';
  // update step 2 next button — events skip hours step
  const nextBtn = document.getElementById('step2-next-btn');
  if (nextBtn) {
    nextBtn.textContent = currentCategory === 'event' ? 'save to my map ✓' : 'next: hours →';
    nextBtn.onclick = currentCategory === 'event'
      ? () => savePlace()
      : () => goStep(3);
  }
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
let hoursMode = 'every';
let closedDays = new Set();

function setHoursMode(mode) {
  hoursMode = mode;
  document.getElementById('hmode-every').classList.toggle('on', mode === 'every');
  document.getElementById('hmode-custom').classList.toggle('on', mode === 'custom');
  document.getElementById('hours-everyday').style.display = mode === 'every' ? '' : 'none';
  document.getElementById('hours-custom').style.display = mode === 'custom' ? '' : 'none';
}

function toggleClosedDay(day) {
  const btn = document.getElementById(`dc-${day}`);
  if (closedDays.has(day)) {
    closedDays.delete(day);
    btn.classList.remove('closed');
  } else {
    closedDays.add(day);
    btn.classList.add('closed');
  }
}

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
  hoursMode = 'every';
  closedDays = new Set();
  setHoursMode('every');
  document.getElementById('hevery-s').value = '08:00';
  document.getElementById('hevery-e').value = '22:00';
  [0,1,2,3,4,5,6].forEach(d => {
    const btn = document.getElementById(`dc-${d}`);
    if (btn) btn.classList.remove('closed');
    const cb = document.querySelector(`.day-check[data-day="${d}"]`);
    if (!cb) return;
    const open = d !== 0;
    cb.checked = open;
    const si = document.getElementById(`h${d}s`);
    const ei = document.getElementById(`h${d}e`);
    si.disabled = !open; ei.disabled = !open;
    si.value = open ? (d===6?'09:00':'08:00') : '';
    ei.value = open ? (d>=5?'23:00':'22:00') : '';
  });
}

function getHours() {
  const hours = {};
  if (hoursMode === 'every') {
    const s = document.getElementById('hevery-s').value;
    const e = document.getElementById('hevery-e').value;
    [0,1,2,3,4,5,6].forEach(d => {
      hours[d] = closedDays.has(d) ? null : (s && e ? { open: s, close: e } : 'unknown');
    });
  } else {
    [0,1,2,3,4,5,6].forEach(d => {
      const cb = document.querySelector(`.day-check[data-day="${d}"]`);
      if (!cb || !cb.checked) { hours[d] = null; return; }
      const s = document.getElementById(`h${d}s`).value;
      const e = document.getElementById(`h${d}e`).value;
      hours[d] = (s && e) ? { open: s, close: e } : 'unknown';
    });
  }
  return hours;
}

function loadHoursIntoForm(hours) {
  if (!hours) { resetHours(); return; }
  // Detect if it looks like "every day" mode — all open days have same hours
  const openDays = Object.entries(hours).filter(([d,v]) => v && v !== null && v !== 'unknown');
  const times = openDays.map(([d,v]) => `${v.open}-${v.close}`);
  const allSame = times.length > 0 && times.every(t => t === times[0]);
  if (allSame && openDays.length >= 4) {
    setHoursMode('every');
    closedDays = new Set();
    const [os, oe] = times[0].split('-');
    document.getElementById('hevery-s').value = os;
    document.getElementById('hevery-e').value = oe;
    [0,1,2,3,4,5,6].forEach(d => {
      const val = hours[d];
      const btn = document.getElementById(`dc-${d}`);
      if (!val || val === null) { closedDays.add(Number(d)); if (btn) btn.classList.add('closed'); }
      else if (btn) btn.classList.remove('closed');
    });
  } else {
    setHoursMode('custom');
    [0,1,2,3,4,5,6].forEach(d => {
      const cb = document.querySelector(`.day-check[data-day="${d}"]`);
      if (!cb) return;
      const val = hours[d];
      if (!val || val === null) {
        cb.checked = false;
        document.getElementById(`h${d}s`).disabled = true;
        document.getElementById(`h${d}e`).disabled = true;
        document.getElementById(`h${d}s`).value = '';
        document.getElementById(`h${d}e`).value = '';
      } else {
        cb.checked = true;
        document.getElementById(`h${d}s`).disabled = false;
        document.getElementById(`h${d}e`).disabled = false;
        document.getElementById(`h${d}s`).value = val === 'unknown' ? '' : val.open;
        document.getElementById(`h${d}e`).value = val === 'unknown' ? '' : val.close;
      }
    });
  }
}

// ── SAVE PLACE ────────────────────────────────────────────
async function savePlace() {
  if (!extractedLat || !extractedLng) {
    showToast('go back to step 1 and extract a link first');
    return;
  }
  const presetId = currentCategory === 'eatery' ? 'eat-presets' : currentCategory === 'event' ? 'evt-presets' : 'act-presets';
  const tags = getSelectedTags(presetId);
  const note = document.getElementById('place-note').value.trim();
  const hours = getHours();
  const name = extractedName || 'unnamed place';

  // Event-specific fields
  let eventType = null, eventDay = null, eventDate = null, eventStart = null, eventEnd = null;
  if (currentCategory === 'event') {
    eventType  = document.querySelector('input[name="evtype"]:checked')?.value || 'once';
    eventDay   = eventType === 'recurring' ? document.getElementById('ev-day').value : null;
    eventDate  = eventType === 'once' ? document.getElementById('ev-date').value : null;
    eventStart = document.getElementById('ev-start').value || null;
    eventEnd   = document.getElementById('ev-end').value || null;
  }

  const place = {
    id: editingId || Date.now().toString(),
    name,
    lat: extractedLat,
    lng: extractedLng,
    mapsUrl: extractedMapsUrl,
    category: currentCategory,
    tags,
    note,
    hours: currentCategory === 'event' ? null : hours,
    ...(currentCategory === 'event' && { eventType, eventDay, eventDate, eventStart, eventEnd }),
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
    const dist = p._dist !== undefined ? p._dist : haversine(userLat, userLng, p.lat, p.lng);
    const routeData = await getRouteData(p.lat, p.lng);
    allWithDist.push({ ...p, dist, travelMin: routeData.minutes, routeData });
  }

  // filter
  const filtered = allWithDist.filter(p => {
    // category — events show in 'all' and 'event', not in eatery/activity tabs
    if (filterState.cat === 'eatery' && p.category !== 'eatery') return false;
    if (filterState.cat === 'activity' && p.category !== 'activity') return false;
    if (filterState.cat === 'event' && p.category !== 'event') return false;
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

  // Render all pins — skip event pins if toggled off
  allWithDist.forEach(p => {
    if (p.category === 'event' && !eventsOnMap) return;
    const isMatch = filtered.some(f => f.id === p.id);
    addMarker(p, isMatch, p.dist, p.travelMin);
    if (isMatch) matchedPlaces.push({ ...p, isMatch });
  });

  // Road routes to matched places — using actual OSRM geometry
  for (const p of filtered) {
    if (p.category === 'event' && !eventsOnMap) continue;
    const isEatery = p.category === 'eatery';
    // White outline first, then coloured line on top — makes it pop against any map colour
    const isEvent2 = p.category === 'event';
    const lineColor = isEatery ? '#6D28D9' : isEvent2 ? '#D97706' : '#0284C7';
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
      <div style="position:relative;display:inline-block;pointer-events:none;">
        <div style="
          background:#fff;
          border:2px solid ${lineColor};
          border-radius:6px;
          padding:5px 10px;
          font-family:'DM Sans',sans-serif;
          font-size:12px;font-weight:700;
          color:#1a1a1a;
          white-space:nowrap;
          box-shadow:0 2px 10px rgba(0,0,0,0.22);
          text-align:center;
          line-height:1.25;
        ">
          <div style="font-size:13px;font-weight:700;color:${lineColor}">${mins} min</div>
          <div style="font-size:10px;font-weight:500;color:#666;margin-top:1px">${km} km</div>
        </div>
        <div style="
          position:absolute;bottom:-8px;left:50%;transform:translateX(-50%);
          width:0;height:0;
          border-left:7px solid transparent;
          border-right:7px solid transparent;
          border-top:8px solid ${lineColor};
        "></div>
        <div style="
          position:absolute;bottom:-5px;left:50%;transform:translateX(-50%);
          width:0;height:0;
          border-left:5px solid transparent;
          border-right:5px solid transparent;
          border-top:6px solid #fff;
        "></div>
      </div>`;
    const labelIcon = L.divIcon({
      className: '',
      html: labelHtml,
      iconAnchor: [38, 50]
    });
    if (routeLabelsVisible) {
      const labelMarker = L.marker(mid, { icon: labelIcon, interactive: false }).addTo(map);
      tentacleLines.push(labelMarker);
    }
  }

  renderStrip(allWithDist, filtered.map(f => f.id));
  renderFilterTags();
  // refresh events panel if it's open
  const ep = document.getElementById('events-panel');
  if (ep && ep.classList.contains('open')) renderEventsPanel();
}

function addMarker(place, isMatch, dist, travelMin) {
  const cat = place.category;
  const isEatery  = cat === 'eatery';
  const isEvent   = cat === 'event';
  // 🍴 purple=eatery  ⭐ blue=activity  📅 amber=event
  const matchColor  = isEatery ? '#7C3AED' : isEvent ? '#D97706' : '#0EA5E9';
  const matchBorder = isEatery ? '#EDE9FE' : isEvent ? '#FEF3C7' : '#E0F2FE';
  const icon_emoji  = isEatery ? '🍴'      : isEvent ? '📅'      : '⭐';

  const color  = isMatch ? matchColor  : '#c8b8a0';
  const border = isMatch ? matchBorder : '#f0ebe3';
  const size   = isMatch ? 32 : 26;
  const emoji  = icon_emoji;
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
  const tagClass = place.category==='activity' ? 'a' : place.category==='event' ? 'e' : '';
  const tagsHtml = (place.tags || []).map(t =>
    `<span class="popup-tag ${tagClass}">${t}</span>`
  ).join('');
  const statusHtml = status.open === true
    ? `<div class="popup-status-open">${status.label}</div>`
    : status.open === false
    ? `<div class="popup-status-closed">${status.label}</div>`
    : status.label !== 'no hours saved'
    ? `<div class="popup-status-closed">${status.label}</div>` : '';
  const mapsHref = place.mapsUrl || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place.name)}`;
  const catLabel = isEatery ? '🍴 eatery' : isEvent ? '📅 event' : '⭐ activity';

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
        <div class="popup-btn" onclick="editPlace('${place.id}')">edit</div>
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
    const tcls = p.category==='activity'?'a':p.category==='event'?'e':'';
    const tagsHtml = (p.tags || []).map(t => `<span class="pctag ${tcls}">${t}</span>`).join('');
    const statusHtml = status.open === true
      ? `<div class="pc-status-open">${status.label}</div>`
      : `<div class="pc-status-closed">${status.label}</div>`;
    return `<div class="pcard ${isMatch ? 'match' : 'faded'}" style="${isMatch ? `border-color:${catColor}40;` : ''}">
      <div style="display:flex;align-items:center;gap:5px;margin-bottom:3px" onclick="focusPlace('${p.id}')">
        <span style="font-size:14px">${catIcon}</span>
        <div class="pc-name">${p.name}</div>
      </div>
      <div class="pc-dist" onclick="focusPlace('${p.id}')">${p.dist.toFixed(1)} km · ~${p.travelMin} min</div>
      <div class="pc-tags" onclick="focusPlace('${p.id}')">${tagsHtml}</div>
      ${filterState.when !== 'any' ? statusHtml : ''}
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
function renderFilterTags() {
  // Only show tags that belong to the current category filter
  const allTags = new Set();
  places.forEach(p => {
    if (filterState.cat === 'all' || p.category === filterState.cat) {
      (p.tags || []).forEach(t => allTags.add(t));
    }
  });
  const wrap = document.getElementById('filter-tags');
  const activeTags = new Set(filterState.tags);
  wrap.innerHTML = '';
  if (allTags.size === 0) {
    wrap.innerHTML = '<span style="font-size:11px;color:var(--ink3)">no tags yet</span>';
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
  filterState.tags = [];
  renderFilterTags(); // rebuild tag chips first (correct category)
  renderPlaces();     // then filter places with cleared tags
}

// ── EVENTS ────────────────────────────────────────────────
const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function getNextOccurrence(event) {
  const now = new Date();
  if (event.eventType === 'once') {
    if (!event.eventDate) return null;
    const d = new Date(event.eventDate + 'T' + (event.eventStart || '00:00'));
    return d < now ? null : d; // past = null
  }
  if (event.eventType === 'recurring' && event.eventDay != null) {
    // find next occurrence of this weekday
    const target = parseInt(event.eventDay);
    const d = new Date(now);
    d.setHours(0,0,0,0);
    const diff = (target - d.getDay() + 7) % 7;
    d.setDate(d.getDate() + (diff === 0 ? 0 : diff));
    if (event.eventStart) {
      const [h,m] = event.eventStart.split(':').map(Number);
      d.setHours(h, m, 0, 0);
      // if today but time already passed, next week
      if (d < now) d.setDate(d.getDate() + 7);
    }
    return d;
  }
  return null;
}

function formatEventDate(d) {
  if (!d) return '';
  const now = new Date();
  const today = new Date(now); today.setHours(0,0,0,0);
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate()+1);
  const dDay = new Date(d); dDay.setHours(0,0,0,0);
  const timeStr = d.getHours() || d.getMinutes()
    ? ` · ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
    : '';
  if (dDay.getTime() === today.getTime()) return `today${timeStr}`;
  if (dDay.getTime() === tomorrow.getTime()) return `tomorrow${timeStr}`;
  // within 7 days
  const diff = Math.round((dDay - today) / 86400000);
  if (diff < 7) return `${DAYS[d.getDay()]}${timeStr}`;
  return `${d.getDate()} ${MONTHS[d.getMonth()]}${timeStr}`;
}

function renderEventsPanel() {
  const panel = document.getElementById('events-panel');
  const eventPlaces = places.filter(p => p.category === 'event');

  // Attach next occurrence, distance, filter out past + apply distance filter, sort
  const upcoming = eventPlaces
    .map(p => ({ ...p, _next: getNextOccurrence(p), _dist: haversine(userLat, userLng, p.lat, p.lng) }))
    .filter(p => {
      if (p._next === null) return false;
      // respect distance filter
      if (filterState.mode === 'r' || filterState.mode === 'b') {
        if (p._dist > filterState.km) return false;
      }
      return true;
    })
    .sort((a,b) => a._next - b._next);

  const showAll = panel.dataset.showAll === 'true';
  const visible = showAll ? upcoming : upcoming.slice(0, 7);
  const list = document.getElementById('events-list');
  const seeMoreBtn = document.getElementById('events-seemore');

  if (upcoming.length === 0) {
    list.innerHTML = `<div style="font-size:12px;color:var(--ink3);text-align:center;padding:20px 0">no upcoming events — save an event to see it here</div>`;
    seeMoreBtn.style.display = 'none';
    return;
  }

  let html = '';
  let lastGroup = '';
  visible.forEach(p => {
    const dist = p._dist !== undefined ? p._dist : haversine(userLat, userLng, p.lat, p.lng);
    const dateStr = formatEventDate(p._next);
    // group header
    const now = new Date(); const today = new Date(now); today.setHours(0,0,0,0);
    const dDay = new Date(p._next); dDay.setHours(0,0,0,0);
    const diff = Math.round((dDay - today) / 86400000);
    const group = diff === 0 ? 'today' : diff <= 6 ? 'this week' : 'coming up';
    if (group !== lastGroup) {
      html += `<div style="font-size:9px;font-weight:600;color:var(--ink3);text-transform:uppercase;letter-spacing:0.1em;padding:8px 0 4px">${group}</div>`;
      lastGroup = group;
    }
    const tagsHtml = (p.tags||[]).slice(0,2).map(t=>`<span style="font-size:9px;padding:1px 6px;border-radius:8px;background:#FEF3C7;color:#92400E;border:1px solid #FDE68A">${t}</span>`).join('');
    const endStr = p.eventEnd ? ` – ${p.eventEnd}` : '';
    const recurStr = p.eventType==='recurring' ? `every ${DAYS[p.eventDay]}` : '';
    html += `
      <div onclick="focusPlace('${p.id}')" style="
        display:flex;align-items:flex-start;gap:10px;
        padding:9px 10px;background:var(--white);
        border:1px solid var(--border);border-radius:var(--radius-sm);
        cursor:pointer;margin-bottom:5px;transition:border-color 0.15s;
      " onmouseover="this.style.borderColor='#D97706'" onmouseout="this.style.borderColor='var(--border)'">
        <div style="font-size:20px;flex-shrink:0;margin-top:1px">📅</div>
        <div style="flex:1;min-width:0">
          <div style="font-size:12px;font-weight:500;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${p.name}</div>
          <div style="font-size:11px;color:#D97706;font-weight:500;margin-top:1px">${dateStr}${p.eventStart ? (recurStr ? '' : '') : ''}${endStr}</div>
          ${recurStr ? `<div style="font-size:10px;color:var(--ink3)">${recurStr}</div>` : ''}
          <div style="display:flex;align-items:center;gap:6px;margin-top:4px;flex-wrap:wrap">
            <span style="font-size:10px;color:var(--ink3)">${dist.toFixed(1)} km away</span>
            ${tagsHtml}
          </div>
        </div>
        <div style="font-size:10px;color:var(--ink3);white-space:nowrap;flex-shrink:0">${p.eventStart||''}${endStr}</div>
      </div>`;
  });
  list.innerHTML = html;
  if (upcoming.length > 7 && !showAll) {
    seeMoreBtn.style.display = 'block';
    seeMoreBtn.textContent = `see all ${upcoming.length} events`;
  } else {
    seeMoreBtn.style.display = 'none';
  }
}

function toggleRouteLabels() {
  routeLabelsVisible = !routeLabelsVisible;
  const btn = document.getElementById('route-labels-toggle');
  if (btn) {
    btn.textContent = routeLabelsVisible ? 'labels on' : 'labels off';
    btn.style.opacity = routeLabelsVisible ? '1' : '0.5';
  }
  renderPlaces();
}

function toggleEventsOnMap() {
  eventsOnMap = !eventsOnMap;
  const btn = document.getElementById('events-map-toggle');
  if (btn) {
    btn.textContent = eventsOnMap ? '📍 on map' : '📍 hidden';
    btn.style.background = eventsOnMap ? '#FEF3C7' : 'var(--cream2)';
    btn.style.borderColor = eventsOnMap ? '#FDE68A' : 'var(--border)';
    btn.style.color = eventsOnMap ? '#92400E' : 'var(--ink3)';
  }
  renderPlaces();
}

function toggleEventsPanel() {
  const panel = document.getElementById('events-panel');
  const isOpen = panel.classList.contains('open');
  if (isOpen) {
    panel.classList.remove('open');
  } else {
    panel.dataset.showAll = 'false';
    renderEventsPanel();
    panel.classList.add('open');
  }
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

// ── EXPORT LIST ──────────────────────────────────────────
async function exportPlacesList() {
  // Get current filtered+sorted places with distances
  const allWithDist = [];
  for (const p of places) {
    const dist = haversine(userLat, userLng, p.lat, p.lng);
    const routeData = await getRouteData(p.lat, p.lng);
    allWithDist.push({ ...p, dist, travelMin: routeData.minutes });
  }
  const filtered = allWithDist.filter(p => {
    if (filterState.cat !== 'all' && p.category !== filterState.cat) return false;
    if (filterState.tags.length > 0 && !filterState.tags.some(t => (p.tags||[]).includes(t))) return false;
    if (filterState.mode === 'r' || filterState.mode === 'b') { if (p.dist > filterState.km) return false; }
    if (filterState.mode === 't' || filterState.mode === 'b') { if (p.travelMin > filterState.min) return false; }
    return true;
  }).sort((a,b) => a.dist - b.dist);

  const isFiltered = filterState.cat !== 'all' || filterState.tags.length > 0 || filterState.mode !== 'r';
  const header = `bah, jalan mana? — ${isFiltered ? 'filtered' : 'all'} places (${filtered.length})
sorted nearest to furthest from current location
${'─'.repeat(40)}
`;
  const lines = filtered.map((p,i) => {
    const cat = p.category === 'eatery' ? '🍴' : p.category === 'activity' ? '⭐' : '📅';
    const tags = (p.tags||[]).join(', ');
    const maps = p.mapsUrl ? ('\n   → ' + p.mapsUrl) : '';
    const note = p.note ? ('\n   "' + p.note + '"') : '';
    const line1 = (i+1) + '. ' + cat + ' ' + p.name;
    const line2 = '   ' + p.dist.toFixed(1) + ' km · ~' + p.travelMin + ' min drive' + (tags ? ' · ' + tags : '') + note + maps;
    return line1 + '\n' + line2;
  }).join('\n\n');

  const text = header + '\n' + lines;
  // Copy to clipboard
  try {
    await navigator.clipboard.writeText(text);
    showToast('list copied to clipboard ✓');
  } catch(e) {
    // Fallback: create download
    const blob = new Blob([text], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'bahjalan-places.txt';
    a.click();
    showToast('list downloaded ✓');
  }
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

// ── PLACES STRIP TOGGLE ──────────────────────────────────
let placesStripOpen = true;
function togglePlacesStrip() {
  placesStripOpen = !placesStripOpen;
  const list = document.getElementById('ps-list');
  const chevron = document.getElementById('ps-chevron');
  const strip = document.getElementById('places-strip');
  if (list) list.style.display = placesStripOpen ? 'flex' : 'none';
  if (chevron) chevron.style.transform = placesStripOpen ? '' : 'rotate(180deg)';
  if (strip) strip.style.paddingBottom = placesStripOpen ? '' : '8px';
  // Move floating buttons up/down with the strip
  const stripH = strip ? strip.offsetHeight : 120;
  const base = stripH + 10;
  const evBtn = document.getElementById('events-toggle-btn');
  const fBtn = document.getElementById('filter-toggle-btn');
  if (evBtn) evBtn.style.bottom = base + 'px';
  if (fBtn) fBtn.style.bottom = base + 'px';
}

// ── MOBILE FILTER SHEET ──────────────────────────────────
function toggleMobileFilter() {
  const panel = document.getElementById('filter-panel');
  const backdrop = document.getElementById('filter-backdrop');
  const isOpen = panel.classList.contains('mobile-open');
  if (isOpen) {
    panel.classList.remove('mobile-open');
    backdrop.classList.remove('show');
  } else {
    panel.classList.add('mobile-open');
    backdrop.classList.add('show');
  }
}

function closeMobileFilter() {
  document.getElementById('filter-panel').classList.remove('mobile-open');
  document.getElementById('filter-backdrop').classList.remove('show');
}

// Close filter sheet when any filter change happens on mobile
function onFilterChange() {
  if (window.innerWidth <= 640) {
    setTimeout(closeMobileFilter, 300);
  }
}


// ── GOOGLE TAKEOUT IMPORT ─────────────────────────────────
let importedPlaces = []; // raw parsed places from JSON
let importState = {};    // id -> { selected, category, tags }

function openImportPanel() {
  importedPlaces = [];
  importState = {};
  showImportStep(1);
  document.getElementById('import-panel').style.display = 'flex';
}

function closeImportPanel() {
  document.getElementById('import-panel').style.display = 'none';
}

function showImportStep(n) {
  document.getElementById('import-step1').style.display = n === 1 ? 'flex' : 'none';
  document.getElementById('import-step2').style.display = n === 2 ? 'flex' : 'none';
  document.getElementById('import-save-wrap').style.display = n === 2 ? 'block' : 'none';
  document.getElementById('istep-1').style.color = n === 1 ? 'var(--red)' : 'var(--green)';
  document.getElementById('istep-1').style.borderBottomColor = n === 1 ? 'var(--red)' : 'var(--green)';
  document.getElementById('istep-2').style.color = n === 2 ? 'var(--red)' : 'var(--ink3)';
  document.getElementById('istep-2').style.borderBottomColor = n === 2 ? 'var(--red)' : 'transparent';
}

function handleImportDrop(e) {
  e.preventDefault();
  document.getElementById('import-dropzone').style.borderColor = 'var(--border)';
  document.getElementById('import-dropzone').style.background = 'var(--white)';
  const file = e.dataTransfer.files[0];
  if (file) parseImportFile(file);
}

function handleImportFile(inp) {
  const file = inp.files[0];
  if (file) parseImportFile(file);
}

function parseImportFile(file) {
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const raw = JSON.parse(e.target.result);
      // Google Takeout format: { features: [ { geometry, properties } ] }
      // or { type: "FeatureCollection", features: [...] }
      let features = [];
      if (raw.features) features = raw.features;
      else if (Array.isArray(raw)) features = raw;

      importedPlaces = features
        .filter(f => f.geometry && f.geometry.coordinates)
        .map((f, i) => {
          const props = f.properties || {};
          const coords = f.geometry.coordinates; // [lng, lat]
          const name = props['Title'] || props['name'] || props['Location'] && props['Location']['Address'] || 'Unnamed place';
          const url = props['Google Maps URL'] || props['url'] || '';
          const address = props['Location'] && props['Location']['Address'] || props['address'] || '';
          return {
            _id: 'import_' + i,
            name: name.trim(),
            lat: parseFloat(coords[1]),
            lng: parseFloat(coords[0]),
            mapsUrl: url,
            address
          };
        })
        .filter(p => p.lat && p.lng && !isNaN(p.lat) && !isNaN(p.lng));

      if (importedPlaces.length === 0) {
        showToast("no places found — make sure it's the Saved Places.json file");
        return;
      }

      // Init state for each place
      importedPlaces.forEach(p => {
        importState[p._id] = { selected: true, category: 'eatery', tags: [] };
      });

      renderImportList();
      showImportStep(2);
      document.getElementById('import-total-count').textContent = `${importedPlaces.length} places found`;
      document.getElementById('import-select-all').checked = true;
      updateImportSelectedCount();
      showToast(`${importedPlaces.length} places loaded ✓`);
    } catch(err) {
      showToast("could not read file — make sure it's the correct JSON file");
    }
  };
  reader.readAsText(file);
}

function renderImportList() {
  const list = document.getElementById('import-place-list');
  // Get all unique tags from existing saved places for suggestions
  const existingTags = new Set();
  places.forEach(p => (p.tags||[]).forEach(t => existingTags.add(t)));

  list.innerHTML = importedPlaces.map(p => {
    const state = importState[p._id];
    const dist = haversine(userLat, userLng, p.lat, p.lng);
    const catIcon = state.category === 'eatery' ? '🍴' : state.category === 'activity' ? '⭐' : '📅';
    const catColor = state.category === 'eatery' ? '#7C3AED' : state.category === 'activity' ? '#0EA5E9' : '#D97706';
    const tagsHtml = state.tags.map(t =>
      `<span onclick="removeImportTag('${p._id}','${t}')" style="font-size:10px;padding:2px 7px;border-radius:10px;background:var(--red-soft);color:#712B13;border:1px solid var(--red-border);cursor:pointer">${t} ×</span>`
    ).join('');

    return `<div id="irow-${p._id}" style="
      background:var(--white);border:1px solid ${state.selected ? 'var(--border)' : '#f0ebe3'};
      border-radius:var(--radius-sm);padding:10px 12px;
      opacity:${state.selected ? '1' : '0.45'};transition:all 0.15s;
    ">
      <div style="display:flex;align-items:flex-start;gap:8px">
        <input type="checkbox" ${state.selected ? 'checked' : ''} onchange="toggleImportSelect('${p._id}',this.checked)"
          style="width:15px;height:15px;accent-color:var(--red);cursor:pointer;flex-shrink:0;margin-top:2px">
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;flex-wrap:wrap">
            <div style="font-size:13px;font-weight:500;color:var(--ink);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${p.name}</div>
            <div style="font-size:10px;color:var(--ink3);flex-shrink:0">${dist.toFixed(1)} km</div>
          </div>
          ${p.address ? `<div style="font-size:10px;color:var(--ink3);margin-bottom:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${p.address}</div>` : ''}
          <!-- Category chips -->
          <div style="display:flex;gap:4px;margin-bottom:7px">
            <div onclick="setImportCategory('${p._id}','eatery')" style="padding:3px 9px;border-radius:20px;font-size:11px;cursor:pointer;border:1px solid ${state.category==='eatery'?'#7C3AED':'var(--border)'};background:${state.category==='eatery'?'#EDE9FE':'var(--cream)'};color:${state.category==='eatery'?'#4C1D95':'var(--ink3)'}">🍴</div>
            <div onclick="setImportCategory('${p._id}','activity')" style="padding:3px 9px;border-radius:20px;font-size:11px;cursor:pointer;border:1px solid ${state.category==='activity'?'#0EA5E9':'var(--border)'};background:${state.category==='activity'?'#E0F2FE':'var(--cream)'};color:${state.category==='activity'?'#0369A1':'var(--ink3)'}">⭐</div>
            <div onclick="setImportCategory('${p._id}','event')" style="padding:3px 9px;border-radius:20px;font-size:11px;cursor:pointer;border:1px solid ${state.category==='event'?'#D97706':'var(--border)'};background:${state.category==='event'?'#FEF3C7':'var(--cream)'};color:${state.category==='event'?'#92400E':'var(--ink3)'}">📅</div>
          </div>
          <!-- Tags -->
          <div style="display:flex;flex-wrap:wrap;gap:4px;align-items:center">
            ${tagsHtml}
            <div style="position:relative;display:inline-block">
              <input placeholder="+ tag" onkeydown="if(event.key==='Enter'||event.key===','){addImportTag('${p._id}',this.value);this.value='';event.preventDefault()}" onblur="if(this.value.trim()){addImportTag('${p._id}',this.value);this.value=''}"
                style="border:1px dashed var(--border);border-radius:20px;padding:2px 8px;font-size:11px;width:60px;outline:none;background:transparent;font-family:inherit;color:var(--ink)"/>
            </div>
          </div>
        </div>
      </div>
    </div>`;
  }).join('');
}

function toggleImportSelect(id, checked) {
  importState[id].selected = checked;
  updateImportSelectedCount();
  // update row opacity
  const row = document.getElementById('irow-' + id);
  if (row) row.style.opacity = checked ? '1' : '0.45';
}

function toggleSelectAll(checked) {
  Object.keys(importState).forEach(id => { importState[id].selected = checked; });
  renderImportList();
  updateImportSelectedCount();
}

function updateImportSelectedCount() {
  const count = Object.values(importState).filter(s => s.selected).length;
  document.getElementById('import-selected-count').textContent = `${count} selected`;
}

function setImportCategory(id, cat) {
  importState[id].category = cat;
  // re-render just that row
  renderImportList();
}

function batchSetCategory(cat) {
  Object.keys(importState).forEach(id => {
    if (importState[id].selected) importState[id].category = cat;
  });
  renderImportList();
}

function addImportTag(id, val) {
  const tag = val.trim().replace(',','');
  if (!tag) return;
  if (!importState[id].tags.includes(tag)) {
    importState[id].tags.push(tag);
    renderImportList();
  }
}

function removeImportTag(id, tag) {
  importState[id].tags = importState[id].tags.filter(t => t !== tag);
  renderImportList();
}

async function saveImportedPlaces() {
  const toSave = importedPlaces.filter(p => importState[p._id].selected);
  if (!toSave.length) { showToast("select at least one place"); return; }

  showToast(`saving ${toSave.length} places...`);

  const newPlaces = toSave.map(p => ({
    id: Date.now().toString() + '_' + Math.random().toString(36).slice(2,6),
    name: p.name,
    lat: p.lat,
    lng: p.lng,
    mapsUrl: p.mapsUrl || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.name)}`,
    category: importState[p._id].category,
    tags: importState[p._id].tags,
    note: '',
    hours: null,
    savedAt: new Date().toISOString()
  }));

  // Add to existing places, avoid duplicates by name+coords
  const existingKeys = new Set(places.map(p => `${p.name}|${p.lat.toFixed(4)}|${p.lng.toFixed(4)}`));
  const deduplicated = newPlaces.filter(p => {
    const key = `${p.name}|${p.lat.toFixed(4)}|${p.lng.toFixed(4)}`;
    return !existingKeys.has(key);
  });

  if (deduplicated.length < newPlaces.length) {
    showToast(`${newPlaces.length - deduplicated.length} duplicates skipped`);
  }

  places = [...deduplicated, ...places];
  const ok = await saveData();
  if (ok) {
    showToast(`${deduplicated.length} places saved ✓`);
    closeImportPanel();
    renderPlaces();
    renderFilterTags();
  } else {
    showToast('save failed — check ⚙ settings');
  }
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
