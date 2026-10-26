// NEON//NAV map style — a hand-built MapLibre style over the free OpenFreeMap
// vector tiles (OpenMapTiles schema). No API key, no usage fees.

export const COLORS = {
  bg: '#0a0407',
  land: '#0d0509',
  landuse: '#12060b',
  industrial: '#16070c',
  park: '#07110f',
  parkEdge: '#0f3a33',
  water: '#020c12',
  waterEdge: '#00e5ff',
  red: '#ff003c',
  redSoft: '#ff2a4f',
  roadDim: '#5c1420',
  roadMid: '#a3192f',
  roadHot: '#ff2e44',
  roadFill: '#160609',
  rail: '#02d7f2',
  yellow: '#fcee0a',
  cyan: '#02d7f2',
  text: '#ffe3e6',
};

// First label layer: overlays (route, trail, …) are inserted below it.
export const LABEL_ANCHOR = 'label-waterway';

const SRC = 'omt';
const NAME = ['coalesce', ['get', 'name:en'], ['get', 'name:latin'], ['get', 'name']];
const LOCAL = ['coalesce', ['get', 'name'], ['get', 'name:latin']];
const F_REG = ['Noto Sans Regular'];
const F_BOLD = ['Noto Sans Bold'];
const F_IT = ['Noto Sans Italic'];

const zexp = (...stops) => ['interpolate', ['exponential', 1.6], ['zoom'], ...stops];
// Casing = core width plus an outline that grows with zoom.
const outline = (z) => (z <= 12 ? 0 : z >= 18 ? 2.6 : z >= 15 ? 1.6 + (z - 15) / 3 : (1.6 * (z - 12)) / 3);
const casingOf = (stops) => stops.map((v, i) => (i % 2 ? v + outline(stops[i - 1]) : v));
const zlin = (...stops) => ['interpolate', ['linear'], ['zoom'], ...stops];

// Road classes, drawn as glowing neon lines when zoomed out that turn into
// outlined "blueprint" corridors (bright casing, dark core) when zoomed in.
const ROADS = [
  { id: 'path', classes: ['path', 'track'], casing: '#4a1520', min: 13,
    width: [13, 0.4, 16, 1.2, 19, 3], dash: true },
  { id: 'minor', classes: ['minor', 'service', 'raceway', 'busway'], casing: COLORS.roadDim, min: 11,
    width: [11, 0.3, 14, 1.4, 16, 4, 19, 16] },
  { id: 'secondary', classes: ['secondary', 'tertiary'], casing: '#c21d36', min: 8,
    width: [8, 0.3, 12, 1.2, 14, 3, 16, 7, 19, 22] },
  { id: 'primary', classes: ['primary', 'trunk'], casing: '#ff2741', min: 5,
    width: [5, 0.3, 9, 1, 12, 2, 14, 4.5, 16, 9, 19, 28] },
  { id: 'motorway', classes: ['motorway'], casing: '#ff4a5e', min: 4,
    width: [4, 0.5, 9, 1.4, 12, 2.6, 14, 5.5, 16, 11, 19, 32] },
];

function roadFilter(classes) {
  return ['all', ['==', ['geometry-type'], 'LineString'], ['in', ['get', 'class'], ['literal', classes]]];
}
const TUNNEL_FADE = ['case', ['==', ['get', 'brunnel'], 'tunnel'], 0.35, 1];

