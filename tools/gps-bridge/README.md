# GPS bridge

Brings a live GPS position into MapSCII and records the track. MapSCII then shows where you are (◉) with the way you came, follows you, and puts new notes (**m**) and saved places (**s**) where you stand.

```
node tools/gps-bridge/bridge.js --device /dev/ttyACM0     # a USB GPS
mapscii --gps                                              # in another terminal
```

(`mapscii-gps` instead of `node tools/gps-bridge/bridge.js` once MapSCII is installed with `npm link` or `npm install -g`.)

## Where the position comes from

| Source | How |
|---|---|
| USB GPS | `--device /dev/ttyACM0` (or `/dev/ttyUSB0`); add `--baud 4800` or `--baud 9600` for receivers which need it. If it says "no permission": `sudo usermod -aG dialout $USER`, then log in again. Unplugging and plugging in again is fine. |
| gpsd | `--gpsd` (or `--gpsd host:2947`), if the computer runs the gpsd service already. |
| Phone, GPSLogger (Android) | Start the bridge without a source and open the address it prints on the phone: the page shows the URL to enter under *Log to custom URL*. |
| Phone, OwnTracks | Mode *HTTP*, the URL shown on the same page. |
| Phone app sending NMEA over TCP | e.g. "Share GPS", "GPS2IP": `--tcp phone-address:port`. |
| A recorded file | `--replay drive.nmea` or `--replay walk.gpx`, with `--speed 10` to play it faster and `--loop` to repeat - for trying things out and for demonstrations. |

Phones reach the bridge over the local network. Use `--token SECRET` so that nobody else on the network can send positions; the phone then sends `token=SECRET` along (the page shows where).

## The track

The bridge records a GPX file per day in `~/.local/share/mapscii-nodejs/tracks/` (`--record FOLDER` for another place, `--no-record` for none). It records a point when you moved 5 m (`--min-distance`), and skips fixes rougher than 50 m (`--max-accuracy`). The file is valid after every point, so a crash or a flat battery doesn't spoil it. Show a day again with `mapscii --gpx ~/.local/share/mapscii-nodejs/tracks/2026-11-09.gpx`, or download it from the bridge at `/track.gpx`.

## In MapSCII

* `mapscii --gps` connects to the bridge on this computer (`--gps 192.168.1.20:2948` for one on another computer), and connects again when the bridge restarts.
* The map follows the position; panning stops that, **f** starts it again.
* The footer shows the accuracy and speed, or why there is no position.

## For other programs

The bridge serves the position as JSON on port 2948: `/position` (the latest) and `/stream` (one line per position, as they come). That is enough for scripts, dashboards or a fleet view.
