// Turn-by-turn routing via the free FOSSGIS OSRM servers (OpenStreetMap data).
// https://routing.openstreetmap.de — no key; please keep request volume sane.

import { cumulative, project } from './geo.js';

const PROFILES = { car: 'routed-car', bike: 'routed-bike', foot: 'routed-foot' };
let controller = null;

export async function fetchRoute(from, to, mode = 'car') {
  controller?.abort();
  controller = new AbortController();
  const pts = `${from[0].toFixed(6)},${from[1].toFixed(6)};${to[0].toFixed(6)},${to[1].toFixed(6)}`;
  const url = `https://routing.openstreetmap.de/${PROFILES[mode]}/route/v1/driving/${pts}` +
    '?overview=full&geometries=geojson&steps=true&alternatives=false';
  const res = await fetch(url, { signal: controller.signal });
  if (!res.ok) throw new Error(`Routing server error ${res.status}`);
  const data = await res.json();
  if (data.code !== 'Ok' || !data.routes?.length) throw new Error(data.message || 'No route found');

  const r = data.routes[0];
  const coords = r.geometry.coordinates;
  const cum = cumulative(coords);
  const length = cum[cum.length - 1];

  // Anchor every maneuver to a distance along our own geometry so progress
  // tracking uses one consistent measure.
  let hint = 0;
  const steps = r.legs.flatMap((leg) => leg.steps).map((s) => {
    const m = s.maneuver;
    const p = project(m.location, coords, cum, hint);
    hint = p.index;
    return {
      type: m.type,
      modifier: m.modifier || 'straight',
      exit: m.exit,
      bearingAfter: m.bearing_after,
      name: s.name || '',
      ref: s.ref || '',
      location: m.location,
      along: m.type === 'arrive' ? length : p.along,
      text: instruction(m, s),
    };
  });

  return { coords, cum, length, duration: r.duration, distance: r.distance, steps, mode };
}

const DIRS = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'];
const ORD = ['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth'];
const MOD = {
  'slight left': 'slightly left', 'slight right': 'slightly right',
  'sharp left': 'sharp left', 'sharp right': 'sharp right',
  left: 'left', right: 'right', straight: 'straight', uturn: 'around',
};

function instruction(m, s) {
  const way = s.name || s.ref || '';
  const onto = way ? ` onto ${way}` : '';
  const mod = MOD[m.modifier] || 'straight';
  switch (m.type) {
    case 'depart': return `Head ${DIRS[Math.round((m.bearing_after || 0) / 45) % 8]}${way ? ` on ${way}` : ''}`;
    case 'arrive': return 'Arrive at destination';
    case 'roundabout':
    case 'rotary': return m.exit ? `Take the ${ORD[m.exit] || `${m.exit}th`} exit at the roundabout${onto}` : `Enter the roundabout${onto}`;
    case 'roundabout turn': return `At the roundabout, turn ${mod}${onto}`;
    case 'exit roundabout':
    case 'exit rotary': return `Exit the roundabout${onto}`;
    case 'merge': return `Merge ${mod === 'straight' ? '' : mod}${onto}`.replace('  ', ' ');
    case 'on ramp': return `Take the ramp${mod.includes('left') ? ' on the left' : mod.includes('right') ? ' on the right' : ''}${onto}`;
    case 'off ramp': return `Take the exit${mod.includes('left') ? ' on the left' : mod.includes('right') ? ' on the right' : ''}${onto}`;
    case 'fork': return `Keep ${mod.includes('left') ? 'left' : mod.includes('right') ? 'right' : 'straight'} at the fork${onto}`;
    case 'end of road': return `Turn ${mod} at the end of the road${onto}`;
    case 'new name': return `Continue${onto}`;
    case 'continue': return m.modifier === 'uturn' ? 'Make a U-turn' : mod === 'straight' ? `Continue${way ? ` on ${way}` : ' straight'}` : `Keep ${mod}${onto}`;
    default:
      if (m.modifier === 'uturn') return `Make a U-turn${onto}`;
      if (mod === 'straight') return `Go straight${onto}`;
      return `Turn ${mod}${onto}`;
  }
}

// ── maneuver glyphs ─────────────────────────────────────────────
const P_STRAIGHT = 'M12 2 L19.5 10 H14.5 V22 H9.5 V10 H4.5 Z';
const P_TURN = 'M4 22 V13 C4 9.7 6.7 7.5 10 7.5 H14 V2.5 L21.5 10 L14 17.5 V12.5 H10 C9.4 12.5 9 12.9 9 13.5 V22 Z';
const P_UTURN = 'M18 22 V9 A6 6 0 0 0 6 9 V13 H2.5 L8 18.5 L13.5 13 H10 V9 A2 2 0 0 1 14 9 V22 Z';

export function maneuverIcon(step) {
  if (!step) return '';
  const svg = (inner, tf = '') => `<svg viewBox="0 0 24 24" aria-hidden="true"><g transform="${tf}">${inner}</g></svg>`;
  const path = (d) => `<path d="${d}"/>`;
  const { type, modifier } = step;
  if (type === 'arrive') {
    return svg('<path d="M12 2 L22 12 L12 22 L2 12 Z" fill="none" stroke-width="2.2"/><path d="M12 7.5 L16.5 12 L12 16.5 L7.5 12 Z"/>');
  }
  if (type === 'roundabout' || type === 'rotary' || type === 'exit roundabout' || type === 'exit rotary') {
    return svg('<circle cx="12" cy="9" r="5" fill="none" stroke-width="2.6"/><path d="M10.7 14 H13.3 V22 H10.7 Z"/><path d="M15 2.5 L20.5 4.5 L16.5 8.5 Z"/>');
  }
  const left = modifier.includes('left');
  const flip = left ? 'translate(24 0) scale(-1 1)' : '';
  if (modifier === 'uturn') return svg(path(P_UTURN), left ? '' : 'translate(24 0) scale(-1 1)');
  if (modifier === 'straight' || type === 'depart' || type === 'new name') return svg(path(P_STRAIGHT));
  if (modifier.startsWith('slight')) return svg(path(P_STRAIGHT), `rotate(${left ? -40 : 40} 12 12)`);
  if (modifier.startsWith('sharp')) return svg(path(P_TURN), `${flip} rotate(35 12 12)`);
  return svg(path(P_TURN), flip);
}
