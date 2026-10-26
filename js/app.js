// NEON//NAV — live GPS tracking and turn-by-turn navigation.

import { buildStyle, LABEL_ANCHOR, COLORS } from './mapstyle.js';
import * as G from './geo.js';
import { fetchRoute, maneuverIcon } from './router.js';
import { search, reverse } from './geocode.js';
import { sfx, speak, initAudio, setAudio, setVoiceProfile, voiceFor } from './audio.js';
import { PERSONAS, personaById } from './personas.js';

const $ = (s) => document.querySelector(s);
const store = {
  get(k, d) { try { const v = localStorage.getItem(`neonnav.${k}`); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(`neonnav.${k}`, JSON.stringify(v)); } catch { /* private mode */ } },
};

// Voice prompt distances per travel mode: [early, prepare, now]
const PROMPTS = { car: [800, 250, 45], bike: [300, 100, 20], foot: [150, 50, 12] };
const SIM_SPEED = { car: 15, bike: 6, foot: 2.2 }; // m/s
const ARRIVE_RADIUS = { car: 30, bike: 20, foot: 15 };
const MAX_SPEED = { car: 140, bike: 40, foot: 12 }; // km/h, for the speed bar

const S = {
  fix: null,              // latest processed position fix
  realFix: null,          // latest fix from the device (kept while simulating)
  shown: null,            // animated marker position
  shownHeading: 0,
  anim: null,
  compass: null,
  follow: false,
  headingUp: store.get('headingUp', true),
  is3d: store.get('is3d', true),
  mode: store.get('mode', 'car'),
  audio: store.get('audio', true),
  dim: store.get('dim', 0),
  persona: store.get('persona', 'neon'),
  dest: null,
  route: null,
  nav: null,
  sim: null,
  trail: [],
  touched: false,
  autoZoomPausedUntil: 0,
  district: { at: 0, pos: null, busy: false },
};

// ═══ map ═══════════════════════════════════════════════════════════
const map = new maplibregl.Map({
  container: 'map',
  style: buildStyle(),
  center: [12, 28],
  zoom: 1.5,
  maxPitch: 78,
  attributionControl: false,
  fadeDuration: 200,
});
map.addControl(new maplibregl.AttributionControl({
  compact: true,
  customAttribution: 'Routing <a href="https://routing.openstreetmap.de/" target="_blank">FOSSGIS OSRM</a> · Search <a href="https://photon.komoot.io" target="_blank">Photon</a>',
}), 'bottom-right');
map.addControl(new maplibregl.ScaleControl({ maxWidth: 110 }), 'bottom-left');

const mapReady = new Promise((resolve) => map.on('load', resolve));
const EMPTY = { type: 'FeatureCollection', features: [] };

map.on('load', () => {
  document.querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show');
  map.addSource('graticule', { type: 'geojson', data: G.graticule(15) });
  map.addSource('accuracy', { type: 'geojson', data: EMPTY });
  map.addSource('trail', { type: 'geojson', data: EMPTY, lineMetrics: true });
  map.addSource('route', { type: 'geojson', data: EMPTY, lineMetrics: true });
  map.addSource('route-done', { type: 'geojson', data: EMPTY });

  const before = LABEL_ANCHOR;
  map.addLayer({ id: 'graticule', type: 'line', source: 'graticule', maxzoom: 7,
    paint: { 'line-color': COLORS.cyan, 'line-width': ['case', ['get', 'major'], 1.2, 0.6],
      'line-opacity': ['interpolate', ['linear'], ['zoom'], 0, 0.22, 6, 0] } }, before);
  map.addLayer({ id: 'accuracy-fill', type: 'fill', source: 'accuracy', paint: { 'fill-color': COLORS.cyan, 'fill-opacity': 0.07 } }, before);
  map.addLayer({ id: 'accuracy-line', type: 'line', source: 'accuracy', paint: { 'line-color': COLORS.cyan, 'line-width': 1, 'line-opacity': 0.4, 'line-dasharray': [2, 2] } }, before);
  map.addLayer({ id: 'trail', type: 'line', source: 'trail', layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 2, 18, 5],
      'line-gradient': ['interpolate', ['linear'], ['line-progress'], 0, 'rgba(2,215,242,0)', 1, 'rgba(2,215,242,0.75)'] } }, before);

  map.addLayer({ id: 'route-done', type: 'line', source: 'route-done', layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#7a7020', 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 2, 18, 8], 'line-opacity': 0.45, 'line-dasharray': [1, 1.5] } }, before);
  map.addLayer({ id: 'route-glow', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': COLORS.yellow, 'line-width': ['interpolate', ['linear'], ['zoom'], 4, 8, 12, 18, 18, 46],
      'line-blur': ['interpolate', ['linear'], ['zoom'], 4, 6, 18, 26], 'line-opacity': 0.35 } }, before);
  map.addLayer({ id: 'route-casing', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#1c1700', 'line-width': ['interpolate', ['linear'], ['zoom'], 4, 4, 12, 9, 18, 22] } }, before);
  map.addLayer({ id: 'route-line', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-width': ['interpolate', ['linear'], ['zoom'], 4, 2.5, 12, 5.5, 18, 15],
      'line-gradient': ['interpolate', ['linear'], ['line-progress'], 0, '#fff7a8', 0.15, COLORS.yellow, 1, '#ffb800'] } }, before);
  map.addLayer({ id: 'route-flow', type: 'line', source: 'route', layout: { 'line-join': 'round' },
    paint: { 'line-color': '#fffde0', 'line-width': ['interpolate', ['linear'], ['zoom'], 4, 1, 12, 2, 18, 4], 'line-dasharray': [0, 4, 3], 'line-opacity': 0.9 } }, before);

  animateRouteFlow();
});

