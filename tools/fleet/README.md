# Fleet

The positions of many devices on one map: motorbike taxis, delivery riders, field staff, a family's phones. A **fleet server** collects them; MapSCII shows them all (`mapscii --fleet`), each as **▲** with its name; so does a page in any browser.

```
node tools/fleet/fleet.js serve                  # on the computer at the office
mapscii --fleet http://192.168.1.20:2950         # anywhere on the network
node tools/fleet/fleet.js list 192.168.1.20      # the devices as a list
```

(`mapscii-fleet` instead of `node tools/fleet/fleet.js` once MapSCII is installed.)

## Adding devices

The server's page (`http://the-computer:2950/`) shows what to enter:

| Device | How |
|---|---|
| Android phone, GPSLogger | *Log to custom URL*: `http://the-computer:2950/log?id=%SER&lat=%LAT&lon=%LON&time=%TIME&spd=%SPD&acc=%ACC` - or a name instead of `%SER`, e.g. `id=moto-12` |
| Phone, OwnTracks | mode *HTTP*, URL `http://the-computer:2950/`; the device is its user and device name |
| A GPS bridge (USB GPS) | `mapscii-gps --device /dev/ttyACM0 --fleet http://the-computer:2950 --name moto-12` - it passes its position on every 15 s, or when it moved 25 m, so it costs little data |

`--names names.txt` gives devices readable names (`moto-12 = Kofi (moto 12)`, one per line). `--token SECRET` keeps others out: devices then send `token=SECRET`.

## What it keeps

The latest position of each device (in `~/.local/share/mapscii-nodejs/fleet/devices.json`, so a restart forgets nothing) and a GPX track per device and day (`fleet/tracks/2026-11-10/moto-12.gpx`), which `mapscii --gpx` shows again.

In MapSCII, a device not heard of for 10 minutes shows how long ago it was (`Kofi (25 min)`), the footer counts them, and **/** finds a device by its name.

For scripts and other programs: `/devices` (all, as JSON, with the age of each position in seconds) and `/stream` (one JSON line per new position).
