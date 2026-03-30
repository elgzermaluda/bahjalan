# bah, jalan mana? 🗺️

your personal saved places map. filter by distance, travel time, tags, and opening hours.

## setup (5 minutes)

### 1. create the github repo

1. go to github.com → click **New repository**
2. name it `bahjalan` (or anything you want)
3. set it to **Public**
4. tick **Add a README file**
5. click **Create repository**

### 2. upload the files

upload these two files to your repo:
- `index.html`
- `app.js`

also create an empty `data.json` file with this content:
```json
{"places":[]}
```

### 3. edit app.js — set your username

open `app.js` and change the top two lines:
```js
const GH_USER = 'YOUR_GITHUB_USERNAME';  // ← your github username
const GH_REPO = 'bahjalan';              // ← your repo name (if different)
```

### 4. enable github pages

1. go to your repo → **Settings** → **Pages**
2. under **Source**, select **main** branch and **/ (root)**
3. click **Save**
4. wait ~1 minute, then your app is live at:
   `https://YOUR_USERNAME.github.io/bahjalan`

### 5. get your github token (for saving places)

1. go to github.com → your profile → **Settings**
2. scroll to **Developer settings** → **Personal access tokens** → **Tokens (classic)**
3. click **Generate new token (classic)**
4. give it a name like `bahjalan`
5. tick the **repo** scope
6. click **Generate token**
7. **copy the token** (you only see it once!)
8. the first time you save a place in the app, it will ask for this token
9. it gets stored in your browser — you only need to paste it once

---

## how to save a place

1. find the place on **Google Maps** (phone or browser)
2. tap **Share** → **Copy link**
3. open the app → tap **+ save place**
4. paste the link → tap **get info**
5. pick category + tags → optionally add hours
6. tap **save to my map** ✓

---

## features

- 🗺️ **real map** — openstreetmap, free forever
- 📍 **drag your pin** — or tap "use my location"
- 🔴 **tentacle lines** — visual lines to matching places
- 🏷️ **multi-tag filtering** — filter by any combo of tags
- ⏱️ **distance + travel time** — filter by km, minutes, or both
- 🕐 **hours filter** — "right now", or pick a day & time
- 💾 **github storage** — data lives in your own repo, no external database
- 📱 **mobile friendly** — works on phone browser

---

## tech stack

- leaflet.js (maps, free, no api key)
- osrm (routing/travel time, free, no api key)  
- nominatim (place search, free, no api key)
- github pages (hosting, free)
- github api (data storage, free)