// Marching-dash animation on the route (MapLibre "animate a line" pattern).
const DASHES = [[0, 4, 3], [0.5, 4, 2.5], [1, 4, 2], [1.5, 4, 1.5], [2, 4, 1], [2.5, 4, 0.5], [3, 4, 0],
  [0, 0.5, 3, 3.5], [0, 1, 3, 3], [0, 1.5, 3, 2.5], [0, 2, 3, 2], [0, 2.5, 3, 1.5], [0, 3, 3, 1], [0, 3.5, 3, 0.5]];
function animateRouteFlow() {
  let step = -1;
  setInterval(() => {
    if (!S.route) return;
    const next = Math.floor(performance.now() / 55) % DASHES.length;
    if (next !== step) { step = next; map.setPaintProperty('route-flow', 'line-dasharray', DASHES[step]); }
  }, 55);
}

// ═══ markers ═══════════════════════════════════════════════════════
const playerEl = document.createElement('div');
playerEl.className = 'player nofix';
playerEl.innerHTML = `<div class="player-cone"></div><div class="player-pulse"></div><div class="player-pulse p2"></div>
  <div class="player-ring"></div><svg class="player-arrow" viewBox="0 0 40 40"><path d="M20 3 L34 35 L20 27 L6 35 Z"/></svg>`;
const player = new maplibregl.Marker({ element: playerEl, rotationAlignment: 'map', pitchAlignment: 'map' });

const destEl = document.createElement('div');
destEl.className = 'dest-marker';
destEl.innerHTML = '<div class="dest-beam"></div><div class="dest-ring"></div><div class="dest-diamond"></div><div class="dest-label mono"></div>';
const destMarker = new maplibregl.Marker({ element: destEl, pitchAlignment: 'viewport', rotationAlignment: 'viewport' });

// ═══ boot sequence ═════════════════════════════════════════════════
async function boot() {
  const log = $('#boot-log');
  const bar = $('#boot-progress');
  const lines = [
    ['> NEON//NAV kernel 2.077 ............', 'ok', 'READY'],
    ['> uplink :: openfreemap vector grid ..', 'ok', 'LINKED'],
    ['> routing core :: osrm/fossgis ......', 'ok', 'ONLINE'],
    ['> geo-index :: photon ...............', 'ok', 'ONLINE'],
    ['> gps array :: satellite handshake ...', 'warn', 'STANDBY'],
    ['> cost of operation ..................', 'ok', '0.00 €$'],
  ];
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < lines.length; i++) {
    const [text, cls, status] = lines[i];
    const row = document.createElement('div');
    log.appendChild(row);
    for (let c = 0; c <= text.length; c += 3) { row.textContent = text.slice(0, c); await wait(8); }
    row.innerHTML = `${text} <span class="${cls}">${status}</span>`;
    bar.style.width = `${((i + 1) / lines.length) * 85}%`;
    await wait(90);
  }
  await mapReady;
  bar.style.width = '100%';
  const btn = $('#jack-in');
  btn.hidden = false;
  btn.focus();
  await new Promise((r) => btn.addEventListener('click', r, { once: true }));

  initAudio();
  setAudio(S.audio);
  sfx.boot();
  startCompass();
  $('#boot').classList.add('out');
  setTimeout(() => $('#boot').remove(), 900);
  startGPS();
  requestAnimationFrame(frame);
}

// ═══ GPS ═══════════════════════════════════════════════════════════
function startGPS() {
  if (!('geolocation' in navigator)) { setGps('denied', 'NO GPS HARDWARE'); return; }
  setGps('acquiring');
  navigator.geolocation.watchPosition(onGeo, onGeoError, { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 });
}

function onGeo(p) {
  const c = p.coords;
  S.realFix = {
    lnglat: [c.longitude, c.latitude], accuracy: c.accuracy, speed: c.speed,
    heading: c.heading, altitude: c.altitude, t: p.timestamp || Date.now(),
  };
  if (!S.sim) ingest(S.realFix);
}

function onGeoError(e) {
  if (S.sim) return;
  if (e.code === 1) {
    setGps('denied');
    toast('LOCATION ACCESS DENIED // SEARCH + SIM STILL WORK', 'err', 5000);
  } else if (!S.fix || S.fix.manual) {
    setGps('acquiring', 'SEARCHING SATELLITES');
  }
}

function setGps(state, text) {
  S.gps = state;
  const el = $('#gps');
  el.dataset.state = state;
  const labels = { off: 'GPS OFFLINE', acquiring: 'ACQUIRING…', locked: 'GPS LOCK', denied: 'GPS DENIED', sim: 'SIMULATED FEED', manual: 'NO FIX // MANUAL' };
  $('#gps-text').textContent = text || labels[state];
  playerEl.classList.toggle('nofix', state !== 'locked' && state !== 'sim');
}

function startCompass() {
  const handler = (e) => {
    let h = null;
    if (typeof e.webkitCompassHeading === 'number') h = e.webkitCompassHeading;
    else if (e.absolute && e.alpha != null) h = 360 - e.alpha;
    if (h == null) return;
    const screen = window.screen?.orientation?.angle ?? 0;
    S.compass = (h + screen + 360) % 360;
  };
  const DOE = window.DeviceOrientationEvent;
  if (!DOE) return;
  if (typeof DOE.requestPermission === 'function') {
    DOE.requestPermission().then((s) => s === 'granted' && addEventListener('deviceorientation', handler)).catch(() => {});
  } else if ('ondeviceorientationabsolute' in window) {
    addEventListener('deviceorientationabsolute', handler);
  } else {
    addEventListener('deviceorientation', handler);
  }
}

