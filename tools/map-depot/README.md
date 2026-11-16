# Map depot

Keeps map packs of the areas you need, and downloads them when data is cheap: at night, on a given Wi-Fi, never on a metered connection, within a daily limit. The packs (`.mbtiles` files) can be copied to other computers and used there without any data: `mapscii --tile_source accra.mbtiles`.

```
depot add accra --at "5.6037, -0.187" --km 15         # an area to keep
depot add kumasi --at Kumasi --km 10 --zoom 13       # a place MapSCII has shown, or a saved place
depot add ghana --at "7.9, -1.0" --km 300 --zoom 9   # a whole country, without street detail
depot plan                                           # what is still to download, in MB
depot build accra --budget 50                        # download now, at most 50 MB
depot sync --hours 00:00-06:00 --daily-mb 300 --watch
```

`depot` is `node tools/map-depot/depot.js` in the MapSCII folder, or `mapscii-depot` once MapSCII is installed (`npm link` or `npm install -g`).

## Areas

An area is a centre, a radius (`--km`) and the deepest zoom level (`--zoom`: 14 has every street, 12 the main streets, 9-10 towns and main roads). Each zoom level has four times the tiles of the one before, so a lower `--zoom` makes big areas far smaller: `depot plan` shows the estimate for each. `--source openfreemap` takes the tiles from OpenFreeMap instead of mapscii.me.

The areas are kept in `~/.config/mapscii-nodejs/depot.json`, the packs go to `~/.local/share/mapscii-nodejs/packs/` (`--out` for another folder).

## Downloading when it is cheap

`depot sync` downloads only while all its rules allow it, and stops in the middle of an area when one stops allowing it; the next run goes on from there (nothing is downloaded twice: the tiles are kept in MapSCII's disk cache).

| Rule | Meaning |
|---|---|
| `--hours 00:00-06:00` | only between these times, e.g. those of a night bundle (also across midnight, e.g. `22:00-05:00`) |
| `--wifi "Home,Office"` | only on these Wi-Fi networks |
| `--not-metered` | only when NetworkManager says the connection is not metered |
| `--daily-mb 300` | at most this much a day - counting MapSCII's own use (`mapscii --usage` shows it) |
| `--watch` | keep running and check again every 10 minutes (`--every`) |

NetworkManager only guesses whether a connection is metered. A mobile router or phone hotspot is often guessed wrong; mark it once: `nmcli connection modify "MTN HomeBox_962C94" connection.metered yes`.

To run it every night without a terminal open, start `depot sync --hours 00:00-06:00 --watch` from your session's autostart, or add `depot sync --hours 00:00-06:00` to `crontab -e`, e.g. every 30 minutes at night: `*/30 0-5 * * * /path/to/mapscii/tools/map-depot/depot.js sync --hours 00:00-06:00`.
