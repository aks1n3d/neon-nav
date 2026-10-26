// Search + reverse geocoding via Photon (komoot), free and keyless.
// https://photon.komoot.io — built on OpenStreetMap data.

const BASE = 'https://photon.komoot.io';
let controller = null;

const COORD_RE = /^\s*(-?\d{1,2}(?:\.\d+)?)\s*[, ]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/;

export async function search(query, near) {
  const m = query.match(COORD_RE);
  if (m) {
    const lat = +m[1], lng = +m[2];
    if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
      return [{ lnglat: [lng, lat], title: `${lat.toFixed(5)}, ${lng.toFixed(5)}`, subtitle: 'RAW COORDINATES', kind: 'coord' }];
    }
  }
  controller?.abort();
  controller = new AbortController();
  const params = new URLSearchParams({ q: query, limit: '7' });
  if (near) {
    params.set('lat', near[1].toFixed(4));
    params.set('lon', near[0].toFixed(4));
  }
  const res = await fetch(`${BASE}/api/?${params}`, { signal: controller.signal });
  if (!res.ok) throw new Error(`Search error ${res.status}`);
  const data = await res.json();
  return data.features.map(toPlace);
}

export async function reverse(lnglat) {
  const res = await fetch(`${BASE}/reverse?lat=${lnglat[1]}&lon=${lnglat[0]}`);
  if (!res.ok) return null;
  const data = await res.json();
  const f = data.features?.[0];
  if (!f) return null;
  const p = f.properties;
  return {
    ...toPlace(f),
    lnglat,
    district: p.district || p.locality || p.county || (p.type === 'district' ? p.name : null),
    city: p.city || p.town || p.village || p.state || p.country || null,
  };
}

function toPlace(f) {
  const p = f.properties;
  const street = [p.street, p.housenumber].filter(Boolean).join(' ');
  const title = p.name || street || p.city || p.country || 'Unknown location';
  const parts = [p.name && street ? street : null, p.district || p.locality, p.city || p.town || p.village, p.country];
  const subtitle = [...new Set(parts.filter((x) => x && x !== title))].join(' · ');
  return { lnglat: f.geometry.coordinates, title, subtitle, kind: kindOf(p) };
}

function kindOf(p) {
  const v = p.osm_value, k = p.osm_key;
  if (k === 'place' || p.type === 'city' || p.type === 'country') return 'place';
  if (['restaurant', 'cafe', 'bar', 'pub', 'fast_food'].includes(v)) return 'food';
  if (['station', 'bus_stop', 'aerodrome', 'halt', 'tram_stop'].includes(v) || k === 'railway') return 'transit';
  if (k === 'highway') return 'road';
  if (p.type === 'house' && !p.name) return 'address';
  return 'poi';
}