// Every position — real, simulated or manual — goes through here.
function ingest(fix) {
  const prev = S.fix;
  const first = !prev || prev.manual;

  let heading = fix.heading != null && !Number.isNaN(fix.heading) && (fix.speed ?? 0) > 0.7 ? fix.heading : null;
  if (heading == null && prev && !prev.manual) {
    const moved = G.haversine(prev.lnglat, fix.lnglat);
    if (moved > Math.max(4, (fix.accuracy || 10) * 0.6)) heading = G.bearing(prev.lnglat, fix.lnglat);
  }
  fix.course = heading ?? prev?.course ?? null;

  let speed = fix.speed;
  if ((speed == null || Number.isNaN(speed)) && prev && !prev.manual) {
    const dt = (fix.t - prev.t) / 1000;
    speed = dt > 0.3 ? G.haversine(prev.lnglat, fix.lnglat) / dt : prev.speedMs;
  }
  fix.speedMs = Math.max(0, speed || 0);

  S.fix = fix;
  S.anim = {
    from: S.shown ?? fix.lnglat,
    to: fix.lnglat,
    t0: performance.now(),
    dur: first ? 0 : Math.min(1500, Math.max(250, fix.t - (prev?.t ?? fix.t))),
  };
  if (!S.playerOnMap) { player.setLngLat(fix.lnglat).addTo(map); S.playerOnMap = true; }

  if (!fix.manual) {
    if (first && !S.sim) onFirstFix(fix);
    if (!S.sim) setGps('locked');
    const q = fix.accuracy == null ? 3 : fix.accuracy < 15 ? 3 : fix.accuracy < 40 ? 2 : 1;
    $('#gps').dataset.q = q;
    if (!S.sim) $('#gps-text').textContent = `GPS LOCK ±${Math.round(fix.accuracy || 0)}M`;
    pushTrail(fix.lnglat);
  }
  map.getSource('accuracy')?.setData(fix.accuracy && !S.sim && !fix.manual ? G.circle(fix.lnglat, fix.accuracy) : EMPTY);
  updateTelemetry(fix);
  if (S.nav) navTick(fix);
  updateDistrict(fix.lnglat);
}

function onFirstFix(fix) {
  sfx.lock();
  toast('SATELLITE LOCK ACQUIRED', 'info');
  say(persona().lock());
  if (S.route) return; // user is already looking at a planned route
  S.flying = true;
  map.flyTo({ center: fix.lnglat, zoom: 16.4, pitch: S.is3d ? 58 : 0, bearing: 0, duration: 5200, curve: 1.6, essential: true });
  map.once('moveend', () => { S.flying = false; setFollow(true, false); });
}

function pushTrail(p) {
  const last = S.trail[S.trail.length - 1];
  if (last && G.haversine(last, p) < 3) return;
  S.trail.push(p);
  if (S.trail.length > 600) S.trail.shift();
  if (S.trail.length > 1) {
    map.getSource('trail')?.setData({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: S.trail } });
  }
}

// ═══ per-frame: marker animation, camera, HUD ═══════════════════════
let lastProgressDraw = 0;
const compassRing = $('#compass-ring');
function frame(now) {
  requestAnimationFrame(frame);

  // idle globe spin until the first lock
  if (!S.fix && !S.touched && !S.dest && map.getZoom() < 3.5 && !map.isMoving()) {
    const c = map.getCenter();
    map.setCenter([c.lng + 0.04, c.lat]);
  }

  if (S.anim) {
    const a = S.anim;
    const k = a.dur ? Math.min(1, (now - a.t0) / a.dur) : 1;
    S.shown = [G.lerp(a.from[0], a.to[0], k), G.lerp(a.from[1], a.to[1], k)];

    const slow = (S.fix?.speedMs ?? 0) < 1.2;
    const target = slow && S.compass != null && !S.sim ? S.compass : S.fix?.course;
    if (target != null) S.shownHeading = G.lerpAngle(S.shownHeading, target, 0.12);

    player.setLngLat(S.shown).setRotation(S.shownHeading);

    if (S.follow && !map.isEasing() && !S.flying) {
      const cam = { center: S.shown };
      if (S.headingUp && target != null) cam.bearing = S.shownHeading;
      if (S.nav && now > S.autoZoomPausedUntil) {
        const z = map.getZoom();
        cam.zoom = G.lerp(z, speedZoom(S.fix?.speedMs ?? 0), 0.015);
      }
      map.jumpTo(cam);
    }

    if (S.nav?.progress && now - lastProgressDraw > 150) {
      lastProgressDraw = now;
      drawProgress(S.shown);
    }
  }

  compassRing.style.transform = `rotate(${-map.getBearing()}deg)`;
  updateOffscreen();
}

function speedZoom(ms) {
  const kmh = ms * 3.6;
  if (kmh < 8) return 17.6;
  if (kmh < 35) return 17;
  if (kmh < 70) return 16.2;
  if (kmh < 100) return 15.5;
  return 14.8;
}

function updateTelemetry(fix) {
  const [lng, lat] = fix.lnglat;
  $('#coords').textContent = `LAT ${lat.toFixed(6)} · LNG ${lng.toFixed(6)}`;
  const kmh = Math.round(fix.speedMs * 3.6);
  $('#speedo').hidden = !!fix.manual;
  $('#speed').textContent = kmh;
  $('#speed-arc').style.width = `${Math.min(100, (kmh / MAX_SPEED[S.mode]) * 100)}%`;
  $('#alt').textContent = fix.altitude != null ? `ALT ${Math.round(fix.altitude)} M` : '';
}

