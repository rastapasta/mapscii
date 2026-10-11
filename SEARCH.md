# Offline search

Press `/`, type a place name or `latitude,longitude[,zoom]`, then Enter.
Up/Down selects a result, Enter goes there, Backspace returns to editing,
and Escape or Ctrl-C cancels. The query supports Left/Right, Home/End,
Backspace/Delete and Ctrl-U. Navigation and mouse movement pause during
search; arriving map frames preserve the prompt. Names are submitted only
when Enter is pressed. Search makes no network requests.

Coordinates work immediately. For names, install Python 3 and SQLite 3.33+
with FTS5, then build a separate local index. Your planet MBTiles stays as it is.
For example, explicitly download a worldwide city dataset once:

```sh
python3 tools/maps-search-index --download cities500
export MAPSCII_SEARCH_DB="${XDG_DATA_HOME:-$HOME/.local/share}/maps/search.sqlite"
mapscii
```

Or index a GeoNames 19-column UTF-8 dump you already have:

```sh
python3 tools/maps-search-index /path/to/cities500.zip --output /path/to/search.sqlite
mapscii --search_db /path/to/search.sqlite    # or MAPSCII_SEARCH_DB=...
```

The importer streams TSV or ZIP data, stores names and aliases, validates
coordinates, and replaces an index atomically only when `--replace` is given.
A failed rebuild keeps the old index. An existing index otherwise causes an
error. `--download` supports cities500, cities1000, cities5000 and cities15000;
it is the only part of this feature that uses the network.

Results match all query tokens by prefix, with more populous matches first.
Labels include administrative and country codes to distinguish namesakes.
The index covers the supplied GeoNames records: a city dump supplies place
search, **not a street-address geocoder**. A planet tile archive is not a
substitute for that index. Street/address search would need a richer provider
and its own data; it is not silently delegated to a public service.

GeoNames data: https://www.geonames.org/ — licensed under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
[Dump format and available datasets](https://download.geonames.org/export/dump/readme.txt).
Keep this attribution when distributing the index. Provenance, build time,
format version and attribution are also stored in its `metadata` table.

## Embedding

`new Mapscii({searchProvider: async query => [{label, lat, lon}], searchZoom: 14})`
can supply another provider. Coordinates bypass it. Providers time out after
five seconds; canceled or superseded responses are ignored. The built-in
provider launches `sqlite3` without a shell, reads the index in read-only mode,
escapes SQL/FTS literals and caps result count, output bytes and runtime.
`MAPSCII_SQLITE` may set an explicit SQLite executable path.

## Tests

With existing npm dependencies installed, Python 3 and SQLite in PATH:

```sh
node tests/search.js
python3 tests/search_index.py
```

These cover modal input, UTF-8 editing, narrow footers, stale results,
timeouts, coordinates, terminal controls, actual SQLite lookups and importer
replacement/rollback. No added npm dependencies are required.
