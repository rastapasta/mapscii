# MapSCII - The Whole World In Your Console. [![Build Status](https://travis-ci.com/rastapasta/mapscii.svg?branch=master)](https://travis-ci.com/rastapasta/mapscii)

A node.js based [Vector Tile](http://wiki.openstreetmap.org/wiki/Vector_tiles) to [Braille](http://www.fileformat.info/info/unicode/block/braille_patterns/utf8test.htm) and [ASCII](https://de.wikipedia.org/wiki/American_Standard_Code_for_Information_Interchange) renderer for [xterm](https://en.wikipedia.org/wiki/Xterm)-compatible terminals.

<a href="https://asciinema.org/a/117813?autoplay=1" target="_blank">![asciicast](https://cloud.githubusercontent.com/assets/1259904/25480718/497a64e2-2b4a-11e7-9cf0-ed52ee0b89c0.png)</a>

The [user manual](docs/user_manual.pdf) explains MapSCII and its tools from the start: how to run it, find your way, use little data, and each tool in turn.

## Try it out!

```sh
$ telnet mapscii.me
```

If you're on Windows, use the open source telnet client [PuTTY](https://www.chiark.greenend.org.uk/~sgtatham/putty/latest.html) to connect.

## Features

* Use your mouse to drag and zoom in and out!
* Discover Point-of-Interests around any given location
* Highly customizable layer styling with [Mapbox Styles](https://www.mapbox.com/mapbox-gl-style-spec/) support
* Connect to any public or private vector tile server
* Or just use the supplied and optimized [OSM2VectorTiles](https://github.com/osm2vectortiles) based one
* Work offline and discover local [VectorTile](https://github.com/mapbox/vector-tile-spec)/[MBTiles](https://github.com/mapbox/mbtiles-spec)
* Compatible with most Linux and OSX terminals
* Highly optimized algorithms for a smooth experience
* 100% pure JavaScript! :sunglasses:

## How to run it locally

With a modern node installation available, just start it with

```
npx mapscii
```

## How to install it locally

### With npm

If you haven't already got Node.js >= version 16, then [go get it](http://nodejs.org/) (map packs and the offline search need 22.5 or later).

```
npm install -g mapscii
```

If you're on OSX, or get an error about file permissions, you may need to do ```sudo npm install -g mapscii```

### With snap

In any of the [supported Linux distros](https://snapcraft.io/docs/core/install):

    sudo snap install mapscii
    
(This snap is maintained by [@nathanhaines](https://github.com/nathanhaines/))

## Running

This is pretty simple too.

```
mapscii
```

## Going to coordinates

Press **g**, type the coordinates and press **Enter**: the map centres on them, zooms in to street level (unless you give a zoom level or are already zoomed in further) and marks the exact spot with a red **✚**. Their exact values are shown at the bottom. **Esc** cancels the input, or removes the marker.

To start right there, use `--goto`:

```
mapscii --goto "42.3601, -71.0942"
```

Coordinates can be written in many ways, latitude first unless N/S/E/W say otherwise:

| Notation | Example |
| --- | --- |
| decimal degrees | `42.3601, -71.0942` or `42.3601 -71.0942` |
| with a zoom level | `42.3601, -71.0942, 16` or `42.3601 -71.0942 z16` |
| hemisphere letters | `42.3601N 71.0942W` or `N42.3601 W71.0942` |
| degrees, minutes, seconds | `42°21'36.4"N 71°05'39.1"W` or `42 21 36 N 71 5 39 W` |
| links | `geo:42.3601,-71.0942`, Google Maps links (`…/@42.3601,-71.0942,15z`), OpenStreetMap links (`…#map=16/42.3601/-71.0942`) |

## Map data sources

MapSCII can draw tiles from these sources, chosen with `--tile_source`:

* `mapscii` (default) - [mapscii.me](https://mapscii.me), [OSM2VectorTiles](https://github.com/osm2vectortiles) data from 2016. Small tiles, quick to download.
* `openfreemap` - [OpenFreeMap](https://openfreemap.org), current [OpenStreetMap](https://www.openstreetmap.org) data in the [OpenMapTiles](https://openmaptiles.org/schema/) schema, updated weekly. Many more names and details (shops, bus stops, house numbers with the `bright` style), but about twice the download size.

```
mapscii --tile_source openfreemap
```

Any other vector tile server works too: pass a [TileJSON](https://github.com/mapbox/tilejson-spec) URL, a tile URL with `{z}/{x}/{y}`, a base URL ending in `/`, or a local `.mbtiles` file. The data schema (OSM2VectorTiles or OpenMapTiles) is detected from a TileJSON or an `.mbtiles` file; for other sources set it with `--tile_schema openmaptiles` if needed.

`.mbtiles` files need the optional [`@mapbox/mbtiles`](https://github.com/mapbox/node-mbtiles) package (about 16 MB): `npm install -g @mapbox/mbtiles` if MapSCII was installed with `npm install -g mapscii`, or `npm install --no-save @mapbox/mbtiles` in a MapSCII checkout.

## Offline use and faster loading

Every tile MapSCII downloads is kept in a disk cache, so a place you have visited once loads instantly the next time, even without a network connection. While you look at the map, MapSCII also downloads the tiles around the view, and one zoom level in and out, in the background.

To make an area available right away, download it in one go: give the centre and a radius in kilometres.

```
mapscii --lat 3.848 --lon 11.502 --download 5
```

The centre can also be given with `--goto`, in any of the notations above, e.g. `mapscii --goto "3°50'53\"N 11°30'7\"E" --download 5`.

Add `--tile_source openfreemap` to download from OpenFreeMap instead. This saves every tile within 5 km of the centre, from the whole-world view down to street level (zoom 14), then exits. Use `--download_max_zoom` to stop at a lower zoom level, e.g. `--download 200 --download_max_zoom 10` for a whole region without street detail. Afterwards, start MapSCII at that place as usual:

```
mapscii --lat 3.848 --lon 11.502 --zoom 14
```

The cache lives in `~/.cache/mapscii-nodejs` on Linux, `~/Library/Caches/mapscii-nodejs` on macOS and `%LOCALAPPDATA%\mapscii-nodejs\Cache` on Windows. Each tile source gets its own folder in it. It is safe to delete at any time.

On a slow or metered connection, `--no-prefetch` saves data: MapSCII then downloads only the tiles you look at, not also those around them in the background.

### Data used

The footer shows how much data MapSCII has downloaded in this session (`↓ 1.2 MB`), counted on the line as a metered connection charges it. `mapscii --usage` lists the totals by day and month.

### Map packs

A map pack is one `.mbtiles` file with the tiles of an area. One person downloads an area once and copies the file (e.g. on a USB stick) to others, who then use it without any data:

```
mapscii --goto "5.6037, -0.1870" --download 10 --pack accra.mbtiles
mapscii --tile_source accra.mbtiles
```

The download step fetches only the tiles missing from the disk cache. `--pack all.mbtiles` without `--download` packs the whole disk cache of the tile source. Packs need Node.js 22.5 or later; any other program reading MBTiles can use them too.

The [map depot](tools/map-depot/README.md) keeps packs of the areas you need and downloads them when data is cheap: at night, on a given Wi-Fi, within a daily limit.

### Sharing tiles on the local network

`mapscii --serve 8080` shares the tiles of the disk cache (or of a map pack given with `--tile_source`) with the other computers on the same network. It prints the command for them, e.g. `mapscii --tile_source http://192.168.1.102:8080/tilejson.json`. Tiles missing from the cache are downloaded once and then served to everyone from the cache.

## Plus codes

MapSCII reads [plus codes](tools/address-codes/README.md), short addresses for any spot on earth, also where there are no street addresses: `mapscii --goto "JR37+F6 Accra"`, or press **g** and type one. The footer shows the code of the ✚. The `codes` tool converts them, also whole CSV files.

## Answers by SMS

The [SMS gateway](tools/sms-gateway/README.md) answers text messages about places - "Kumasi", "JR37+F6 Accra", "Accra to Kumasi" - through a GSM modem or an Android phone, offline, for people without a smartphone or mobile data. Messages can also add field notes.

## Searching places

Every map MapSCII shows adds its names (towns, stations, sights, streets) to a search index on the disk, so they can be found later without a connection:

* Press **/** in the map and type a name: accents and case don't matter ("lodz" finds Łódź). **Tab** shows the next match, **Enter** goes there.
* `mapscii --find "Kazan"` prints the matches, `mapscii --goto Kazan` starts there.
* `mapscii --index` adds every name in the disk cache (or in a map pack given with `--tile_source`) at once.

## Saved places

Press **s** in the map to save the marked place (or the centre) under a name. Saved places come first in the search, and `mapscii --goto Home` starts there. They are kept in a text file, one place per line, easy to edit and to share:

```
# MapSCII saved places: name = latitude, longitude zoom
Home = 52.52, 13.405 z14
Client Kofi = 5.6037, -0.187 z16
```

`mapscii --places` lists them and says where the file is (`~/.config/mapscii-nodejs/places.txt` on Linux).

## Field notes

Press **m** in the map to mark the place with a note. Notes show on the map as **●** with their title, are found with **/**, and are kept in a GeoJSON file which other map programs read too. The `notes` tool lists, edits, exports (GeoJSON, CSV, GPX) and merges them: see [tools/field-notes](tools/field-notes/README.md).

## GPS tracks

`mapscii --gpx walk.gpx` draws the tracks, routes and waypoints of a GPX file (from a phone, a GPS device or a route planner) over the map, and starts with all of it in view; the footer shows its length. Several files can be given, each gets its own colour.

## Live GPS position

With the GPS bridge (a USB GPS, gpsd, or a phone on the same network), `mapscii --gps` shows where you are (**◉**) with the way you came, and follows you; **f** turns following on and off. New notes and saved places then go where you stand, and the bridge records the track as GPX. See [tools/gps-bridge](tools/gps-bridge/README.md).

## Maps to print or share

`mapscii --export accra.html --goto "Accra" -z 14` writes a page with the map drawn as a sharp picture (not in characters), the field notes and GPX tracks on it, a table of the notes with their plus codes, and the map data's credit. It opens in any browser - also offline, on a phone - and prints on one landscape page (the browser's Print also saves it as PDF). `--export map.svg` writes just the picture, `--export-size 1600x1000` sets its size in pixels, `--title` the page's title.

## Routes

`mapscii --route "Office to Berliner Dom" --by foot` shows the way along the roads, with its length and time in the footer; the [routing tool](tools/routing/README.md) prints the directions. It works offline from the map tiles, so it knows no one-way streets or traffic: an estimate, not a navigation system.

## Live layers

Press **o** in the map to switch live layers on and off, or start with `--layers satellites,quakes,aircraft,weather,traffic,fires,ships` (remembered for next time):

* **satellites**: the space stations and the ~150 brightest satellites (✦), moving live, with the path of the ISS over one orbit. Their orbits (CelesTrak, ~30 KB) are fetched once a day; positions are worked out on the computer, so they keep moving offline.
* **quakes**: earthquakes of the last day, M2.5 and up (USGS), every 10 minutes.
* **aircraft**: aircraft in the view (adsb.lol), from zoom 5, every 30 seconds, as arrows pointing where they fly, with their callsigns.
* **weather**: the weather at the centre of the map, in the footer (Open-Meteo).
* **traffic** (needs a TomTom key): how the roads flow (green, yellow, red, dark red for closed) from zoom 10, and incidents (accidents, jams, closures, roadworks) with their delay from zoom 8, every 3 minutes.
* **fires** (needs a NASA FIRMS key): fires seen from space in the last 24 hours, in the area on the screen, from zoom 3, every 30 minutes.
* **ships** (needs an AISStream key): ships in the area on the screen, live, from zoom 6, as a compressed stream.

The keys are free; `mapscii --keys` shows which are set and where to get the others.

**/** also finds satellites, aircraft and earthquakes. Layers count into the data meter, refresh only while they are on, and keep their last data for offline use, saying how old it is.

## Views: satellite, hybrid, relief and 3D

Press **v** to go through the views (or start with `--view`): **satellite** imagery (Esri World Imagery) under the map's names; **hybrid**, the imagery with the roads, railways, rivers and borders over it; **relief**, the landscape in height colours and hill shading under the map's lines and names; and **3D**, the landscape ahead as from a plane, turned with **,** and **.**, in height colours or, with **i**, in the colours of the satellite imagery. The pictures are drawn with two pixels per character cell, in 24-bit colour where the terminal can; they are kept on the computer like the map tiles. A satellite tile is ~25 KB, an elevation tile ~150 KB; `--picture-detail low` uses a quarter of the data, `high` four times as much for sharper pictures.

## Navigation

With a live GPS position (`--gps`, see the GPS bridge), MapSCII navigates: `mapscii --gps --navigate "Berliner Dom" --by foot`, or mark a place (**g**, **/**) and press **r**. The footer shows the next instruction (`➜ In 120 m: Turn right onto Rosenstraße | 1.1 km, 14 min left`), the map draws the way ahead, a new route is planned when you leave this one, and it tells you when you have arrived. It also says the turns aloud ("In 300 metres, turn right onto Liberia Avenue", then "Now turn right…"), offline, with the computer's speech program (speech-dispatcher or eSpeak on Linux, `say` on a Mac, the Windows voice); **t** switches the voice off and on, `--no-voice` starts without it. By car it keeps to the one-way streets the map data marks; it knows no turn restrictions or traffic. **Esc** stops it.

## API keys

Ships, live traffic and fires need free keys: `mapscii --keys` shows which are set and where to sign up, `mapscii --set-key tomtom=YOUR_KEY` sets one (kept in a file only you can read).

## Fleets

`mapscii --fleet http://hq:2950` shows the devices of a [fleet server](tools/fleet/README.md) - phones and GPS bridges of riders, drivers or field staff - each with its name, and how long ago it was heard of when that is a while.

## Text snapshots

`mapscii --print --goto "48.8584, 2.2945" -z 15 --width 80 --height 24` prints the map once as text, when all its tiles are in, and exits: for reports, chat messages or a server's login screen. `--print plain` leaves out the colours, `--print ansi` keeps them (the default in a terminal). The map data's attribution is printed below the map.

## Keyboard shortcuts

* Arrows **up**, **down**, **left**, **right** to scroll around
* Press **a** or **z** to zoom in and out
* Press **g** to go to coordinates (see below), **Esc** to remove the marker again
* Press **/** to search places, **s** to save the place, **m** to add a field note, **f** to follow the GPS position (see below)
* Long names are shortened with "…": press **n** (next) or **p** (previous) to show the names on the screen in full one after another, **Esc** to shorten it again - or click on a name
* Press **c** to switch to block character mode
* Press **q** to quit

## Mouse control

If your terminal supports mouse events you can drag the map and use your scroll wheel to zoom in and out. A click centres the map there; a click on a shortened name shows it in full.

## Behind the scenes
### Libraries
#### Mastering the console
  * [`x256`](https://github.com/substack/node-x256) for converting RGB values to closest xterm-256 [color code](https://en.wikipedia.org/wiki/File:Xterm_256color_chart.svg)
  * [`term-mouse`](https://github.com/CoderPuppy/term-mouse) for mouse handling
  * [`keypress`](https://github.com/TooTallNate/keypress) for input handling
  * [`string-width`](https://github.com/sindresorhus/string-width) to determine visual string lengths

#### Discovering the map data
* [`vector-tile`](https://github.com/mapbox/vector-tile-js) for [VectorTile](https://github.com/mapbox/vector-tile-spec/tree/master/2.1) parsing
* [`pbf`](https://github.com/mapbox/pbf) for [Protobuf](https://developers.google.com/protocol-buffers/) decoding
* [`mbtiles`](https://github.com/mapbox/node-mbtiles) for [MBTiles](https://github.com/mapbox/mbtiles-spec/blob/master/1.2/spec.md) parsing

#### Juggling the vectors and numbers
* [`earcut`](https://github.com/mapbox/earcut) for polygon triangulation
* [`rbush`](https://github.com/mourner/rbush) for 2D spatial indexing of geo and label data
* [`bresenham`](https://github.com/madbence/node-bresenham) for line point calculations
* [`simplify-js`](https://github.com/mourner/simplify-js) for polyline simplifications

#### Handling the flow
* [`node-fetch`](https://github.com/bitinn/node-fetch) for HTTP requests
* [`env-paths`](https://github.com/sindresorhus/env-paths) to determine where to persist downloaded tiles

### TODOs
* MapSCII
  * [ ] GeoJSON support via [geojson-vt](https://github.com/mapbox/geojson-vt)
  * [ ] CLI support
    * [-] startup parameters
      * [X] TileSource
      * [X] Style
      * [X] center position
      * [X] zoom
      * [ ] demo mode?

  * [ ] mouse control
    * [ ] hover POIs/labels
    * [ ] hover maybe even polygons/-lines?

* Styler
  * [ ] respect zoom based style ranges

* Renderer
  * [ ] download and process tiles in a different thread ([#3](https://github.com/rastapasta/mapscii/issues/3))
  * [ ] optimize renderer for large areas ([#6](https://github.com/rastapasta/mapscii/issues/6))
  * [ ] label drawing
    * [ ] multi line label?

* TileSource
  * [ ] implement single vector-tile handling

## Special thanks

* [lukasmartinelli](https://github.com/lukasmartinelli) & [manuelroth](https://github.com/manuelroth) for all their work on [OSM2VectorTiles](https://github.com/osm2vectortiles) (global vector tiles from [OSM Planet](https://wiki.openstreetmap.org/wiki/Planet.osm))
* [mourner](https://github.com/mourner) for all his work on mindblowing GIS algorithms (like the used [earcut](https://github.com/mapbox/earcut), [rbush](https://github.com/mourner/rbush), [simplify-js](https://github.com/mourner/simplify-js), ..)
* Lister for the 2026 improvements to tile loading, offline caching (`--download`) and label placement

## Licenses

### Map data

#### The Open Data Commons Open Database License (oDbl)

[OpenStreetMap](https://www.openstreetmap.org) is open data, licensed under the [Open Data Commons Open Database License](http://opendatacommons.org/licenses/odbl/) (ODbL) by the [OpenStreetMap Foundation](http://osmfoundation.org/) (OSMF).

You are free to copy, distribute, transmit and adapt our data, as long as you credit OpenStreetMap and its contributors. If you alter or build upon our data, you may distribute the result only under the same licence. The full [legal code](http://opendatacommons.org/licenses/odbl/1.0/) explains your rights and responsibilities.

The cartography in our map tiles, and our documentation, are licenced under the [Creative Commons Attribution-ShareAlike 2.0](http://creativecommons.org/licenses/by-sa/2.0/) licence (CC BY-SA).

### MapSCII
* [License](./LICENSE)
* [Authors](./AUTHORS)