// District name for the HUD: player's position when tracked, else the map center.
async function updateDistrict(lnglat, force = false) {
  const d = S.district;
  const now = Date.now();
  if (d.busy) return;
  if (!force && d.pos && (now - d.at < 15000 || G.haversine(d.pos, lnglat) < 250)) return;
  d.busy = true;
  d.at = now;
  d.pos = lnglat;
  try {
    const r = await reverse(lnglat);
    if (!r) return;
    const name = [r.district, r.city].filter(Boolean).filter((v, i, arr) => arr.indexOf(v) === i).join(' // ') || r.title;
    const el = $('#district');
    if (el.textContent !== name.toUpperCase()) {
      el.textContent = name;
      el.classList.remove('flash');
      void el.offsetWidth;
      el.classList.add('flash');
    }
  } catch { /* offline: keep last */ } finally { d.busy = false; }
}

map.on('moveend', () => {
  if (S.fix && !S.fix.manual) return;
  if (map.getZoom() < 10) return;
  const c = map.getCenter();
  updateDistrict([c.lng, c.lat]);
});

// ═══ follow / camera modes ═════════════════════════════════════════
const landscapePhone = matchMedia('(orientation: landscape) and (max-height: 540px)');

function navPadding() {
  if (!S.nav) return { top: 0, bottom: 0, left: 0, right: 0 };
  if (landscapePhone.matches) return { top: Math.round(innerHeight * 0.3), bottom: 0, left: 340, right: 60 };
  return { top: Math.round(innerHeight * 0.38), bottom: 0, left: 0, right: 0 };
}

function setFollow(on, animate = true) {
  if (on && !S.shown) { toast('NO POSITION FIX YET', 'err'); return; }
  S.follow = on;
  $('#btn-follow').classList.toggle('on', on);
  syncWakeLock();
  if (on && animate) {
    map.easeTo({
      center: S.shown, zoom: S.nav ? speedZoom(S.fix?.speedMs ?? 0) : Math.max(map.getZoom(), 15.5),
      pitch: S.is3d ? (S.nav ? 62 : 55) : 0, bearing: S.headingUp ? S.shownHeading : 0,
      padding: navPadding(), duration: 1100,
    });
  } else if (on) {
    map.easeTo({ padding: navPadding(), duration: 600 });
  }
}

const userGesture = (e) => !!e.originalEvent;
map.on('dragstart', (e) => { if (userGesture(e) && S.follow) setFollow(false); });
map.on('rotatestart', (e) => { if (userGesture(e) && S.follow && S.headingUp) setFollow(false); });
map.on('zoomstart', (e) => { if (userGesture(e)) S.autoZoomPausedUntil = performance.now() + 12000; });
map.getCanvas().addEventListener('pointerdown', () => { S.touched = true; hideCtx(); closeResults(); });

$('#btn-follow').onclick = () => { sfx.click(); setFollow(!S.follow); };
$('#btn-heading').onclick = () => {
  sfx.click();
  S.headingUp = !S.headingUp;
  store.set('headingUp', S.headingUp);
  syncButtons();
  if (!S.headingUp) map.easeTo({ bearing: 0, duration: 600 });
  else if (S.follow) setFollow(true);
};
$('#btn-3d').onclick = () => {
  sfx.click();
  S.is3d = !S.is3d;
  store.set('is3d', S.is3d);
  syncButtons();
  map.easeTo({ pitch: S.is3d ? (S.nav ? 62 : 55) : 0, duration: 800 });
};
$('#btn-zoom-in').onclick = () => { sfx.tick(); S.autoZoomPausedUntil = performance.now() + 12000; map.zoomIn(); };
$('#btn-zoom-out').onclick = () => { sfx.tick(); S.autoZoomPausedUntil = performance.now() + 12000; map.zoomOut(); };
$('#btn-audio').onclick = () => {
  S.audio = !S.audio;
  store.set('audio', S.audio);
  setAudio(S.audio);
  syncButtons();
  sfx.click();
  toast(S.audio ? 'AUDIO + VOICE ONLINE' : 'AUDIO MUTED', 'info');
};
$('#btn-dim').onclick = () => {
  S.dim = (S.dim + 1) % 3;
  store.set('dim', S.dim);
  syncButtons();
  sfx.click();
  toast(['NIGHT DRIVE OFF', 'NIGHT DRIVE // DIM', 'NIGHT DRIVE // DARK'][S.dim], 'info');
};
$('#compass').onclick = () => {
  sfx.click();
  if (S.headingUp && S.follow) { S.headingUp = false; store.set('headingUp', false); syncButtons(); }
  map.easeTo({ bearing: 0, duration: 600 });
};

function syncButtons() {
  $('#btn-heading').classList.toggle('on', S.headingUp);
  $('#btn-3d').classList.toggle('on', S.is3d);
  $('#btn-audio').classList.toggle('on', S.audio);
  $('#btn-dim').classList.toggle('on', S.dim > 0);
  document.body.dataset.dim = S.dim;
  document.querySelectorAll('.mode').forEach((b) => b.classList.toggle('on', b.dataset.mode === S.mode));
}

// ═══ search ════════════════════════════════════════════════════════
const qEl = $('#q');
const resultsEl = $('#results');
let results = [];
let sel = -1;
let searchTimer = null;

qEl.addEventListener('input', () => {
  clearTimeout(searchTimer);
  const q = qEl.value.trim();
  if (q.length < 2) { closeResults(); return; }
  searchTimer = setTimeout(() => runSearch(q), 320);
});
qEl.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    if (!results.length) return;
    sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length;
    renderResults();
    sfx.tick();
  } else if (e.key === 'Enter') {
    e.preventDefault();
    clearTimeout(searchTimer);
    if (results.length) pickResult(results[Math.max(0, sel)]);
    else if (qEl.value.trim().length >= 2) runSearch(qEl.value.trim(), true);
  } else if (e.key === 'Escape') {
    closeResults();
    qEl.blur();
  }
});
qEl.addEventListener('focus', () => { if (results.length) resultsEl.hidden = false; });

