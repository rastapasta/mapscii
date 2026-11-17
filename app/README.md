# Dotpath: the phone app

MapSCII's maps on a phone: the terminal look or a sharp drawn map, the
satellite, hybrid, relief and 3D views, plus codes, and your GPS position. It
is a web app that installs on Android from Chrome; later the same code becomes
an APK.

Dotpath is MapSCII on a phone. It reuses MapSCII's own code (tile reading, drawing, views, plus codes and
search) and replaces only what needs a computer: files, the disk cache and the
network become the browser's fetch and cache storage.

## Trying it on the computer

    npm run app:serve

then open http://localhost:8765/ in Chrome. Press F12 and the phone icon
(device toolbar) to see it at phone size.

- `http://localhost:8765/?local` uses no internet: the tiles and pictures come
  from MapSCII's disk cache, so it only shows places MapSCII has been.
- A place in the address: `?lat=5.55&lon=-0.2&zoom=14&view=hybrid&look=sharp`.
- `?debug` shows what the app is doing in the bottom line.

## Trying it on the phone

1. Run `npm run app:serve` on the computer, with the phone on the same Wi-Fi.
2. Find the computer's address: `hostname -I` (e.g. 192.168.1.20).
3. On the phone, open `http://192.168.1.20:8765/` in Chrome. With `?local`
   the maps come from the computer, not the phone's data bundle.

The browser allows GPS and "Install app" only on secure (https) pages. On a
home network you can allow them for the computer's address: on the phone open
`chrome://flags/#unsafely-treat-insecure-origin-as-secure`, enter
`http://192.168.1.20:8765`, enable it and restart Chrome. For everyone else the
app needs an https address, e.g. a free static host. Whether and where to
publish it is your decision.

While the server runs, anyone on the same network can open the app (only the
app and the cached map tiles are served).

## What works

| | |
|---|---|
| Moving | drag, pinch, double tap, + and −, the mouse wheel |
| Looks | ▦ Terminal: MapSCII's cells, with Braille as real dots; ◫ Sharp: the paper map of the SVG export |
| Views | Map, Satellite, Hybrid, Relief, 3D (⟲ ⟳ turn, Photo for satellite colours); pictures are drawn finer than the cells, smoothed |
| Position | ◎ asks for the GPS, centres the map and follows you until you drag; a lost signal keeps the last position |
| Search | names as you type (from the maps seen, like / in MapSCII, kept on the phone), coordinates, plus codes, map links |
| Routes | pick a search result or long-press the map for a destination, choose car, bike or foot, press Route |
| Navigation | with ◎ on: the next turn in a banner, the way ahead as a blue line, a new route when you leave it, the screen kept on; the turns spoken with the phone's own voice (🔊 / 🔇) |
| Live layers (☰) | satellites (the ISS and its orbit), earthquakes, the weather; they keep their last data offline. Aircraft come with the APK: their servers don't let browser apps in |
| Notes (☰) | a note at the 📍, your position or the middle; listed, found by search, exported as MapSCII's `notes.geojson` or as GPX, through the phone's share sheet |
| Your track (☰) | records the way you go (a point every 5 m or more) and saves it as GPX |
| Files (☰) | open GPX tracks and waypoints to show them; open a `notes.geojson` (from MapSCII or another phone) to merge its notes |
| Offline | the app itself, and every tile and picture seen, stay on the phone |
| Remembered | the place, zoom, view and look |

## Data

The maps come from OpenFreeMap (newer and fuller than mapscii.me, which can't
be used from a browser). Nothing is downloaded ahead: only what is on the
screen. A screen of map is roughly 50-300 KB the first time; satellite pictures
are ~25 KB a tile, elevation tiles ~150 KB (estimates from the terminal
version's measurements).

## Not yet

Names of places not seen yet (MapSCII only knows the maps it has shown),
aircraft (needs the APK), a picture-detail setting, and the APK. Routes download the map tiles
along the way (zoom 14 for short trips, coarser for long ones), so a first long
route costs data.

## Building

    npm run app:build        # app/dist/app.js and app/dist/LICENSES.txt

`scripts/build-app.js` bundles the code with no extra tools. `scripts/app-check.js`
tries the app in a headless Chrome at phone size (taps, drags, a simulated GPS
position) and saves screenshots.

## Tests

    npm test                                   # includes the app's parts (app/src/app.spec.js)
    node scripts/serve-app.js &
    node scripts/app-check.js /tmp/shots "?local&lat=5.5502&lon=-0.205&zoom=14&debug" app/tests/suite.js

`app/tests/offline.js` loads the app, cuts the network and opens it again: it
starts from the phone, with the map seen before.

The suite (`app/tests/suite.js`) uses the app as a person would on a phone,
offline, around central Accra: every view and look, gestures, search, routes,
navigation to arrival, notes, files (also broken ones and a 20,000-point
track), the track, what is remembered after closing, four screen sizes, the
live layers without a connection, the poles and the date line, and 400 random
actions. It needs Chrome, and the tiles MapSCII has on disk for Accra.

## Credits

Built on MapSCII by Michael Straßburger and the MapSCII authors (MIT licence).
`dist/LICENSES.txt` holds MapSCII's licence and those of all bundled libraries;
it must travel with the app. Map data © OpenStreetMap contributors, tiles by
OpenMapTiles and OpenFreeMap; imagery by Esri, Maxar, Earthstar Geographics;
terrain from the Mapzen terrain tiles on AWS.
