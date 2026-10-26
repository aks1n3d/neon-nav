# NEON//NAV

A world map with a Cyberpunk-2077-style look, live GPS tracking and turn-by-turn navigation.
It's a static web app: no build step, no backend, no API keys and **no cost**.

## Run it

```bash
cd neon-nav
python3 -m http.server 8077
# open http://localhost:8077  →  click [ JACK IN ]
```

Any static file server works (`npx serve`, etc.). It has to be served over http(s), because ES modules don't load from `file://`.

### Use it on your phone (GPS)

Browsers only allow GPS on **HTTPS** (or `localhost`). Host it for free on any of these:

- **GitHub Pages**: push this folder to a repo, then go to Settings → Pages → Deploy from branch.
- **Netlify Drop**: drag the folder onto <https://app.netlify.com/drop>.
- **Cloudflare Pages**: connect the repo with no build command.

On the phone, use "Add to Home Screen" to run it fullscreen like an app.

## Features

| | |
|---|---|
| **Cyberpunk map style** | Custom MapLibre style: neon road network that becomes outlined "blueprint" streets when you zoom in, 3D extruded buildings, cyan waterlines, a holographic globe at world zoom |
| **Live GPS tracking** | `watchPosition` with high accuracy, smooth interpolated marker, heading cone, accuracy ring, cyan movement trail, device compass when standing still |
| **Follow camera** | Follow mode, heading-up or north-up, 2D/3D, auto-zoom by speed while navigating |
| **Search** | Places, addresses, POIs, or raw `lat, lng` coordinates, biased toward your location |
| **Waypoints** | Right-click (desktop) or long-press (touch) the map to choose **SET WAYPOINT** or **START HERE** |
| **Turn-by-turn** | Drive / ride / walk routing, maneuver banner with "then" preview, distance, time and arrival clock, voice prompts |
| **Off-route detection** | Reroutes automatically, with a glitch effect, when you leave the route |
| **Simulation** | **SIM** drives the route with a synthetic GPS feed. Useful on desktop or for demos |
| **HUD** | Sector (district) readout, coordinates, clock, GPS signal bars, compass, speedometer, objective tracker, off-screen waypoint pointer |

### Keyboard

`/` search · `F` follow · `H` heading-up · `T` 3D · `M` audio · `N` north · `S` simulate · `Enter` engage · `Esc` close

## Free services used

| What | Service | Notes |
|---|---|---|
| Map tiles | [OpenFreeMap](https://openfreemap.org) | Free, no key, no limits |
| Map engine | [MapLibre GL JS](https://maplibre.org) | Open source |
| Routing | [FOSSGIS OSRM](https://routing.openstreetmap.de) | Free community server, so keep usage reasonable |
| Search / reverse | [Photon](https://photon.komoot.io) | Free fair-use API by komoot |
| Voice | Browser `speechSynthesis` | Built in |

All map data © OpenStreetMap contributors. The app throttles its calls: search is debounced, reverse geocoding runs at most every 15 s, and reroutes at most every 8 s. If you ever outgrow the community servers, OSRM and Photon can both be self-hosted for free.

## Files

```
index.html          HUD markup
css/style.css       interface + effects
js/app.js           GPS, camera, search, navigation, simulation
js/mapstyle.js      the map style (edit COLORS to re-theme)
js/router.js        OSRM routing + instructions + maneuver icons
js/geocode.js       Photon search / reverse geocoding
js/geo.js           geometry + formatting helpers
js/audio.js         synthesized UI sounds + voice
```