async function runSearch(q, pickFirst = false) {
  const c = map.getCenter();
  const bias = S.fix?.lnglat ?? (map.getZoom() > 5 ? [c.lng, c.lat] : null);
  resultsEl.hidden = false;
  resultsEl.innerHTML = '<li class="r-empty">SCANNING NETWORK…</li>';
  try {
    results = await search(q, bias);
    sel = results.length ? 0 : -1;
    if (pickFirst && results.length) { pickResult(results[0]); return; }
    renderResults();
  } catch (err) {
    if (err.name === 'AbortError') return;
    resultsEl.innerHTML = '<li class="r-empty">SEARCH NODE UNREACHABLE — RETRY</li>';
  }
}

const KIND_GLYPH = { place: '◎', food: '¥', transit: '⇄', road: '═', address: '#', poi: '◆', coord: '⌖' };
function renderResults() {
  if (!results.length) { resultsEl.innerHTML = '<li class="r-empty">NO MATCHES IN THE NET</li>'; return; }
  const from = S.fix?.lnglat;
  resultsEl.innerHTML = results.map((r, i) => `
    <li role="option" data-i="${i}" class="${i === sel ? 'sel' : ''}">
      <span class="r-ico"><span>${KIND_GLYPH[r.kind] || '◆'}</span></span>
      <span><div class="r-title">${esc(r.title)}</div><div class="r-sub">${esc(r.subtitle || '')}</div></span>
      <span class="r-dist">${from ? G.fmtDist(G.haversine(from, r.lnglat)) : ''}</span>
    </li>`).join('');
  resultsEl.hidden = false;
}
resultsEl.addEventListener('click', (e) => {
  const li = e.target.closest('li[data-i]');
  if (li) pickResult(results[+li.dataset.i]);
});

function pickResult(r) {
  sfx.confirm();
  qEl.value = r.title;
  closeResults();
  qEl.blur();
  setDestination(r);
}
function closeResults() { resultsEl.hidden = true; }

function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

// ═══ long-press / right-click → waypoint ═══════════════════════════
let ctxLngLat = null;
function showCtx(lngLat, point) {
  ctxLngLat = [lngLat.lng, lngLat.lat];
  const el = $('#ctxmenu');
  $('#ctx-coords').textContent = `${lngLat.lat.toFixed(5)}, ${lngLat.lng.toFixed(5)}`;
  $('#ctx-start').hidden = S.gps === 'locked' || !!S.sim || !!S.nav;
  el.style.left = `${point.x}px`;
  el.style.top = `${point.y}px`;
  el.hidden = false;
  sfx.tick();
}
function hideCtx() { $('#ctxmenu').hidden = true; }

function setManualOrigin(lnglat) {
  ingest({ lnglat, accuracy: null, speed: 0, heading: null, t: Date.now(), manual: true });
  setGps('manual');
}
// Right-click (released without dragging, so right-drag still rotates).
const canvasBox = map.getCanvasContainer();
let rightDown = null;
canvasBox.addEventListener('contextmenu', (e) => e.preventDefault());
canvasBox.addEventListener('mousedown', (e) => { if (e.button === 2) rightDown = [e.clientX, e.clientY]; });
addEventListener('mouseup', (e) => {
  if (e.button !== 2 || !rightDown) return;
  const moved = Math.hypot(e.clientX - rightDown[0], e.clientY - rightDown[1]);
  rightDown = null;
  if (moved > 6) return;
  const r = canvasBox.getBoundingClientRect();
  const point = { x: e.clientX - r.left, y: e.clientY - r.top };
  showCtx(map.unproject([point.x, point.y]), point);
});

let pressTimer = null;
map.on('touchstart', (e) => {
  if (e.originalEvent.touches.length !== 1) return;
  clearTimeout(pressTimer);
  pressTimer = setTimeout(() => showCtx(e.lngLat, e.point), 550);
});
['touchend', 'touchcancel', 'touchmove', 'dragstart', 'zoomstart'].forEach((ev) => map.on(ev, () => clearTimeout(pressTimer)));

$('#ctx-start').onclick = () => {
  hideCtx();
  sfx.confirm();
  setManualOrigin(ctxLngLat);
  toast('ORIGIN SET // MANUAL POSITION', 'info');
  if (S.dest) computeRoute({ fit: true });
};

$('#ctx-go').onclick = async () => {
  hideCtx();
  sfx.confirm();
  const lnglat = ctxLngLat;
  const place = { lnglat, title: 'Custom waypoint', subtitle: `${lnglat[1].toFixed(5)}, ${lnglat[0].toFixed(5)}` };
  setDestination(place);
  try {
    const r = await reverse(lnglat);
    if (r && S.dest?.lnglat === lnglat) {
      S.dest.title = r.title;
      S.dest.subtitle = r.subtitle;
      renderDest();
    }
  } catch { /* keep coordinates */ }
};

// ═══ destination + routing ═════════════════════════════════════════
function setDestination(place) {
  if (S.nav) stopNav(false);
  S.dest = { ...place };
  destMarker.setLngLat(place.lnglat).addTo(map);
  renderDest();
  $('#sheet').hidden = false;
  $('#objective').hidden = false;
  computeRoute({ fit: true });
}

