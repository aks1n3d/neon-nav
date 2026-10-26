// Geometry helpers. All coordinates are [lng, lat]; distances in meters.

const R = 6371008.8;
export const D2R = Math.PI / 180;

export function haversine(a, b) {
  const dLat = (b[1] - a[1]) * D2R;
  const dLng = (b[0] - a[0]) * D2R;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * D2R) * Math.cos(b[1] * D2R) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

export function bearing(a, b) {
  const p1 = a[1] * D2R, p2 = b[1] * D2R, dl = (b[0] - a[0]) * D2R;
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return (Math.atan2(y, x) / D2R + 360) % 360;
}

export function cumulative(coords) {
  const out = [0];
  for (let i = 1; i < coords.length; i++) out.push(out[i - 1] + haversine(coords[i - 1], coords[i]));
  return out;
}

// Snap a point onto a polyline between vertex indices [from, to].
export function project(pt, coords, cum, from = 0, to = coords.length - 1) {
  const k = Math.cos(pt[1] * D2R);
  let best = { d: Infinity, index: from, t: 0 };
  for (let i = from; i < to; i++) {
    const a = coords[i], b = coords[i + 1];
    const ax = (a[0] - pt[0]) * k, ay = a[1] - pt[1];
    const dx = (b[0] - a[0]) * k, dy = b[1] - a[1];
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
    const px = ax + t * dx, py = ay + t * dy;
    const d = px * px + py * py;
    if (d < best.d) best = { d, index: i, t };
  }
  const a = coords[best.index], b = coords[best.index + 1] ?? a;
  const point = [a[0] + (b[0] - a[0]) * best.t, a[1] + (b[1] - a[1]) * best.t];
  const c0 = cum[best.index], c1 = cum[best.index + 1] ?? c0;
  return { index: best.index, t: best.t, point, along: c0 + (c1 - c0) * best.t, distance: haversine(pt, point) };
}

// Cheap projection near the last known vertex; falls back to a full scan
// when the point has wandered away from that window.
export function projectNear(pt, coords, cum, hint = 0) {
  const n = coords.length - 1;
  const near = project(pt, coords, cum, Math.max(0, hint - 25), Math.min(n, hint + 300));
  if (near.distance < 60) return near;
  const full = project(pt, coords, cum);
  return full.distance < near.distance ? full : near;
}

export function pointAlong(coords, cum, d) {
  if (d <= 0) return coords[0];
  const last = coords.length - 1;
  if (d >= cum[last]) return coords[last];
  let lo = 0, hi = last;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= d) lo = mid; else hi = mid;
  }
  const seg = cum[hi] - cum[lo] || 1;
  const t = (d - cum[lo]) / seg;
  const a = coords[lo], b = coords[hi];
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

export function circle(center, radius, steps = 64) {
  const ring = [];
  const latR = radius / R / D2R;
  const lngR = latR / Math.cos(center[1] * D2R);
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    ring.push([center[0] + lngR * Math.cos(a), center[1] + latR * Math.sin(a)]);
  }
  return { type: 'Feature', geometry: { type: 'Polygon', coordinates: [ring] }, properties: {} };
}

export function graticule(step = 15) {
  const features = [];
  for (let lng = -180; lng <= 180; lng += step) {
    const line = [];
    for (let lat = -80; lat <= 80; lat += 2) line.push([lng, lat]);
    features.push({ type: 'Feature', properties: { major: lng === 0 }, geometry: { type: 'LineString', coordinates: line } });
  }
  for (let lat = -75; lat <= 75; lat += step) {
    const line = [];
    for (let lng = -180; lng <= 180; lng += 2) line.push([lng, lat]);
    features.push({ type: 'Feature', properties: { major: lat === 0 }, geometry: { type: 'LineString', coordinates: line } });
  }
  return { type: 'FeatureCollection', features };
}

export const lerp = (a, b, t) => a + (b - a) * t;

export function lerpAngle(a, b, t) {
  const d = ((b - a + 540) % 360) - 180;
  return (a + d * t + 360) % 360;
}

export function fmtDist(m) {
  if (m == null || !isFinite(m)) return '--';
  if (m < 100) return `${Math.max(0, Math.round(m / 5) * 5)} M`;
  if (m < 1000) return `${Math.round(m / 10) * 10} M`;
  if (m < 10000) return `${(m / 1000).toFixed(1)} KM`;
  return `${Math.round(m / 1000)} KM`;
}

export function fmtDistSpoken(m) {
  if (m < 1000) return `${Math.max(10, Math.round(m / 50) * 50)} meters`;
  const km = m / 1000;
  return km < 10 ? `${km.toFixed(1)} kilometers` : `${Math.round(km)} kilometers`;
}

export function fmtDur(s) {
  if (s == null || !isFinite(s)) return '--';
  const min = Math.max(1, Math.round(s / 60));
  if (min < 60) return `${min} MIN`;
  const h = Math.floor(min / 60);
  return `${h} H ${String(min % 60).padStart(2, '0')}`;
}

export function fmtClock(date) {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}

export function bounds(coords) {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const [x, y] of coords) {
    if (x < w) w = x; if (x > e) e = x;
    if (y < s) s = y; if (y > n) n = y;
  }
  return [[w, s], [e, n]];
}