function roadLayers() {
  const glow = {
    id: 'road-glow', type: 'line', source: SRC, 'source-layer': 'transportation', minzoom: 4,
    filter: roadFilter(['motorway', 'trunk', 'primary']),
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': COLORS.red,
      'line-width': zexp(4, 2, 10, 5, 14, 14, 18, 50),
      'line-blur': zexp(4, 2, 10, 4, 14, 10, 18, 30),
      'line-opacity': zlin(4, 0.25, 10, 0.35, 15, 0.22),
    },
  };
  const casings = ROADS.map((r) => ({
    id: `road-${r.id}-casing`, type: 'line', source: SRC, 'source-layer': 'transportation', minzoom: r.min,
    filter: roadFilter(r.classes),
    layout: { 'line-cap': r.dash ? 'butt' : 'round', 'line-join': 'round' },
    paint: {
      'line-color': r.casing,
      'line-width': zexp(...(r.dash ? r.width : casingOf(r.width))),
      'line-opacity': TUNNEL_FADE,
      ...(r.dash ? { 'line-dasharray': [2, 2] } : {}),
    },
  }));
  const fills = ROADS.filter((r) => !r.dash).map((r) => ({
    id: `road-${r.id}-fill`, type: 'line', source: SRC, 'source-layer': 'transportation', minzoom: Math.max(r.min, 12.5),
    filter: roadFilter(r.classes),
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': COLORS.roadFill,
      'line-width': zexp(...r.width),
      'line-opacity': zlin(12.5, 0, 14.5, 0.92),
    },
  }));
  return [glow, ...casings, ...fills];
}