function renderDest() {
  $('#dest-title').textContent = S.dest.title;
  $('#dest-sub').textContent = S.dest.subtitle || '';
  $('#obj-title').textContent = `Reach ${S.dest.title}`;
  destEl.querySelector('.dest-label').textContent = S.dest.title.toUpperCase().slice(0, 28);
}

async function computeRoute({ fit = false, reroute = false } = {}) {
  if (!S.dest) return;
  if (!S.fix) {
    // No GPS yet: plan from the map center so search + simulation still work.
    const c = map.getCenter();
    if (map.getZoom() < 8) {
      // Too far out for the map center to be a sensible start: show the target and ask.
      $('#sheet-tag').textContent = '// AWAITING ORIGIN';
      ['#st-dist', '#st-time'].forEach((id) => { $(id).textContent = '--'; });
      $('#st-eta').textContent = '--:--';
      map.flyTo({ center: S.dest.lnglat, zoom: 14.5, pitch: S.is3d ? 45 : 0, bearing: 0, duration: 3500, essential: true });
      toast(`NO GPS FIX // ${matchMedia('(hover: hover)').matches ? 'RIGHT-CLICK' : 'LONG-PRESS'} MAP → START HERE`, 'err', 6000);
      return;
    }
    toast('NO GPS FIX // ORIGIN = MAP CENTER', 'err', 3500);
    setManualOrigin([c.lng, c.lat]);
  }
  const from = S.fix.lnglat;
  $('#sheet-loading').hidden = reroute;
  try {
    const route = await fetchRoute(from, S.dest.lnglat, S.mode);
    S.route = route;
    map.getSource('route')?.setData({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: route.coords } });
    map.getSource('route-done')?.setData(EMPTY);
    if (S.sim) S.sim.d = 0;
    if (S.nav) { S.nav.hint = 0; S.nav.announced.clear(); S.nav.off = 0; navTick(S.fix); }
    renderStats(route.length, route.duration);
    if (!S.nav) $('#sheet-tag').textContent = '// ROUTE PLOTTED';
    if (fit) {
      setFollow(false);
      const pad = landscapePhone.matches
        ? { top: 40, bottom: 30, left: 370, right: 80 }
        : innerWidth < 720
          ? { top: 160, bottom: 340, left: 40, right: 70 }
          : { top: 120, bottom: 120, left: 460, right: 110 };
      map.fitBounds(G.bounds(route.coords), { padding: pad, pitch: S.is3d ? 40 : 0, bearing: 0, duration: 1800, maxZoom: 17 });
    }
  } catch (err) {
    if (err.name === 'AbortError') return;
    sfx.alert();
    toast(`ROUTE FAILED // ${err.message.toUpperCase()}`, 'err', 4000);
  } finally {
    $('#sheet-loading').hidden = true;
  }
}

function renderStats(dist, dur) {
  $('#st-dist').textContent = G.fmtDist(dist);
  $('#st-time').textContent = G.fmtDur(dur);
  $('#st-eta').textContent = G.fmtClock(new Date(Date.now() + dur * 1000));
  $('#obj-dist').textContent = `${G.fmtDist(dist)} · ${G.fmtDur(dur)}`;
}

document.querySelectorAll('.mode').forEach((b) => {
  b.onclick = () => {
    if (S.mode === b.dataset.mode) return;
    sfx.click();
    S.mode = b.dataset.mode;
    store.set('mode', S.mode);
    syncButtons();
    if (S.sim) S.sim.speed = SIM_SPEED[S.mode];
    computeRoute({ fit: !S.nav });
  };
});

$('#btn-close').onclick = () => { sfx.cancel(); clearRoute(); };
$('#btn-engage').onclick = () => engage();
$('#btn-sim').onclick = () => toggleSim();

function clearRoute() {
  stopSim();
  if (S.nav) stopNav(false);
  S.dest = null;
  S.route = null;
  destMarker.remove();
  map.getSource('route')?.setData(EMPTY);
  map.getSource('route-done')?.setData(EMPTY);
  $('#sheet').hidden = true;
  $('#objective').hidden = true;
  qEl.value = '';
}

// ═══ navigation ════════════════════════════════════════════════════
function engage() {
  if (!S.route) return;
  // quietUntil: let the persona's intro finish before the first turn prompt
  S.nav = { hint: 0, off: 0, lastReroute: 0, announced: new Set(), progress: null, quietUntil: Date.now() + 6000 };
  document.body.classList.add('navigating');
  $('#sheet-tag').textContent = '// NAVIGATING';
  $('#maneuver').hidden = false;
  syncWakeLock();
  sfx.confirm();
  glitch();
  navTick(S.fix);
  say(persona().engage({
    dist: G.fmtDistSpoken(S.route.length), time: G.fmtDurSpoken(S.route.duration),
    dest: S.dest.title, first: S.route.steps[0]?.text ?? '',
  }));
  setFollow(true);
}

function stopNav(announce = true) {
  S.nav = null;
  document.body.classList.remove('navigating');
  $('#sheet-tag').textContent = '// ROUTE PLOTTED';
  $('#maneuver').hidden = true;
  syncWakeLock();
  if (announce) say(persona().end());
  map.easeTo({ padding: navPadding(), pitch: S.is3d ? 50 : 0, duration: 800 });
}

