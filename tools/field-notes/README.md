# Field notes

Mark places with notes from the terminal: clients, water points, road damage, survey points. The notes show on the map in MapSCII (as ● with their title), and can be exchanged with others and with other programs.

The notes are kept in one GeoJSON file (`~/.local/share/mapscii-nodejs/notes.geojson` on Linux, or the file of `--file` or the `MAPSCII_NOTES` environment variable). QGIS, geojson.io and most map programs read it as it is.

## In MapSCII

* Press **m** to add a note at the marked place (or the centre of the map), with a title.
* Notes are found with **/**, like places.
* `mapscii --notes other.geojson` shows (and adds to) another notebook.

## On the command line

```
notes add "Water point" --at "5.6037, -0.187" --tag water --text "Pump works, queue in the morning"
notes add "Road damage" --at Home --tag road        # at a saved place
notes add "Clinic" --at "Kumasi"                     # at a place MapSCII has shown
notes list --near "5.6, -0.19" --km 5               # nearest first
notes list --tag water
notes find pump
notes show mw9k78ws5a                                # the start of the id is enough
notes edit mw9k78ws5a --text "Pump broken since Monday" --tag water --tag urgent
notes remove mw9k78ws5a
```

`notes` is `node tools/field-notes/notes.js` in the MapSCII folder, or `mapscii-notes` once MapSCII is installed (with `npm link` or `npm install -g`).

## Sharing

```
notes export --out my-notes.geojson                 # for another notebook, QGIS, geojson.io
notes export --format csv --out notes.csv           # for spreadsheets
notes export --format gpx --out notes.gpx           # for GPS devices and phones
notes import their-notes.geojson                    # merge a colleague's notes
notes import waypoints.gpx                          # the waypoints of a GPX file
```

Every note has its own id, so importing the same notebook again adds nothing, and a note changed by someone else is taken over when their change is newer.
