# Routing

The way from one place to another along the roads of the map - by car, bike or on foot - with directions, from the map tiles alone: no routing service, no internet once the tiles are on the computer.

```
route "Office" "Berliner Dom" --by foot
route "JR37+F6 Accra" "Kumasi" --gpx trip.gpx
mapscii --route "Office to Berliner Dom" --by foot     # on the map
```

(`route` is `node tools/routing/route.js` in the MapSCII folder, or `mapscii-route` once MapSCII is installed.) The places can be coordinates, plus codes, saved places or names of places in the maps seen.

```
Office to Berliner Dom: 1.2 km, about 17 min by foot
  1. Head north-west, for 130 m
  2. Continue onto Dircksenstraße, for 120 m
  ...
  6. Turn right onto Rosenstraße, for 40 m
 10. Arrive
An estimate from the map's roads: one-way streets, turn restrictions and traffic are not known.
```

## What it is - and isn't

The tiles hold the roads' lines and kinds (motorway, main road, street, path), not routing data. So:

* **one-way streets, turn restrictions, closed roads and traffic are not known** - a car route may lead the wrong way down a one-way street;
* junctions are where road lines meet; where the map data has a gap, the way goes round it;
* speeds are typical ones per kind of road (e.g. 25 km/h on a street, 90 on a motorway, 4.5 on foot), not measured.

It is good for "how far is it, roughly how long, which way" - not as a car's navigation system.

## Data

Short trips use street-level tiles, long ones tiles with only the main roads (smaller, and far fewer): a 2 km walk needs ~6 tiles, a 50 km drive ~20. `--offline` uses only the tiles on the computer; map packs (`mapscii --pack`, the map depot) make whole regions routable offline. Very long trips (hundreds of tiles) are refused.

The SMS gateway answers "A to B" with the road distance when the tiles are on the computer (it never downloads for an SMS).