function navTick(fix) {
  const r = S.route;
  if (!r || !fix) return;
  const pr = G.projectNear(fix.lnglat, r.coords, r.cum, S.nav.hint);
  S.nav.hint = pr.index;
  S.nav.progress = pr;

  // off-route detection → reroute
  const tolerance = Math.max(30, Math.min(90, (fix.accuracy || 15) * 1.5));
  if (pr.distance > tolerance && !fix.manual) {
    S.nav.off++;
    if (S.nav.off >= 3 && Date.now() - S.nav.lastReroute > 8000) {
      S.nav.lastReroute = Date.now();
      S.nav.off = 0;
      glitch();
      sfx.alert();
      toast('ROUTE DEVIATION // RECALCULATING');
      say(persona().reroute());
      computeRoute({ reroute: true });
      return;
    }
  } else {
    S.nav.off = 0;
  }

  const remaining = Math.max(0, r.length - pr.along);
  if (remaining < ARRIVE_RADIUS[S.mode] || G.haversine(fix.lnglat, S.dest.lnglat) < ARRIVE_RADIUS[S.mode]) {
    arrive();
    return;
  }

  const idx = r.steps.findIndex((s, i) => i > 0 && s.along > pr.along + 2);
  const next = r.steps[idx] ?? r.steps[r.steps.length - 1];
  const after = r.steps[idx + 1];
  const dNext = Math.max(0, next.along - pr.along);

  $('#mv-icon').innerHTML = maneuverIcon(next);
  $('#mv-dist').textContent = G.fmtDist(dNext);
  $('#mv-text').textContent = next.text;
  $('#maneuver').classList.toggle('imminent', dNext < PROMPTS[S.mode][2] * 1.5);
  const showThen = after && after.along - next.along < 150;
  $('#mv-then').hidden = !showThen;
  if (showThen) $('#mv-then-icon').innerHTML = maneuverIcon(after);

  renderStats(remaining, r.duration * (remaining / r.length));
  announce(idx, next, dNext, showThen ? after : null);
}

function announce(idx, step, d, then) {
  const [early, prep, now] = PROMPTS[S.mode];
  const level = d <= now ? 2 : d <= prep ? 1 : d <= early ? 0 : -1;
  if (level < 0 || (level < 2 && Date.now() < S.nav.quietUntil)) return;
  const key = `${idx}:${level}`;
  if (S.nav.announced.has(key)) return;
  for (let l = 0; l <= level; l++) S.nav.announced.add(`${idx}:${l}`);
  const P = persona();
  const dist = G.fmtDistSpoken(d);
  let text = level === 2 ? P.now(step.text) : level === 1 ? P.prepare(dist, lowerFirst(step.text)) : P.early(dist, lowerFirst(step.text));
  if (level === 2 && then) text += ` Then ${lowerFirst(then.text)}.`;
  sfx.tick();
  say(text);
}
const lowerFirst = (s) => s.charAt(0).toLowerCase() + s.slice(1);

// Split the route into "done" and "ahead" at the (animated) player position.
function drawProgress(pos) {
  const r = S.route;
  if (!r) return;
  const pr = G.projectNear(pos, r.coords, r.cum, S.nav.hint);
  const ahead = [pr.point, ...r.coords.slice(pr.index + 1)];
  const done = [...r.coords.slice(0, pr.index + 1), pr.point];
  map.getSource('route')?.setData({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: ahead.length > 1 ? ahead : [pr.point, pr.point] } });
  map.getSource('route-done')?.setData({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: done.length > 1 ? done : [pr.point, pr.point] } });
}

function arrive() {
  const title = S.dest?.title ?? '';
  S.nav = null;
  stopSim();
  sfx.arrive();
  say(persona().arrive({ dest: title || 'your destination' }));
  const el = $('#arrival');
  $('#arrival-sub').textContent = title.toUpperCase();
  el.hidden = false;
  el.style.animation = 'none';
  void el.offsetWidth;
  el.style.animation = '';
  setTimeout(() => { el.hidden = true; }, 3700);
  clearRoute();
  document.body.classList.remove('navigating');
  $('#maneuver').hidden = true;
  syncWakeLock();
  map.easeTo({ padding: navPadding(), duration: 800 });
}

// ═══ simulation (drives the route with a synthetic GPS feed) ═══════
function toggleSim() {
  if (S.sim) { stopSim(); sfx.cancel(); return; }
  if (!S.route) { toast('PLOT A ROUTE FIRST', 'err'); return; }
  if (!S.nav) engage();
  sfx.confirm();
  S.sim = { d: S.nav.progress?.along ?? 0, speed: SIM_SPEED[S.mode], timer: null };
  S.sim.timer = setInterval(simStep, 1000);
  setGps('sim');
  $('#btn-sim').classList.add('active');
  $('#btn-sim').textContent = 'STOP SIM';
  $('#sim-badge').hidden = false;
  simStep();
}

function simStep() {
  const r = S.route;
  if (!r || !S.sim) return;
  S.sim.d = Math.min(r.length, S.sim.d + S.sim.speed * (0.85 + Math.random() * 0.3));
  const p = G.pointAlong(r.coords, r.cum, S.sim.d);
  const ahead = G.pointAlong(r.coords, r.cum, S.sim.d + 10);
  const heading = G.haversine(p, ahead) > 0.5 ? G.bearing(p, ahead) : S.fix?.course;
  ingest({ lnglat: p, accuracy: 4, speed: S.sim.speed, heading, altitude: null, t: Date.now() });
}

function stopSim() {
  if (!S.sim) return;
  clearInterval(S.sim.timer);
  S.sim = null;
  $('#btn-sim').classList.remove('active');
  $('#btn-sim').textContent = 'SIM';
  $('#sim-badge').hidden = true;
  if (S.realFix) { ingest({ ...S.realFix, t: Date.now() }); setGps('locked'); }
  else setGps(S.fix ? 'manual' : 'acquiring');
}

