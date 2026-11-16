# Address codes

Plus codes ([Open Location Code](https://maps.google.com/pluscodes/), an open standard) give every place on earth a short address, also where there are no street names or house numbers: **JR37+F6 Accra** is a spot of about 14 × 14 m. They work offline, need no service, and Google Maps, OsmAnd and many other apps understand them.

```
codes encode 5.6037, -0.187          # JR37+F6 Accra - and the full code 6CQXJR37+F6
codes encode Home                    # of a saved place
codes decode JR37+F6 Accra           # 5.603688, -0.186938
codes csv clients.csv --out clients-with-codes.csv
```

`codes` is `node tools/address-codes/codes.js` in the MapSCII folder, or `mapscii-codes` once MapSCII is installed.

The short form needs a town nearby (within about 30 km) to be read back. `encode` takes the nearest town among the maps MapSCII has shown; where it knows none, it gives the full code.

`csv` adds the columns `plus_code` and `address` to a CSV file with `latitude`/`longitude` (or `lat`/`lon`) columns - e.g. a list of clients or survey points - or the coordinates to one with a `plus_code` column.

## In MapSCII

* **g** and `--goto` take plus codes: `mapscii --goto "JR37+F6 Accra"`, or a short code alone, which is read near the map's view.
* The footer shows the code of the ✚, with the nearest town.
* The field notes tool takes them too: `notes add "Clinic" --at "JR37+F6 Accra"`.