export function buildStyle() {
  return {
    version: 8,
    name: 'NEON//NAV',
    projection: { type: 'globe' },
    glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
    sky: {
      'sky-color': '#05020a',
      'horizon-color': '#4a0716',
      'fog-color': '#0e0306',
      'sky-horizon-blend': 0.7,
      'horizon-fog-blend': 0.6,
      'fog-ground-blend': 0.75,
      'atmosphere-blend': 0,
    },
    light: { anchor: 'viewport', color: '#ffffff', intensity: 0.22, position: [1.2, 210, 35] },
    sources: {
      [SRC]: { type: 'vector', url: 'https://tiles.openfreemap.org/planet' },
    },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': COLORS.bg } },

      // ── ground ────────────────────────────────────────────────
      { id: 'landcover', type: 'fill', source: SRC, 'source-layer': 'landcover',
        filter: ['in', ['get', 'class'], ['literal', ['wood', 'grass', 'farmland', 'wetland']]],
        paint: { 'fill-color': '#0b0709', 'fill-opacity': 0.7 } },
      { id: 'landcover-ice', type: 'fill', source: SRC, 'source-layer': 'landcover',
        filter: ['==', ['get', 'class'], 'ice'],
        paint: { 'fill-color': '#101a1e', 'fill-opacity': 0.6 } },
      { id: 'landuse', type: 'fill', source: SRC, 'source-layer': 'landuse', minzoom: 9,
        filter: ['in', ['get', 'class'], ['literal', ['residential', 'suburb', 'neighbourhood', 'quarter']]],
        paint: { 'fill-color': COLORS.landuse, 'fill-opacity': zlin(9, 0, 11, 1) } },
      { id: 'landuse-hot', type: 'fill', source: SRC, 'source-layer': 'landuse', minzoom: 10,
        filter: ['in', ['get', 'class'], ['literal', ['industrial', 'commercial', 'retail', 'railway', 'garages']]],
        paint: { 'fill-color': COLORS.industrial } },
      { id: 'park', type: 'fill', source: SRC, 'source-layer': 'park',
        paint: { 'fill-color': COLORS.park, 'fill-outline-color': COLORS.parkEdge } },
      { id: 'landuse-green', type: 'fill', source: SRC, 'source-layer': 'landuse', minzoom: 11,
        filter: ['in', ['get', 'class'], ['literal', ['cemetery', 'pitch', 'playground', 'stadium']]],
        paint: { 'fill-color': '#0a1413' } },

      // ── water ─────────────────────────────────────────────────
      { id: 'water', type: 'fill', source: SRC, 'source-layer': 'water',
        filter: ['!=', ['get', 'brunnel'], 'tunnel'],
        paint: { 'fill-color': COLORS.water } },
      { id: 'water-glow', type: 'line', source: SRC, 'source-layer': 'water',
        filter: ['!=', ['get', 'brunnel'], 'tunnel'],
        paint: { 'line-color': COLORS.waterEdge, 'line-width': zlin(2, 1, 12, 6), 'line-blur': zlin(2, 1, 12, 5), 'line-opacity': 0.12 } },
      { id: 'water-edge', type: 'line', source: SRC, 'source-layer': 'water',
        filter: ['!=', ['get', 'brunnel'], 'tunnel'],
        paint: { 'line-color': COLORS.waterEdge, 'line-width': zlin(2, 0.4, 14, 1.2), 'line-opacity': zlin(2, 0.35, 12, 0.55) } },
      { id: 'waterway', type: 'line', source: SRC, 'source-layer': 'waterway', minzoom: 8,
        paint: { 'line-color': '#0a5866', 'line-width': zexp(8, 0.5, 14, 2, 18, 6), 'line-opacity': 0.7 } },

      // ── borders ───────────────────────────────────────────────
      { id: 'boundary-state', type: 'line', source: SRC, 'source-layer': 'boundary', minzoom: 3,
        filter: ['all', ['==', ['get', 'admin_level'], 4], ['!=', ['get', 'maritime'], 1]],
        paint: { 'line-color': '#7a1a2a', 'line-width': zlin(3, 0.4, 10, 1.2), 'line-dasharray': [3, 2], 'line-opacity': 0.6 } },
      { id: 'boundary-country-glow', type: 'line', source: SRC, 'source-layer': 'boundary',
        filter: ['all', ['==', ['get', 'admin_level'], 2], ['!=', ['get', 'maritime'], 1], ['!=', ['get', 'disputed'], 1]],
        paint: { 'line-color': COLORS.red, 'line-width': zlin(0, 3, 10, 8), 'line-blur': zlin(0, 3, 10, 6), 'line-opacity': 0.25 } },
      { id: 'boundary-country', type: 'line', source: SRC, 'source-layer': 'boundary',
        filter: ['all', ['==', ['get', 'admin_level'], 2], ['!=', ['get', 'maritime'], 1]],
        paint: { 'line-color': COLORS.redSoft, 'line-width': zlin(0, 0.6, 10, 1.6), 'line-opacity': 0.85 } },

      // ── airports ──────────────────────────────────────────────
      { id: 'aeroway', type: 'line', source: SRC, 'source-layer': 'aeroway', minzoom: 10,
        filter: ['in', ['get', 'class'], ['literal', ['runway', 'taxiway']]],
        paint: { 'line-color': '#3a1520', 'line-width': zexp(10, 1, 14, 8, 18, 60) } },

      // ── roads & rail ──────────────────────────────────────────
      ...roadLayers(),
      { id: 'rail', type: 'line', source: SRC, 'source-layer': 'transportation', minzoom: 10,
        filter: ['in', ['get', 'class'], ['literal', ['rail', 'transit']]],
        paint: { 'line-color': COLORS.rail, 'line-width': zlin(10, 0.5, 16, 1.6), 'line-dasharray': [4, 3], 'line-opacity': ['*', 0.45, TUNNEL_FADE] } },
      { id: 'ferry', type: 'line', source: SRC, 'source-layer': 'transportation', minzoom: 7,
        filter: ['==', ['get', 'class'], 'ferry'],
        paint: { 'line-color': COLORS.cyan, 'line-width': 1, 'line-dasharray': [1, 3], 'line-opacity': 0.35 } },

      // ── buildings ─────────────────────────────────────────────
      { id: 'building-flat', type: 'fill', source: SRC, 'source-layer': 'building', minzoom: 13, maxzoom: 15,
        paint: { 'fill-color': '#1c080e', 'fill-outline-color': '#5a1424', 'fill-opacity': zlin(13, 0, 14, 1) } },
      { id: 'building-3d', type: 'fill-extrusion', source: SRC, 'source-layer': 'building', minzoom: 14,
        paint: {
          'fill-extrusion-color': ['interpolate', ['linear'], ['coalesce', ['get', 'render_height'], 8],
            0, '#14050a', 20, '#1e070e', 60, '#2c0a15', 150, '#46102a', 300, '#6a1440'],
          'fill-extrusion-height': zlin(14, 0, 15, ['coalesce', ['get', 'render_height'], 8]),
          'fill-extrusion-base': zlin(14, 0, 15, ['coalesce', ['get', 'render_min_height'], 0]),
          'fill-extrusion-opacity': 0.82,
          'fill-extrusion-vertical-gradient': true,
        } },
      { id: 'building-edge', type: 'line', source: SRC, 'source-layer': 'building', minzoom: 15,
        paint: { 'line-color': COLORS.redSoft, 'line-width': 0.6, 'line-opacity': zlin(15, 0, 16, 0.22) } },

      // ── labels ────────────────────────────────────────────────
      { id: LABEL_ANCHOR, type: 'symbol', source: SRC, 'source-layer': 'waterway', minzoom: 13,
        layout: { 'symbol-placement': 'line', 'text-field': LOCAL, 'text-font': F_IT, 'text-size': 11, 'text-letter-spacing': 0.15 },
        paint: { 'text-color': '#3fb8c8', 'text-halo-color': COLORS.bg, 'text-halo-width': 1.5 } },
      ...['point', 'line'].map((placement) => ({
        id: `label-water-${placement}`, type: 'symbol', source: SRC, 'source-layer': 'water_name',
        filter: ['==', ['geometry-type'], placement === 'line' ? 'LineString' : 'Point'],
        layout: {
          'text-field': ['upcase', NAME], 'text-font': F_IT, 'text-letter-spacing': 0.35, 'text-max-width': 6,
          'text-size': ['match', ['get', 'class'], 'ocean', 15, 'sea', 12, 11], 'symbol-placement': placement,
        },
        paint: { 'text-color': '#40d9ea', 'text-halo-color': COLORS.bg, 'text-halo-width': 1.2, 'text-opacity': 0.8 },
      })),
      { id: 'label-road', type: 'symbol', source: SRC, 'source-layer': 'transportation_name', minzoom: 13,
        filter: ['!=', ['get', 'class'], 'path'],
        layout: {
          'symbol-placement': 'line', 'text-field': ['upcase', LOCAL], 'text-font': F_BOLD,
          'text-size': zlin(13, 9, 18, 13), 'text-letter-spacing': 0.18, 'text-pitch-alignment': 'viewport',
        },
        paint: { 'text-color': '#ff8a96', 'text-halo-color': '#120408', 'text-halo-width': 2 } },
      { id: 'label-road-shield', type: 'symbol', source: SRC, 'source-layer': 'transportation_name', minzoom: 8, maxzoom: 13,
        filter: ['all', ['has', 'ref'], ['in', ['get', 'class'], ['literal', ['motorway', 'trunk']]]],
        layout: { 'symbol-placement': 'line', 'symbol-spacing': 400, 'text-field': ['get', 'ref'], 'text-font': F_BOLD, 'text-size': 10, 'text-rotation-alignment': 'viewport' },
        paint: { 'text-color': COLORS.yellow, 'text-halo-color': COLORS.bg, 'text-halo-width': 2 } },
      { id: 'label-poi', type: 'symbol', source: SRC, 'source-layer': 'poi', minzoom: 16,
        filter: ['all', ['<=', ['get', 'rank'], 8], ['!', ['in', ['get', 'class'], ['literal', ['bus', 'railway', 'entrance']]]]],
        layout: { 'text-field': ['upcase', LOCAL], 'text-font': F_REG, 'text-size': 10, 'text-letter-spacing': 0.12, 'text-max-width': 8 },
        paint: { 'text-color': '#b07c86', 'text-halo-color': COLORS.bg, 'text-halo-width': 1.5 } },
      { id: 'label-airport', type: 'symbol', source: SRC, 'source-layer': 'aerodrome_label', minzoom: 9,
        layout: { 'text-field': ['concat', '✈ ', ['coalesce', ['get', 'iata'], NAME]], 'text-font': F_BOLD, 'text-size': 11, 'text-letter-spacing': 0.2 },
        paint: { 'text-color': COLORS.cyan, 'text-halo-color': COLORS.bg, 'text-halo-width': 1.5 } },
      { id: 'label-neighbourhood', type: 'symbol', source: SRC, 'source-layer': 'place', minzoom: 12,
        filter: ['in', ['get', 'class'], ['literal', ['neighbourhood', 'quarter', 'suburb', 'hamlet', 'isolated_dwelling']]],
        layout: { 'text-field': ['upcase', NAME], 'text-font': F_BOLD, 'text-size': zlin(12, 10, 16, 14), 'text-letter-spacing': 0.45, 'text-max-width': 7 },
        paint: { 'text-color': '#ff5a6e', 'text-halo-color': '#ff003c', 'text-halo-width': 0.4, 'text-halo-blur': 1, 'text-opacity': 0.9 } },
      { id: 'label-village', type: 'symbol', source: SRC, 'source-layer': 'place', minzoom: 9,
        filter: ['in', ['get', 'class'], ['literal', ['village', 'town']]],
        layout: { 'text-field': ['upcase', NAME], 'text-font': F_BOLD, 'text-size': ['match', ['get', 'class'], 'town', 13, 11], 'text-letter-spacing': 0.25, 'text-max-width': 8 },
        paint: { 'text-color': '#ffc2c9', 'text-halo-color': COLORS.bg, 'text-halo-width': 1.5 } },
      { id: 'label-city', type: 'symbol', source: SRC, 'source-layer': 'place', minzoom: 3, maxzoom: 15,
        filter: ['==', ['get', 'class'], 'city'],
        layout: {
          'text-field': ['upcase', NAME], 'text-font': F_BOLD, 'text-letter-spacing': 0.3, 'text-max-width': 8,
          'text-size': ['interpolate', ['linear'], ['zoom'], 3, ['case', ['<=', ['get', 'rank'], 2], 13, 10], 10, ['case', ['<=', ['get', 'rank'], 2], 24, 18]],
          'symbol-sort-key': ['get', 'rank'],
        },
        paint: { 'text-color': COLORS.text, 'text-halo-color': 'rgba(255,0,60,0.55)', 'text-halo-width': 2.2, 'text-halo-blur': 2.5 } },
      { id: 'label-state', type: 'symbol', source: SRC, 'source-layer': 'place', minzoom: 4, maxzoom: 7,
        filter: ['==', ['get', 'class'], 'state'],
        layout: { 'text-field': ['upcase', NAME], 'text-font': F_REG, 'text-size': 10, 'text-letter-spacing': 0.5, 'text-max-width': 8 },
        paint: { 'text-color': '#a34552', 'text-halo-color': COLORS.bg, 'text-halo-width': 1 } },
      { id: 'label-country', type: 'symbol', source: SRC, 'source-layer': 'place', minzoom: 1, maxzoom: 8,
        filter: ['==', ['get', 'class'], 'country'],
        layout: {
          'text-field': ['upcase', NAME], 'text-font': F_BOLD, 'text-letter-spacing': 0.4, 'text-max-width': 7,
          'text-size': ['interpolate', ['linear'], ['zoom'], 1, 9, 4, ['case', ['<=', ['get', 'rank'], 2], 15, 12], 7, 18],
        },
        paint: { 'text-color': COLORS.yellow, 'text-halo-color': 'rgba(10,4,7,0.9)', 'text-halo-width': 1.6 } },
    ],
  };
}