// ═══ off-screen destination pointer ════════════════════════════════
function updateOffscreen() {
  const el = $('#offscreen');
  if (!S.dest) { el.hidden = true; return; }
  const w = innerWidth, h = innerHeight;
  const p = map.project(S.dest.lnglat);
  const inView = p.x > 30 && p.x < w - 30 && p.y > 30 && p.y < h - 30 && map.getBounds().contains(S.dest.lnglat);
  if (inView) { el.hidden = true; return; }
  const c = map.getCenter();
  const from = S.shown ?? [c.lng, c.lat];
  const angle = G.bearing([c.lng, c.lat], S.dest.lnglat) - map.getBearing();
  const rad = angle * G.D2R;
  const dx = Math.sin(rad), dy = -Math.cos(rad);
  const top = innerWidth < 720 ? 200 : 120, bottom = 150, side = innerWidth < 720 ? 30 : 90;
  const cx = w / 2, cy = (top + h - bottom) / 2;
  const hw = w / 2 - side, hh = (h - bottom - top) / 2;
  const s = Math.min(dx ? Math.abs(hw / dx) : Infinity, dy ? Math.abs(hh / dy) : Infinity);
  el.hidden = false;
  el.style.transform = `translate(${cx + dx * s}px, ${cy + dy * s}px)`;
  $('#offscreen-arrow').style.transform = `rotate(${angle}deg)`;
  $('#offscreen-dist').textContent = G.fmtDist(G.haversine(from, S.dest.lnglat));
}

// ═══ chrome: clock, toast, glitch, keys ════════════════════════════
function tickClock() {
  const d = new Date();
  $('#clock').textContent = d.toLocaleTimeString([], { hour12: false });
  $('#date').textContent = `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear() + 51}`;
}
setInterval(tickClock, 1000);
tickClock();

let toastTimer = null;
function toast(msg, kind = 'err', ms = 2800) {
  const el = $('#toast');
  el.textContent = msg;
  el.className = `toast show ${kind === 'info' ? 'info' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

function glitch() {
  sfx.glitch();
  document.body.classList.remove('glitching');
  void document.body.offsetWidth;
  document.body.classList.add('glitching');
  setTimeout(() => document.body.classList.remove('glitching'), 500);
}

addEventListener('keydown', (e) => {
  if (e.target === qEl || e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k === '/') { e.preventDefault(); qEl.focus(); qEl.select(); }
  else if (k === 'f') $('#btn-follow').click();
  else if (k === 'h') $('#btn-heading').click();
  else if (k === 't') $('#btn-3d').click();
  else if (k === 'm') $('#btn-audio').click();
  else if (k === 'd') $('#btn-dim').click();
  else if (k === 'v') toggleVoices();
  else if (k === 'n') $('#compass').click();
  else if (k === 's' && S.route) toggleSim();
  else if (k === 'enter' && S.route && !S.nav) engage();
  else if (k === 'escape') { hideCtx(); closeResults(); }
});

addEventListener('resize', () => { if (S.nav && S.follow) map.easeTo({ padding: navPadding(), duration: 300 }); });

// ═══ navigator personas ═══════════════════════════════════════════
const persona = () => personaById(S.persona);
setVoiceProfile(persona().voice);

// All navigator speech goes through here so the holo-call display tracks it.
function say(text) {
  const P = persona();
  text = text.replace(/([.!?]\s+)([a-z])/g, (_, gap, ch) => gap + ch.toUpperCase());
  speak(text, {
    onstart: () => {
      const el = $('#holo');
      el.style.setProperty('--c', P.color);
      $('#holo-glyph').textContent = P.glyph;
      $('#holo-name').textContent = P.name;
      el.hidden = false;
    },
    onend: () => { $('#holo').hidden = true; },
  });
}

function renderVoices() {
  $('#voice-list').innerHTML = PERSONAS.map((p) => {
    const v = voiceFor(p.voice);
    return `<li role="option" data-id="${p.id}" class="${p.id === S.persona ? 'sel' : ''}" style="--c:${p.color}">
      <span class="v-glyph"><span>${p.glyph}</span></span>
      <span class="v-body"><span class="v-name">${p.name}</span><span class="v-role">${esc(p.role)}</span></span>
      <span class="v-voice mono">${v ? esc(v.name.replace(/^(Microsoft|Google)\s+/, '').split(/[\s(-]/)[0]) : '—'}</span>
    </li>`;
  }).join('');
}

function toggleVoices(open = $('#voices').hidden) {
  $('#voices').hidden = !open;
  $('#btn-voice').classList.toggle('on', open);
  if (open) renderVoices();
  sfx.click();
}

$('#btn-voice').onclick = () => toggleVoices();
$('#voices-close').onclick = () => toggleVoices(false);
$('#voice-list').addEventListener('click', (e) => {
  const li = e.target.closest('li[data-id]');
  if (!li) return;
  S.persona = li.dataset.id;
  store.set('persona', S.persona);
  setVoiceProfile(persona().voice);
  renderVoices();
  sfx.confirm();
  if (!S.audio) toast('AUDIO IS MUTED // TAP THE SPEAKER TO HEAR', 'err');
  say(persona().greet());
});
window.speechSynthesis?.addEventListener?.('voiceschanged', () => { if (!$('#voices').hidden) renderVoices(); });

// ═══ keep the screen on while tracking or navigating ═══════════════
let wakeLock = null;
async function syncWakeLock() {
  const want = !!S.nav || S.follow;
  try {
    if (want && !wakeLock && 'wakeLock' in navigator && document.visibilityState === 'visible') {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } else if (!want && wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
  } catch { /* unsupported or refused (e.g. low battery mode) */ }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  syncWakeLock();
  if (S.nav && S.fix) toast('UPLINK RESTORED', 'info');
});

// Offline app shell: the UI opens instantly; map tiles and routing stay online.
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

syncButtons();
boot();
