## Introduction

This guide documents the process for migrating `dark.json` from osm2vectortiles to OpenMapTiles schema. For convenience, both the original and updated JSON are included in this file, removing the need to reference multiple files at once. The headers correspond to the IDs used in the original JSON file. 

Most info about layers in osm2vectortiles can be found on the [layer reference](https://web.archive.org/web/20160402191922/http://osm2vectortiles.org/docs/layer-reference) page on Wayback Machine. Some extra details are available in the [git repo](https://github.com/osm2vectortiles/osm2vectortiles) too.

Regarding OpenMapTiles, although the essential information can be found on the [schema page](https://openmaptiles.org/schema/), some extra details are present on the [Github](https://github.com/openmaptiles/openmaptiles/tree/master/layers) repo. Some [OpenStreetMap wiki](https://wiki.openstreetmap.org/wiki/Main_Page) pages linked from the [schema](https://openmaptiles.org/schema/) is also quite helpful. 

To get test coordinates for verifying the styles, check if example image on OpenStreetMap wiki contains coordinates or use [overpass-turbo](https://overpass-turbo.eu/) to find the coordinates that satisfies a specific filter.

Finally, if you want to test any of the styles on [maputnik](https://maplibre.org/maputnik/#0.88/0/0), make sure to add `"source": "openmaptiles"`.

## landuse_overlay_national_park

```json
{
  "type": "fill",
  "id": "landuse_overlay_national_park",
  "paint": {
    "fill-color": "@landuse_overlay_national_park"
  },
  "source-layer": "landuse_overlay",
  "filter": [
    "==",
    "class",
    "national_park"
  ]
}
```

In osm2vectortiles, `landuse_overlay` is a layer for landuse polygons that should be drawn above the `water` layer. OpenMapTiles does not have anything like that. However, in the `_generateDrawOrder` function in `Renderer.js`, we can just draw `park` layer after `water`. So, the conversion becomes:

```json
{
  "type": "fill",
  "id": "park_national_park",
  "paint": {
    "fill-color": "@park_national_park"
  },
  "source-layer": "park",
  "filter": [
    "==",
    "class",
    "national_park"
  ]
}
```

## landuse_park

```json
{
  "type": "fill",
  "id": "landuse_park",
  "paint": {
    "fill-color": "@landuse_park"
  },
  "source-layer": "landuse",
  "filter": [
    "==",
    "class",
    "park"
  ]
}
```

Previously, `land-use` and `land-cover` were both part of `landuse` but, OpenMapTiles separated them. Moreover, `park` included these types in osm2vectortiles:

- `park`
- `dog_park`
- `common`
- `garden`
- `golf_course`
- `playground`
- `recreation_ground`
- `nature_reserve`
- `national_park`
- `village_green`
- `zoo`

In OpenMapTiles,

`park` includes `nature_reserve`, `national_park` and `protected_area`. We will leave out `national_park` (as it has been colored already) and `protected_area` because it was not present before.

`dog_park` or `common` is not present in OpenMapTiles.

`landcover` has:
- `garden`
- `golf_course`
- `recreation_ground`
- `village_green`

`landuse` has:
- `playground`
- `zoo`

In the `landuse` [documentation](https://openmaptiles.org/schema/#landuse), it is mentioned 

> Use the class to assign special colors to areas. Original value of either the `landuse`, `amenity`, `leisure`, `tourism`, `place` or `waterway` tag."

As `nature_reserve` is a possible value of the `leisure` tag, you might think using `"source-layer" : "landuse"` and `"filter": ["==", "class", "nature_reserve"]` will work but it doesn't.

So, the converted style is:

```json
{
  "type": "fill",
  "id": "landuse_playground_zoo",
  "paint": {
    "fill-color": "@landuse_playground_zoo"
  },
  "source-layer": "landuse",
  "filter": [
    "in",
    "class",
    "playground",
    "zoo"
  ]
},
{
  "type": "fill",
  "id": "landcover_green_space",
  "paint": {
    "fill-color": "@landcover_green_space"
  },
  "source-layer": "landcover",
  "filter": [
    "in",
    "subclass",
    "garden",
    "golf_course",
    "recreation_ground",
    "village_green"
  ]
},
{
  "type": "fill",
  "id": "park_natural_reserve",
  "paint": {
    "fill-color": "@park_natural_reserve"
  },
  "source-layer": "park",
  "filter": [
    "==",
    "class",
    "natural_reserve"
  ]
}
```

## landuse_cemetery & landuse_hospital

```json
{
  "type": "line",
  "id": "landuse_cemetery",
  "paint": {
    "fill-color": "@landuse_cemetery"
  },
  "source-layer": "landuse",
  "filter": [
    "==",
    "class",
    "cemetery"
  ]
},
{
  "type": "line",
  "id": "landuse_hospital",
  "paint": {
    "line-color": "@landuse_hospital"
  },
  "source-layer": "landuse",
  "filter": [
    "==",
    "class",
    "hospital"
  ]
}
```

These two stay unchanged as both `cemetery` and `hospital` class is present under `landuse` layer in OpenMapTiles.

## landuse_school

```json
{
  "type": "line",
  "id": "landuse_school",
  "paint": {
    "line-color": "@landuse_school"
  },
  "source-layer": "landuse",
  "filter": [
    "==",
    "class",
    "school"
  ]
}
```

In osm2vectortiles, `school` included `school`, `college`, and `university` but in OpenMapTiles, they are separate classes under `landuse` layer. So, the conversion is:

```json
{
  "type": "line",
  "id": "landuse_school_college_university",
  "paint": {
    "line-color": "@landuse_school_college_university"
  },
  "source-layer": "landuse",
  "filter": [
    "in",
    "class",
    "school",
    "college",
    "university"
  ]
}
```

## landuse_wood

```json
{
  "type": "line",
  "id": "landuse_wood",
  "paint": {
    "line-color": "@landuse_wood"
  },
  "source-layer": "landuse",
  "filter": [
    "==",
    "class",
    "wood"
  ]
}
```

In OpenMapTiles, `wood` class fall under `landcover` layer. Conversion:

```json
{
  "type": "line",
  "id": "landcover_wood",
  "paint": {
    "line-color": "@landcover_wood"
  },
  "source-layer": "landcover",
  "filter": [
    "==",
    "class",
    "wood"
  ]
}
```

## waterway

```json
{
  "type": "line",
  "id": "waterway",
  "paint": {
    "line-color": "@waterway"
  },
  "source-layer": "waterway",
  "filter": [
    "all",
    [
      "!=",
      "class",
      "river"
    ],
    [
      "!=",
      "class",
      "stream"
    ],
    [
      "!=",
      "class",
      "canal"
    ]
  ]
}
```

We can make the filter more compact.

```json
{
  "type": "line",
  "id": "waterway",
  "paint": {
    "line-color": "@waterway"
  },
  "source-layer": "waterway",
  "filter": [
    "!in",
    "class",
    "river",
    "stream",
    "canal"
  ]
}
```

## waterway_river, waterway_stream_canal, water, aeroway_fill, aeroway_runway, aeroway_taxiway, building

```json
{
  "type": "line",
  "id": "waterway_river",
  "paint": {
    "line-color": "@waterway_river"
  },
  "source-layer": "waterway",
  "filter": [
    "==",
    "class",
    "river"
  ]
},
{
  "type": "line",
  "id": "waterway_stream_canal",
  "paint": {
    "line-color": "@waterway_stream_canal"
  },
  "source-layer": "waterway",
  "filter": [
    "in",
    "class",
    "stream",
    "canal"
  ]
},
{
  "type": "fill",
  "id": "water",
  "paint": {
    "fill-color": "@water"
  },
  "source-layer": "water"
},
{
  "type": "fill",
  "id": "aeroway_fill",
  "paint": {
    "fill-color": "@aeroway_fill"
  },
  "source-layer": "aeroway",
  "filter": [
    "==",
    "$type",
    "Polygon"
  ],
  "minzoom": 11
},
{
  "type": "line",
  "id": "aeroway_runway",
  "paint": {
    "line-color": "@aeroway_runway"
  },
  "source-layer": "aeroway",
  "filter": [
    "all",
    [
      "==",
      "$type",
      "LineString"
    ],
    [
      "==",
      "type",
      "runway"
    ]
  ],
  "minzoom": 11
},
{
  "type": "line",
  "id": "aeroway_taxiway",
  "paint": {
    "line-color": "@aeroway_taxiway"
  },
  "source-layer": "aeroway",
  "filter": [
    "all",
    [
      "==",
      "$type",
      "LineString"
    ],
    [
      "==",
      "type",
      "taxiway"
    ]
  ],
  "minzoom": 11
},
{
  "type": "line",
  "id": "building",
  "paint": {
    "line-color": "@building"
  },
  "source-layer": "building"
}
```

This whole section stays unchanged as all the classes are still present under the same layer in OpenMapTiles. Note that, in osm2vectortiles, `aeroway` included `runway`, `taxiway`, `apron`, and `helipad` types while OpenMapTiles additionally includes `aerodrome`, `heliport` and `gate`.

## tunnel_path_pedestrian

```json
{
  "type": "line",
  "id": "tunnel_path_pedestrian",
  "paint": {
    "line-color": "@tunnel_path_pedestrian"
  },
  "source-layer": "road",
  "filter": [
    "all",
    [
      "==",
      "$type",
      "LineString"
    ],
    [
      "all",
      [
        "==",
        "structure",
        "tunnel"
      ],
      [
        "in",
        "class",
        "path",
        "pedestrian"
      ]
    ]
  ]
}
```

`road` class in osm2vectortiles corresponds to `transportation` class in OpenMapTiles. `brunnel` field marks whether a way is a bridge, tunnel or ford. In osm2vectortiles,

- `path` includes `path`, `cycleway`, `ski`, `steps`, `bridleway`, `footway`
- `pedestrian` is not a class, it is a type under `street_limited` class.

In OpenMapTiles, `path` [includes](https://github.com/openmaptiles/openmaptiles/blob/master/layers/transportation/transportation.yaml#L43-L44) `pedestrian`, `path`, `footway`, `cycleway`, `steps`, `bridleway` and `corridor`. 

Finally, as filter conditions use AND logic, we can simplify by removing the nested structure.

```json
{
  "type": "line",
  "id": "tunnel_path",
  "paint": {
    "line-color": "@tunnel_path"
  },
  "source-layer": "transportation",
  "filter": [
    "all",
    [
      "==",
      "$type",
      "LineString"
    ],
    [
      "==",
      "brunnel",
      "tunnel"
    ],
    [
      "==",
      "class",
      "path"
    ]
  ]
}
```

## tunnel_motorway_link

```json
{
  "type": "line",
  "id": "tunnel_motorway_link",
  "paint": {
    "line-color": "@tunnel_motorway_link"
  },
  "source-layer": "road",
  "filter": [
    "all",
    [
      "==",
      "structure",
      "tunnel"
    ],
    [
      "==",
      "class",
      "motorway_link"
    ]
  ]
}
```

To find whether a way is a ramp(link or steps), we need to inquire the `ramp` field. Conversion:

```json
{
  "type": "line",
  "id": "tunnel_motorway_ramp",
  "paint": {
    "line-color": "@tunnel_motorway_ramp"
  },
  "source-layer": "transportation",
  "filter": [
    "all",
    [
      "==",
      "brunnel",
      "tunnel"
    ],
    [
      "==",
      "class",
      "motorway"
    ],
    [
      "==",
      "ramp",
      1
    ]
  ]
}
```

## tunnel_service_track

```json
{
  "type": "line",
  "id": "tunnel_service_track",
  "paint": {
    "line-color": "@tunnel_service_track"
  },
  "source-layer": "road",
  "filter": [
    "all",
    [
      "==",
      "structure",
      "tunnel"
    ],
    [
      "in",
      "class",
      "service",
      "track"
    ]
  ]
}
```

For this one, just replace `road` with `transportation` and `structure` with `brunnel`.

```json
{
  "type": "line",
  "id": "tunnel_service_track",
  "paint": {
    "line-color": "@tunnel_service_track"
  },
  "source-layer": "transportation",
  "filter": [
    "all",
    [
      "==",
      "brunnel",
      "tunnel"
    ],
    [
      "in",
      "class",
      "service",
      "track"
    ]
  ]
}
```

## tunnel_link

```json
{
  "type": "line",
  "id": "tunnel_link",
  "paint": {
    "line-color": "@tunnel_link"
  },
  "source-layer": "road",
  "filter": [
    "all",
    [
      "==",
      "structure",
      "tunnel"
    ],
    [
      "==",
      "class",
      "link"
    ]
  ]
}
```

Using the reasoning used for the previous two, we get:

```json
{
  "type": "line",
  "id": "tunnel_ramp",
  "paint": {
    "line-color": "@tunnel_ramp"
  },
  "source-layer": "transportation",
  "filter": [
    "all",
    [
      "==",
      "brunnel",
      "tunnel"
    ],
    [
      "==",
      "ramp",
      1
    ]
  ]
}
```

## tunnel_street

```json
{
  "type": "line",
  "id": "tunnel_street",
  "paint": {
    "line-color": "@tunnel_street"
  },
  "source-layer": "road",
  "filter": [
    "all",
    [
      "==",
      "structure",
      "tunnel"
    ],
    [
      "in",
      "class",
      "street",
      "street_limited"
    ]
  ]
}
```

OpenMapTiles does not have either `street` or `street_limited` property. From osm2vectortiles,

- `street` includes `residential`, `unclassified`, `living_street`, `road`, and `raceway`

- `street_limited` includes `pedestrian`, `construction`, and `private`

In OpenMapTiles, under `transportation` layer:

- `minor` class [includes](https://github.com/openmaptiles/openmaptiles/blob/master/layers/transportation/transportation.yaml#L41-42) `unclassified`, `residential`, `living_street`, and `road`
- `raceway` class already exists
- `pedestrian` is a subclass of `path` which we have already colored in `tunnel_path` and so we will not add it here
- There is no specific `construction` class but all these classes are available
    - `motorway_construction`
    - `trunk_construction`
    - `primary_construction`
    - `secondary_construction`
    - `tertiary_construction`
    - `minor_construction`
    - `path_construction`
    - `service_construction`
    - `track_construction`
    - `raceway_construction`
- `access` field tells whether a road is [private or not](https://wiki.openstreetmap.org/wiki/Key:access)

So, the final conversion is:

```json
{
  "type": "line",
  "id": "tunnel_minor_raceway",
  "paint": {
    "line-color": "@tunnel_minor_raceway"
  },
  "source-layer": "transportation",
  "filter": [
    "all",
    [
      "==",
      "brunnel",
      "tunnel"
    ],
    [
      "in",
      "class",
      "minor",
      "raceway"
    ]
  ]
},
{
  "type": "line",
  "id": "tunnel_construction",
  "paint": {
    "line-color": "@tunnel_construction"
  },
  "source-layer": "transportation",
  "filter": [
    "all",
    [
      "==",
      "brunnel",
      "tunnel"
    ],
    [
      "in",
      "class",
      "motorway_construction",
      "trunk_construction",
      "primary_construction",
      "secondary_construction",
      "tertiary_construction",
      "minor_construction",
      "path_construction",
      "service_construction",
      "track_construction",
      "raceway_construction"
    ]
  ]
},
{
  "type": "line",
  "id": "tunnel_private",
  "paint": {
    "line-color": "@tunnel_private"
  },
  "source-layer": "transportation",
  "filter": [
    "all",
    [
      "==",
      "brunnel",
      "tunnel"
    ],
    [
      "==",
      "access",
      "private"
    ]
  ]
}
```

## tunnel_secondary_tertiary, tunnel_trunk_primary, tunnel_motorway

```json
{
  "type": "line",
  "id": "tunnel_secondary_tertiary",
  "paint": {
    "line-color": "@tunnel_secondary_tertiary"
  },
  "source-layer": "road",
  "filter": [
    "all",
    [
      "==",
      "structure",
      "tunnel"
    ],
    [
      "in",
      "class",
      "secondary",
      "tertiary"
    ]
  ]
},
{
  "type": "line",
  "id": "tunnel_trunk_primary",
  "paint": {
    "line-color": "@tunnel_trunk_primary"
  },
  "source-layer": "road",
  "filter": [
    "all",
    [
      "==",
      "structure",
      "tunnel"
    ],
    [
      "in",
      "class",
      "trunk",
      "primary"
    ]
  ]
},
{
  "type": "line",
  "id": "tunnel_motorway",
  "paint": {
    "line-color": "@tunnel_motorway"
  },
  "source-layer": "road",
  "filter": [
    "all",
    [
      "==",
      "structure",
      "tunnel"
    ],
    [
      "==",
      "class",
      "motorway"
    ]
  ]
}
```

Similar to previous ones, just change source-layer to `transportation` and replace `structure` with `brunnel`.

```json
{
  "type": "line",
  "id": "tunnel_secondary_tertiary",
  "paint": {
    "line-color": "@tunnel_secondary_tertiary"
  },
  "source-layer": "transportation",
  "filter": [
    "all",
    [
      "==",
      "brunnel",
      "tunnel"
    ],
    [
      "in",
      "class",
      "secondary",
      "tertiary"
    ]
  ]
},
{
  "type": "line",
  "id": "tunnel_trunk_primary",
  "paint": {
    "line-color": "@tunnel_trunk_primary"
  },
  "source-layer": "transportation",
  "filter": [
    "all",
    [
      "==",
      "brunnel",
      "tunnel"
    ],
    [
      "in",
      "class",
      "trunk",
      "primary"
    ]
  ]
},
{
  "type": "line",
  "id": "tunnel_motorway",
  "paint": {
    "line-color": "@tunnel_motorway"
  },
  "source-layer": "transportation",
  "filter": [
    "all",
    [
      "==",
      "brunnel",
      "tunnel"
    ],
    [
      "==",
      "class",
      "motorway"
    ]
  ]
}
```

## tunnel_major_rail

```json
{
  "type": "line",
  "id": "tunnel_major_rail",
  "paint": {
    "line-color": "@tunnel_major_rail"
  },
  "source-layer": "road",
  "filter": [
    "all",
    [
      "==",
      "structure",
      "tunnel"
    ],
    [
      "in",
      "class",
      "major_rail",
      "minor_rail"
    ]
  ]
}
```

In osm2vectortiles:

- `major_rail` included `rail`, `monorail`, `narrow_gauge` and `subway`
- `minor_rail` included `funicular`, `light_rail`, `preserved`, `tram`, `disused`, `yard`

In OpenMapTiles, `rail`, `monorail`, `narrow_gauge`, `subway`, `funicular`, `light_rail`, `preserved`, and `tram` are subclasses under `transportation` layer.

`disused` is [available](https://wiki.openstreetmap.org/wiki/Key:railway) under `railway` tag but I couldn't find a way to add it in the json file. I tried the following three approaches but they didn't work. 

I tried with `railway=rail` because it should be more common than disused railways. However, the first approach didn't color any railway and the second approach just colors all transportation classes.

```json
{
  "type": "line",
  "id": "tunnel_major_rail",
  "paint": {
    "line-color": "#ff0000"
  },
  "source-layer": "transportation",
  "filter": [
      "==",
      "railway",
      "rail"
  ]
}
```

```json
{
  "type": "line",
  "id": "tunnel_major_rail",
  "paint": {
    "line-color": "#ff0000"
  },
  "source-layer": "transportation",
  "railway": "rail"
}
```

I also tried the following but when I tested with coordinates that satisfies `"railway"="disused"` tag (found from [overpass-turbo](https://overpass-turbo.eu/)), none of them were colored.

```json
{
  "type": "line",
  "id": "tunnel_major_rail",
  "paint": {
    "line-color": "#ff0000"
  },
  "source-layer": "transportation",
  "filter": [
      "==",
      "subclass",
      "disused"
  ]
}
```

Finally, `yard` can be found by using the `service` tag.
So, the final conversion turns out to be:

```json
{
  "type": "line",
  "id": "tunnel_major_rail",
  "paint": {
    "line-color": "@tunnel_major_rail"
  },
  "source-layer": "transportation",
  "filter": [
    "all",
    [
      "==",
      "brunnel",
      "tunnel"
    ],
    [
      "in",
      "subclass",
      "rail",
      "monorail",
      "narrow_gauge",
      "subway",
      "funicular",
      "light_rail",
      "preserved",
      "tram"
    ]
  ]
},
{
  "type": "line",
  "id": "tunnel_yard",
  "paint": {
    "line-color": "@tunnel_yard"
  },
  "source-layer": "transportation",
  "filter": [
    "all",
    [
      "==",
      "brunnel",
      "tunnel"
    ],
    [
      "==",
      "service",
      "yard"
    ]
  ]
}
```

## tunnel_major_rail_hatching

```json
{
  "type": "line",
  "id": "tunnel_major_rail_hatching",
  "paint": {
    "line-color": "@tunnel_major_rail_hatching"
  },
  "source-layer": "road",
  "filter": [
    "all",
    [
      "==",
      "structure",
      "tunnel"
    ],
    [
      "in",
      "class",
      "major_rail",
      "minor_rail"
    ]
  ]
}
```

This one will be removed as it is identical to `tunnel_major_rail`.

## road_path_pedestrian

```json
{
  "type": "line",
  "id": "road_path_pedestrian",
  "paint": {
    "line-color": "@road_path_pedestrian"
  },
  "source-layer": "road",
  "filter": [
    "all",
    [
      "==",
      "$type",
      "LineString"
    ],
    [
      "all",
      [
        "in",
        "class",
        "path",
        "pedestrian"
      ],
      [
        "!in",
        "structure",
        "bridge",
        "tunnel"
      ]
    ]
  ]
}
```

- Replace `road` with `transportation` in the `source-layer`. Also, update the id and line-color variable name to be consistent with new source-layer name.
- Remove `pedestrian` as it is a subclass of `path`.
- Remove the nested structure.
- In osm2vectortiles, `["!in", "structure", "bridge", "tunnel"]` implies the structure is either `road` or uncategorized. However, OpenMapTiles uses `brunnel` with three possible values: `bridge`, `tunnel`, and `ford`. As the filter's intent is to exclude connection structures, we should add `ford` to the filter too.
- In osm2vectortiles, ferry paths are not included in the `road` layer (as the name suggests, it's for roads), but OpenMapTiles includes them in the `transportation` layer. However, we don't need to worry about it here because the `["in", class, "path"]` filter takes care of it. 

```json
{
  "type": "line",
  "id": "transportation_path",
  "paint": {
    "line-color": "@transportation_path"
  },
  "source-layer": "transportation",
  "filter": [
    "all",
    [
      "==",
      "$type",
      "LineString"
    ],
    [
      "==",
      "class",
      "path"
    ],
    [
      "!in",
      "brunnel",
      "bridge",
      "tunnel",
      "ford"
    ]
  ]
}
```

## road_motorway_link

```json
{
  "type": "line",
  "id": "road_motorway_link",
  "paint": {
    "line-color": "@road_motorway_link"
  },
  "source-layer": "road",
  "minzoom": 12,
  "filter": [
    "all",
    [
      "==",
      "class",
      "motorway_link"
    ],
    [
      "!in",
      "structure",
      "bridge",
      "tunnel"
    ]
  ]
}
```

- Replace `road` with `transportation` and `structure` with `brunnel`.
- Use `ramp` to inquire if it's a link.
- Add `ford` to the `brunnel` condition.

```json
{
  "type": "line",
  "id": "transportation_motorway_ramp",
  "paint": {
    "line-color": "@transportation_motorway_ramp"
  },
  "source-layer": "transportation",
  "minzoom": 12,
  "filter": [
    "all",
    [
      "==",
      "class",
      "motorway"
    ],
    [
      "==",
      "ramp",
      1
    ],
    [
      "!in",
      "brunnel",
      "bridge",
      "tunnel",
      "ford"
    ]
  ]
}
```

## road_service_track

```json
{
  "type": "line",
  "id": "road_service_track",
  "paint": {
    "line-color": "@road_service_track"
  },
  "source-layer": "road",
  "filter": [
    "all",
    [
      "in",
      "class",
      "service",
      "track"
    ],
    [
      "!in",
      "structure",
      "bridge",
      "tunnel"
    ]
  ]
}
```

- Replace `road` with `transportation` and `structure` with `brunnel`.
- Add `ford` to the `brunnel` condition.

```json
{
  "type": "line",
  "id": "transportation_service_track",
  "paint": {
    "line-color": "@transportation_service_track"
  },
  "source-layer": "transportation",
  "filter": [
    "all",
    [
      "in",
      "class",
      "service",
      "track"
    ],
    [
      "!in",
      "brunnel",
      "bridge",
      "tunnel",
      "ford"
    ]
  ]
}
```

## road_link

```json
{
  "type": "line",
  "id": "road_link",
  "paint": {
    "line-color": "@road_link"
  },
  "source-layer": "road",
  "minzoom": 13,
  "filter": [
    "all",
    [
      "==",
      "class",
      "link"
    ],
    [
      "!in",
      "structure",
      "bridge",
      "tunnel"
    ]
  ]
}
```

- Replace `road` with `transportation` and `structure` with `brunnel`.
- Use `ramp` to inquire if it's a link.
- Add `ford` to the `brunnel` condition.

```json
{
  "type": "line",
  "id": "transportation_ramp",
  "paint": {
    "line-color": "@transportation_ramp"
  },
  "source-layer": "transportation",
  "minzoom": 13,
  "filter": [
    "all",
    [
      "==",
      "ramp",
      1
    ],
    [
      "!in",
      "brunnel",
      "bridge",
      "tunnel",
      "ford"
    ]
  ]
}
```

## road_street

```json
{
  "type": "line",
  "id": "road_street",
  "paint": {
    "line-color": "@road_street"
  },
  "source-layer": "road",
  "filter": [
    "all",
    [
      "==",
      "$type",
      "LineString"
    ],
    [
      "all",
      [
        "in",
        "class",
        "street",
        "street_limited"
      ],
      [
        "!in",
        "structure",
        "bridge",
        "tunnel"
      ]
    ]
  ]
}
```

- Replace `road` with `transportation` and `structure` with `brunnel`.
- Remove nesting
- Reuse the explanation in `tunnel_street` to break down `street` and `street_limited` into different classes and fields.
- Add `ford` to the `brunnel` condition.

```json
{
  "type": "line",
  "id": "transportation_minor_raceway",
  "paint": {
    "line-color": "@transportation_minor_raceway"
  },
  "source-layer": "transportation",
  "filter": [
    "all",
    [
      "==",
      "$type",
      "LineString"
    ],
    [
      "in",
      "class",
      "minor",
      "raceway"
    ],
    [
      "!in",
      "brunnel",
      "bridge",
      "tunnel",
      "ford"
    ]
  ]
},
{
  "type": "line",
  "id": "transportation_construction",
  "paint": {
    "line-color": "@transportation_construction"
  },
  "source-layer": "transportation",
  "filter": [
    "all",
    [
      "==",
      "$type",
      "LineString"
    ],
    [
      "in",
      "class",
      "motorway_construction",
      "trunk_construction",
      "primary_construction",
      "secondary_construction",
      "tertiary_construction",
      "minor_construction",
      "path_construction",
      "service_construction",
      "track_construction",
      "raceway_construction"
    ],
    [
      "!in",
      "brunnel",
      "bridge",
      "tunnel",
      "ford"
    ]
  ]
},
{
  "type": "line",
  "id": "transportation_private",
  "paint": {
    "line-color": "@transportation_private"
  },
  "source-layer": "transportation",
  "filter": [
    "all",
    [
      "==",
      "$type",
      "LineString"
    ],
    [
      "==",
      "access",
      "private"
    ],
    [
      "!in",
      "brunnel",
      "bridge",
      "tunnel",
      "ford"
    ]
  ]
}
```

## road_secondary_tertiary, road_trunk_primary, road_motorway

```json
{
  "type": "line",
  "id": "road_secondary_tertiary",
  "paint": {
    "line-color": "@road_secondary_tertiary"
  },
  "source-layer": "road",
  "filter": [
    "all",
    [
      "in",
      "class",
      "secondary",
      "tertiary"
    ],
    [
      "!in",
      "structure",
      "bridge",
      "tunnel"
    ]
  ]
},
{
  "type": "line",
  "id": "road_trunk_primary",
  "paint": {
    "line-color": "@road_trunk_primary"
  },
  "source-layer": "road",
  "filter": [
    "all",
    [
      "in",
      "class",
      "trunk",
      "primary"
    ],
    [
      "!in",
      "structure",
      "bridge",
      "tunnel"
    ]
  ]
},
{
  "type": "line",
  "id": "road_motorway",
  "paint": {
    "line-color": "@road_motorway"
  },
  "source-layer": "road",
  "minzoom": 5,
  "filter": [
    "all",
    [
      "==",
      "class",
      "motorway"
    ],
    [
      "!in",
      "structure",
      "bridge",
      "tunnel"
    ]
  ]
}
```

- Replace `road` with `transportation` and `structure` with `brunnel`.
- Add `ford` to the `brunnel` condition.

```json
{
  "type": "line",
  "id": "transportation_secondary_tertiary",
  "paint": {
    "line-color": "@transportation_secondary_tertiary"
  },
  "source-layer": "transportation",
  "filter": [
    "all",
    [
      "in",
      "class",
      "secondary",
      "tertiary"
    ],
    [
      "!in",
      "brunnel",
      "bridge",
      "tunnel",
      "ford"
    ]
  ]
},
{
  "type": "line",
  "id": "transportation_trunk_primary",
  "paint": {
    "line-color": "@transportation_trunk_primary"
  },
  "source-layer": "transportation",
  "filter": [
    "all",
    [
      "in",
      "class",
      "trunk",
      "primary"
    ],
    [
      "!in",
      "brunnel",
      "bridge",
      "tunnel",
      "ford"
    ]
  ]
},
{
  "type": "line",
  "id": "transportation_motorway",
  "paint": {
    "line-color": "@transportation_motorway"
  },
  "source-layer": "transportation",
  "minzoom": 5,
  "filter": [
    "all",
    [
      "==",
      "class",
      "motorway"
    ],
    [
      "!in",
      "brunnel",
      "bridge",
      "tunnel",
      "ford"
    ]
  ]
}
```

## road_major_rail

```json
{
  "type": "line",
  "id": "road_major_rail",
  "paint": {
    "line-color": "@road_major_rail"
  },
  "source-layer": "road",
  "filter": [
    "all",
    [
      "==",
      "class",
      "major_rail"
    ],
    [
      "!in",
      "structure",
      "bridge",
      "tunnel"
    ]
  ]
}
```

- Replace `road` with `transportation` and `structure` with `brunnel`.
- `major_rail` in osm2vectortiles consisted of `rail`, `monorail`, `narrow_gauge`, and `subway`, all of which are subclasses are `transportation` layer.
- Add `ford` to the `brunnel` condition.

```json
{
  "type": "line",
  "id": "transportation_rail",
  "paint": {
    "line-color": "@transportation_major_rail"
  },
  "source-layer": "transportation",
  "filter": [
    "all",
    [
      "in",
      "subclass",
      "rail",
      "monorail",
      "narrow_gauge",
      "subway"
    ],
    [
      "!in",
      "brunnel",
      "bridge",
      "tunnel",
      "ford"
    ]
  ]
}
```

## road_major_rail_hatching

```json
{
  "type": "line",
  "id": "road_major_rail_hatching",
  "paint": {
    "line-color": "@road_major_rail_hatching"
  },
  "source-layer": "road",
  "filter": [
    "all",
    [
      "==",
      "class",
      "major_rail"
    ],
    [
      "!in",
      "structure",
      "bridge",
      "tunnel"
    ]
  ]
}
```

Remove this one as it is identical to `road_major_rail`.

## bridge_path_pedestrian

```json
{
  "type": "line",
  "id": "bridge_path_pedestrian",
  "paint": {
    "line-color": "@bridge_path_pedestrian"
  },
  "source-layer": "road",
  "filter": [
    "all",
    [
      "==",
      "$type",
      "LineString"
    ],
    [
      "all",
      [
        "==",
        "structure",
        "bridge"
      ],
      [
        "in",
        "class",
        "path",
        "pedestrian"
      ]
    ]
  ]
}
```

- Replace `road` with `transportation` and `structure` with `brunnel`.
- Remove `pedestrian` as it is a subclass of `path`.

```json
{
  "type": "line",
  "id": "bridge_path",
  "paint": {
    "line-color": "@bridge_path"
  },
  "source-layer": "transportation",
  "filter": [
    "all",
    [
      "==",
      "$type",
      "LineString"
    ],
    [
      "==",
      "brunnel",
      "bridge"
    ],
    [
      "==",
      "class",
      "path"
    ]
  ]
}
```

## bridge_motorway_link, bridge_service_track, bridge_link

```json
{
  "type": "line",
  "id": "bridge_motorway_link",
  "paint": {
    "line-color": "@bridge_motorway_link"
  },
  "source-layer": "road",
  "filter": [
    "all",
    [
      "==",
      "structure",
      "bridge"
    ],
    [
      "==",
      "class",
      "motorway_link"
    ]
  ]
},
{
  "type": "line",
  "id": "bridge_service_track",
  "paint": {
    "line-color": "@bridge_service_track"
  },
  "source-layer": "road",
  "filter": [
    "all",
    [
      "==",
      "structure",
      "bridge"
    ],
    [
      "in",
      "class",
      "service",
      "track"
    ]
  ]
},
{
  "type": "line",
  "id": "bridge_link",
  "paint": {
    "line-color": "@bridge_link"
  },
  "source-layer": "road",
  "filter": [
    "all",
    [
      "==",
      "structure",
      "bridge"
    ],
    [
      "==",
      "class",
      "link"
    ]
  ]
}
```

- Replace `road` with `transportation` and `structure` with `brunnel`.
- Use `ramp` to inquire if it's a link.

```json
{
  "type": "line",
  "id": "bridge_motorway_ramp",
  "paint": {
    "line-color": "@bridge_motorway_ramp"
  },
  "source-layer": "transportation",
  "filter": [
    "all",
    [
      "==",
      "brunnel",
      "bridge"
    ],
    [
      "==",
      "class",
      "motorway"
    ],
    [
      "==",
      "ramp",
      1
    ]
  ]
},
{
  "type": "line",
  "id": "bridge_service_track",
  "paint": {
    "line-color": "@bridge_service_track"
  },
  "source-layer": "transportation",
  "filter": [
    "all",
    [
      "==",
      "brunnel",
      "bridge"
    ],
    [
      "in",
      "class",
      "service",
      "track"
    ]
  ]
},
{
  "type": "line",
  "id": "bridge_ramp",
  "paint": {
    "line-color": "@bridge_ramp"
  },
  "source-layer": "transportation",
  "filter": [
    "all",
    [
      "==",
      "brunnel",
      "bridge"
    ],
    [
      "==",
      "ramp",
      1
    ]
  ]
}
```

## bridge_street

```json
{
  "type": "line",
  "id": "bridge_street",
  "paint": {
    "line-color": "@bridge_street"
  },
  "source-layer": "road",
  "filter": [
    "all",
    [
      "==",
      "structure",
      "bridge"
    ],
    [
      "in",
      "class",
      "street",
      "street_limited"
    ]
  ]
}
```

- Replace `road` with `transportation` and `structure` with `brunnel`.
- Reuse the explanation in `tunnel_street` to break down `street` and `street_limited` into different classes and fields.

```json
{
  "type": "line",
  "id": "bridge_minor_raceway",
  "paint": {
    "line-color": "@bridge_minor_raceway"
  },
  "source-layer": "transportation",
  "filter": [
    "all",
    [
      "==",
      "brunnel",
      "bridge"
    ],
    [
      "in",
      "class",
      "minor",
      "raceway"
    ]
  ]
},
{
  "type": "line",
  "id": "bridge_construction",
  "paint": {
    "line-color": "@bridge_construction"
  },
  "source-layer": "transportation",
  "filter": [
    "all",
    [
      "==",
      "brunnel",
      "bridge"
    ],
    [
      "in",
      "class",
      "motorway_construction",
      "trunk_construction",
      "primary_construction",
      "secondary_construction",
      "tertiary_construction",
      "minor_construction",
      "path_construction",
      "service_construction",
      "track_construction",
      "raceway_construction"
    ]
  ]
},
{
  "type": "line",
  "id": "bridge_private",
  "paint": {
    "line-color": "@bridge_private"
  },
  "source-layer": "transportation",
  "filter": [
    "all",
    [
      "==",
      "brunnel",
      "bridge"
    ],
    [
      "==",
      "access",
      "private"
    ]
  ]
}
```

## bridge_secondary_tertiary, bridge_trunk_primary, bridge_motorway

```json
{
  "type": "line",
  "id": "bridge_secondary_tertiary",
  "paint": {
    "line-color": "@bridge_secondary_tertiary"
  },
  "source-layer": "road",
  "filter": [
    "all",
    [
      "==",
      "structure",
      "bridge"
    ],
    [
      "in",
      "class",
      "secondary",
      "tertiary"
    ]
  ]
},
{
  "type": "line",
  "id": "bridge_trunk_primary",
  "paint": {
    "line-color": "@bridge_trunk_primary"
  },
  "source-layer": "road",
  "filter": [
    "all",
    [
      "==",
      "structure",
      "bridge"
    ],
    [
      "in",
      "class",
      "trunk",
      "primary"
    ]
  ]
},
{
  "type": "line",
  "id": "bridge_motorway",
  "paint": {
    "line-color": "@bridge_motorway"
  },
  "source-layer": "road",
  "filter": [
    "all",
    [
      "==",
      "structure",
      "bridge"
    ],
    [
      "==",
      "class",
      "motorway"
    ]
  ]
}
```

- Replace `road` with `transportation` and `structure` with `brunnel`.

```json
{
  "type": "line",
  "id": "bridge_secondary_tertiary",
  "paint": {
    "line-color": "@bridge_secondary_tertiary"
  },
  "source-layer": "transportation",
  "filter": [
    "all",
    [
      "==",
      "brunnel",
      "bridge"
    ],
    [
      "in",
      "class",
      "secondary",
      "tertiary"
    ]
  ]
},
{
  "type": "line",
  "id": "bridge_trunk_primary",
  "paint": {
    "line-color": "@bridge_trunk_primary"
  },
  "source-layer": "transportation",
  "filter": [
    "all",
    [
      "==",
      "brunnel",
      "bridge"
    ],
    [
      "in",
      "class",
      "trunk",
      "primary"
    ]
  ]
},
{
  "type": "line",
  "id": "bridge_motorway",
  "paint": {
    "line-color": "@bridge_motorway"
  },
  "source-layer": "transportation",
  "filter": [
    "all",
    [
      "==",
      "brunnel",
      "bridge"
    ],
    [
      "==",
      "class",
      "motorway"
    ]
  ]
}
```

## bridge_major_rail, bridge_major_rail_hatching

```json
{
  "type": "line",
  "id": "bridge_major_rail",
  "paint": {
    "line-color": "@bridge_major_rail"
  },
  "source-layer": "road",
  "filter": [
    "all",
    [
      "==",
      "structure",
      "bridge"
    ],
    [
      "==",
      "class",
      "major_rail"
    ]
  ]
},
{
  "type": "line",
  "id": "bridge_major_rail_hatching",
  "paint": {
    "line-color": "@bridge_major_rail_hatching"
  },
  "source-layer": "road",
  "filter": [
    "all",
    [
      "==",
      "structure",
      "bridge"
    ],
    [
      "==",
      "class",
      "major_rail"
    ]
  ]
}
```

- Replace `road` with `transportation` and `structure` with `brunnel`.
- `major_rail` in osm2vectortiles consisted of `rail`, `monorail`, `narrow_gauge`, and `subway`, all of which are subclasses are `transportation` layer.
- Remove `bridge_major_rail_hatching` as it is identical to `bridge_major_rail`.

```json
{
  "type": "line",
  "id": "bridge_rail",
  "paint": {
    "line-color": "@bridge_major_rail"
  },
  "source-layer": "transportation",
  "filter": [
    "all",
    [
      "==",
      "brunnel",
      "bridge"
    ],
    [
      "in",
      "subclass",
      "rail",
      "monorail",
      "narrow_gauge",
      "subway"
    ]
  ]
}
```

## admin_level_3, admin_level_2, admin_level_2_disputed

```json
{
  "type": "line",
  "id": "admin_level_3",
  "paint": {
    "line-color": "@admin_level_3"
  },
  "source-layer": "admin",
  "filter": [
    "all",
    [
      ">=",
      "admin_level",
      4
    ],
    [
      "==",
      "maritime",
      0
    ]
  ]
},
{
  "type": "line",
  "id": "admin_level_3",
  "paint": {
    "line-color": "@admin_level_3"
  },
  "source-layer": "admin",
  "filter": [
    "all",
    [
      "==",
      "admin_level",
      3
    ],
    [
      "==",
      "maritime",
      0
    ]
  ]
},
{
  "type": "line",
  "id": "admin_level_2",
  "paint": {
    "line-color": "@admin_level_2"
  },
  "source-layer": "admin",
  "filter": [
    "all",
    [
      "==",
      "admin_level",
      2
    ],
    [
      "==",
      "disputed",
      0
    ],
    [
      "==",
      "maritime",
      0
    ]
  ]
},
{
  "type": "line",
  "id": "admin_level_2_disputed",
  "paint": {
    "line-color": "@admin_level_2_disputed"
  },
  "source-layer": "admin",
  "filter": [
    "all",
    [
      "==",
      "admin_level",
      2
    ],
    [
      "==",
      "disputed",
      1
    ],
    [
      "==",
      "maritime",
      0
    ]
  ]
}
```

In osm2vectortiles, `admin` layer contains the administrative boundary lines. This is similar to the `boundary` layer in OpenMapTiles. Both of them contain `admin_level`, `disputed` and `maritime` properties. So, we only have to replace `admin` with `boundary` in the source-layer to make the conversion.
Additionally, there is a typo in the first one, it should be `admin_level_4`.

```json
{
  "type": "line",
  "id": "admin_level_4",
  "paint": {
    "line-color": "@admin_level_4"
  },
  "source-layer": "boundary",
  "filter": [
    "all",
    [
      ">=",
      "admin_level",
      4
    ],
    [
      "==",
      "maritime",
      0
    ]
  ]
},
{
  "type": "line",
  "id": "admin_level_3",
  "paint": {
    "line-color": "@admin_level_3"
  },
  "source-layer": "boundary",
  "filter": [
    "all",
    [
      "==",
      "admin_level",
      3
    ],
    [
      "==",
      "maritime",
      0
    ]
  ]
},
{
  "type": "line",
  "id": "admin_level_2",
  "paint": {
    "line-color": "@admin_level_2"
  },
  "source-layer": "boundary",
  "filter": [
    "all",
    [
      "==",
      "admin_level",
      2
    ],
    [
      "==",
      "disputed",
      0
    ],
    [
      "==",
      "maritime",
      0
    ]
  ]
},
{
  "type": "line",
  "id": "admin_level_2_disputed",
  "paint": {
    "line-color": "@admin_level_2_disputed"
  },
  "source-layer": "boundary",
  "filter": [
    "all",
    [
      "==",
      "admin_level",
      2
    ],
    [
      "==",
      "disputed",
      1
    ],
    [
      "==",
      "maritime",
      0
    ]
  ]
}
```

## admin_level_3_maritime, admin_level_2_maritime

```json
{
  "type": "line",
  "id": "admin_level_3_maritime",
  "paint": {
    "line-color": "@admin_level_3_maritime"
  },
  "source-layer": "admin",
  "filter": [
    "all",
    [
      ">=",
      "admin_level",
      3
    ],
    [
      "==",
      "maritime",
      1
    ]
  ]
},
{
  "type": "line",
  "id": "admin_level_2_maritime",
  "paint": {
    "line-color": "@admin_level_2_maritime"
  },
  "source-layer": "admin",
  "filter": [
    "all",
    [
      "==",
      "admin_level",
      2
    ],
    [
      "==",
      "maritime",
      1
    ]
  ]
}
```

- Just change `source-layer` to `boundary`.

```json
{
  "type": "line",
  "id": "admin_level_3_maritime",
  "paint": {
    "line-color": "@admin_level_3_maritime"
  },
  "source-layer": "boundary",
  "filter": [
    "all",
    [
      ">=",
      "admin_level",
      3
    ],
    [
      "==",
      "maritime",
      1
    ]
  ]
},
{
  "type": "line",
  "id": "admin_level_2_maritime",
  "paint": {
    "line-color": "@admin_level_2_maritime"
  },
  "source-layer": "boundary",
  "filter": [
    "all",
    [
      "==",
      "admin_level",
      2
    ],
    [
      "==",
      "maritime",
      1
    ]
  ]
}
```

## water_label

```json
{
  "type": "symbol",
  "id": "water_label",
  "paint": {
    "text-color": "@water_label"
  },
  "source-layer": "water_label",
  "filter": [
    "==",
    "$type",
    "Point"
  ]
}
```

- Replace `water-label` with `water-name`.

```json
{
  "type": "symbol",
  "id": "water_name",
  "paint": {
    "text-color": "@water_name"
  },
  "source-layer": "water_name",
  "filter": [
    "==",
    "$type",
    "Point"
  ]
}
```

## poi_label_4, poi_label_3, poi_label_2

```json
{
  "type": "symbol",
  "id": "poi_label_4",
  "paint": {
    "text-color": "@poi_label_4"
  },
  "source-layer": "poi_label",
  "filter": [
    "all",
    [
      "==",
      "$type",
      "Point"
    ],
    [
      "==",
      "scalerank",
      4
    ]
  ],
  "minzoom": 16
},
{
  "type": "symbol",
  "id": "poi_label_3",
  "paint": {
    "text-color": "@poi_label_3"
  },
  "source-layer": "poi_label",
  "filter": [
    "all",
    [
      "==",
      "$type",
      "Point"
    ],
    [
      "==",
      "scalerank",
      3
    ]
  ],
  "minzoom": 15
},
{
  "type": "symbol",
  "id": "poi_label_2",
  "paint": {
    "text-color": "@poi_label_2"
  },
  "source-layer": "poi_label",
  "filter": [
    "all",
    [
      "==",
      "$type",
      "Point"
    ],
    [
      "==",
      "scalerank",
      2
    ]
  ],
  "minzoom": 14
}
```

Similar to `poi_label` in osm2vectortiles, there is `poi` layer in OpenMapTiles. `scalerank` property ranks the places of interests based on their area.

- **Scalerank 1:** POI has area > 145000
- **Scalerank 2:** POI has area > 12780
- **Scalerank 3:** POI has area > 2960
- **Scalerank 4:** POI has no known area

The `poi` layer in OpenMapTiles has a `rank` field but it is based on importance within a grid. However, [osm-bright-gl-style](https://github.com/openmaptiles/osm-bright-gl-style) uses a 3-level ranking of POI and the [bounds](https://github.com/openmaptiles/osm-bright-gl-style/blob/master/style.json#L1993-L2084) are:

- **Level 3:** `rank >= 25`
- **Level 2:** `rank >= 15` and `rank <= 24`
- **Level 1:** `rank <= 14`

Modifying the leveling scheme for 4 levels, the conversion becomes:

```json
{
  "type": "symbol",
  "id": "poi_level_4",
  "paint": {
    "text-color": "@poi_level_4"
  },
  "source-layer": "poi",
  "filter": [
    "all",
    [
      "==",
      "$type",
      "Point"
    ],
    [
      ">=",
      "rank",
      25
    ]
  ],
  "minzoom": 16
},
{
  "type": "symbol",
  "id": "poi_level_3",
  "paint": {
    "text-color": "@poi_level_3"
  },
  "source-layer": "poi",
  "filter": [
    "all",
    [
      "==",
      "$type",
      "Point"
    ],
    [
      ">=",
      "rank",
      15
    ],
    [
      "<=",
      "rank",
      24
    ]
  ],
  "minzoom": 15
},
{
  "type": "symbol",
  "id": "poi_level_2",
  "paint": {
    "text-color": "@poi_level_2"
  },
  "source-layer": "poi",
  "filter": [
    "all",
    [
      "==",
      "$type",
      "Point"
    ],
    [
      ">=",
      "rank",
      7
    ],
    [
      "<=",
      "rank",
      14
    ]
  ],
  "minzoom": 14
},
{
  "type": "symbol",
  "id": "poi_level_1",
  "paint": {
    "text-color": "@poi_level_1"
  },
  "source-layer": "poi",
  "filter": [
    "all",
    [
      "==",
      "$type",
      "Point"
    ],
    [
      "<",
      "rank",
      7
    ]
  ],
  "minzoom": 13
}
```

## rail_station_label

```json
{
  "type": "symbol",
  "id": "rail_station_label",
  "paint": {
    "text-color": "@rail_station_label"
  },
  "source-layer": "rail_station_label"
}
```

In OpenMapTiles, rail station name is part of `poi` layer.

```json
{
  "type": "symbol",
  "id": "rail_station_label",
  "paint": {
    "text-color": "@rail_station_label"
  },
  "source-layer": "poi",
  "filter": [
    "all",
    [
      "==",
      "$type",
      "Point"
    ],
    [
      "==",
      "class",
      "railway"
    ],
    [
      "==",
      "subclass",
      "station"
    ]
  ]
}
```

## airport_label

```json
{
  "type": "symbol",
  "id": "airport_label",
  "paint": {
    "text-color": "@airport_label"
  },
  "source-layer": "airport_label",
  "filter": [
    "all",
    [
      "==",
      "$type",
      "Point"
    ],
    [
      "in",
      "scalerank",
      1,
      2,
      3
    ]
  ],
  "minzoom": 11
}
```

In OpenMapTiles, airport labels are present in `aerodrome_label` layer. There is no ranking system but we can use the `iata` property to filter for major airports

```json
{
  "type": "symbol",
  "id": "aerodrome_label",
  "paint": {
    "text-color": "@aerodrome_label"
  },
  "source-layer": "aerodrome_label",
  "filter": [
    "all",
    [
      "==",
      "$type",
      "Point"
    ],
    [ 
      "has", 
      "iata"
    ]
  ],
  "minzoom": 11
}
```

## road_label

```json
{
  "type": "symbol",
  "id": "road_label",
  "paint": {
    "text-color": "@road_label"
  },
  "source-layer": "road_label",
  "filter": [
    "!=",
    "class",
    "ferry"
  ],
  "minzoom": 15.5
}
```

- In OpenMapTiles, use `transportation_name` layer.

```json
{
  "type": "symbol",
  "id": "transportation_name",
  "paint": {
    "text-color": "@transportation_name"
  },
  "source-layer": "transportation_name",
  "minzoom": 15.5
}
```

## place_label_other, place_label_village, place_label_town, place_label_city

```json
{
  "type": "symbol",
  "id": "place_label_other",
  "paint": {
    "text-color": "@place_label_other"
  },
  "source-layer": "place_label",
  "filter": [
    "in",
    "type",
    "hamlet",
    "suburb",
    "neighbourhood",
    "island",
    "islet"
  ]
},
{
  "type": "symbol",
  "id": "place_label_village",
  "paint": {
    "text-color": "@place_label_village"
  },
  "source-layer": "place_label",
  "filter": [
    "==",
    "type",
    "village"
  ]
},
{
  "type": "symbol",
  "id": "place_label_town",
  "paint": {
    "text-color": "@place_label_town"
  },
  "source-layer": "place_label",
  "filter": [
    "==",
    "type",
    "town"
  ]
},
{
  "type": "symbol",
  "id": "place_label_city",
  "paint": {
    "text-color": "@place_label_city"
  },
  "source-layer": "place_label",
  "filter": [
    "==",
    "type",
    "city"
  ]
}
```

- Change the `source-layer` to `place`.
- `place` layer in OpenMapTiles does not have `islet` class.

```json
{
  "type": "symbol",
  "id": "place_label_other",
  "paint": {
    "text-color": "@place_label_other"
  },
  "source-layer": "place",
  "filter": [
    "in",
    "class",
    "hamlet",
    "suburb",
    "neighbourhood",
    "island"
  ]
},
{
  "type": "symbol",
  "id": "place_label_village",
  "paint": {
    "text-color": "@place_label_village"
  },
  "source-layer": "place",
  "filter": [
    "==",
    "class",
    "village"
  ]
},
{
  "type": "symbol",
  "id": "place_label_town",
  "paint": {
    "text-color": "@place_label_town"
  },
  "source-layer": "place",
  "filter": [
    "==",
    "class",
    "town"
  ]
},
{
  "type": "symbol",
  "id": "place_label_city",
  "paint": {
    "text-color": "@place_label_city"
  },
  "source-layer": "place",
  "filter": [
    "==",
    "class",
    "city"
  ]
}
```

## marine_label_line_4, marine_label_4, marine_label_line_3, marine_label_point_3

```json
{
  "type": "symbol",
  "id": "marine_label_line_4",
  "paint": {
    "text-color": "@marine_label_line_4"
  },
  "source-layer": "marine_label",
  "filter": [
    "all",
    [
      "==",
      "$type",
      "LineString"
    ],
    [
      ">=",
      "labelrank",
      4
    ]
  ]
},
{
  "type": "symbol",
  "id": "marine_label_4",
  "paint": {
    "text-color": "@marine_label_4"
  },
  "source-layer": "marine_label",
  "filter": [
    "all",
    [
      "==",
      "$type",
      "Point"
    ],
    [
      ">=",
      "labelrank",
      4
    ]
  ]
},
{
  "type": "symbol",
  "id": "marine_label_line_3",
  "paint": {
    "text-color": "@marine_label_line_3"
  },
  "source-layer": "marine_label",
  "filter": [
    "all",
    [
      "==",
      "$type",
      "LineString"
    ],
    [
      "==",
      "labelrank",
      3
    ]
  ]
},
{
  "type": "symbol",
  "id": "marine_label_point_3",
  "paint": {
    "text-color": "@marine_label_point_3"
  },
  "source-layer": "marine_label",
  "filter": [
    "all",
    [
      "==",
      "$type",
      "Point"
    ],
    [
      "==",
      "labelrank",
      3
    ]
  ]
}
```

- Change `source-layer` to OpenMapTiles.
- `labelrank` is determined based on importance, size and available room. As `water-name` layer does not have any property like `labelrank`, we can use its classes `lake`, `bay`, `strait`, `sea`, and `ocean` to create the levels.

```json
{
  "type": "symbol",
  "id": "water_name_line_4",
  "paint": {
    "text-color": "@water_name_line_4"
  },
  "source-layer": "water_name",
  "filter": [
    "all",
    [
      "==",
      "$type",
      "LineString"
    ]
  ]
},
{
  "type": "symbol",
  "id": "water_name_4",
  "paint": {
    "text-color": "@water_name_4"
  },
  "source-layer": "water_name",
  "filter": [
    "all",
    [
      "==",
      "$type",
      "Point"
    ]
  ]
},
{
  "type": "symbol",
  "id": "water_name_line_3",
  "paint": {
    "text-color": "@water_name_line_3"
  },
  "source-layer": "water_name",
  "filter": [
    "all",
    [
      "==",
      "$type",
      "LineString"
    ],
    [
      "in",
      "class",
      "bay",
      "strait",
      "sea",
      "ocean"
    ]
  ]
},
{
  "type": "symbol",
  "id": "water_name_point_3",
  "paint": {
    "text-color": "@water_name_point_3"
  },
  "source-layer": "water_name",
  "filter": [
    "all",
    [
      "==",
      "$type",
      "Point"
    ],
    [
      "in",
      "class",
      "bay",
      "strait",
      "sea",
      "ocean"
    ]
  ]
}
```

## marine_label_line_2, marine_label_point_2, marine_label_line_1, marine_label_point_1

```json
{
  "type": "symbol",
  "id": "marine_label_line_2",
  "paint": {
    "text-color": "@marine_label_line_2"
  },
  "source-layer": "marine_label",
  "filter": [
    "all",
    [
      "==",
      "$type",
      "LineString"
    ],
    [
      "==",
      "labelrank",
      2
    ]
  ]
},
{
  "type": "symbol",
  "id": "marine_label_point_2",
  "paint": {
    "text-color": "@marine_label_point_2"
  },
  "source-layer": "marine_label",
  "filter": [
    "all",
    [
      "==",
      "$type",
      "Point"
    ],
    [
      "==",
      "labelrank",
      2
    ]
  ]
},
{
  "type": "symbol",
  "id": "marine_label_line_1",
  "paint": {
    "text-color": "@marine_label_line_1"
  },
  "source-layer": "marine_label",
  "filter": [
    "all",
    [
      "==",
      "$type",
      "LineString"
    ],
    [
      "==",
      "labelrank",
      1
    ]
  ]
},
{
  "type": "symbol",
  "id": "marine_label_point_1",
  "paint": {
    "text-color": "@marine_label_point_1"
  },
  "source-layer": "marine_label",
  "filter": [
    "all",
    [
      "==",
      "$type",
      "Point"
    ],
    [
      "==",
      "labelrank",
      1
    ]
  ]
}
```

- Make same changes as the previous one.

```json
{
  "type": "symbol",
  "id": "water_name_line_2",
  "paint": {
    "text-color": "@water_name_line_2"
  },
  "source-layer": "water_name",
  "filter": [
    "all",
    [
      "==",
      "$type",
      "LineString"
    ],
    [
      "in",
      "class",
      "sea",
      "ocean"
    ]
  ]
},
{
  "type": "symbol",
  "id": "water_name_point_2",
  "paint": {
    "text-color": "@water_name_point_2"
  },
  "source-layer": "water_name",
  "filter": [
    "all",
    [
      "==",
      "$type",
      "Point"
    ],
    [
      "in",
      "class",
      "sea",
      "ocean"
    ]
  ]
},
{
  "type": "symbol",
  "id": "water_name_line_1",
  "paint": {
    "text-color": "@water_name_line_1"
  },
  "source-layer": "water_name",
  "filter": [
    "all",
    [
      "==",
      "$type",
      "LineString"
    ],
    [
      "==",
      "class",
      "ocean"
    ]
  ]
},
{
  "type": "symbol",
  "id": "water_name_point_1",
  "paint": {
    "text-color": "@water_name_point_1"
  },
  "source-layer": "water_name",
  "filter": [
    "all",
    [
      "==",
      "$type",
      "Point"
    ],
    [
      "==",
      "class",
      "ocean"
    ]
  ]
}
```

## country_label_4, country_label_3, country_label_2, country_label_1

```json
{
  "type": "symbol",
  "id": "country_label_4",
  "paint": {
    "text-color": "@country_label_4"
  },
  "source-layer": "country_label",
  "filter": [
    ">=",
    "scalerank",
    4
  ]
},
{
  "type": "symbol",
  "id": "country_label_3",
  "paint": {
    "text-color": "@country_label_3"
  },
  "source-layer": "country_label",
  "filter": [
    "==",
    "scalerank",
    3
  ]
},
{
  "type": "symbol",
  "id": "country_label_2",
  "paint": {
    "text-color": "@country_label_2"
  },
  "source-layer": "country_label",
  "filter": [
    "==",
    "scalerank",
    2
  ]
},
{
  "type": "symbol",
  "id": "country_label_1",
  "paint": {
    "text-color": "@country_label_1"
  },
  "source-layer": "country_label",
  "filter": [
    "==",
    "scalerank",
    1
  ]
}
```

In OpenMapTiles, we can use `place` layer and filter by country to show names of countries. Although scalerank is not available, there is a `rank` property that is based on `scalerank`, `labelrank` and `datarank` value.

```json
{
  "type": "symbol",
  "id": "country_label_4",
  "paint": {
    "text-color": "@country_label_4"
  },
  "source-layer": "place",
  "filter": [
    "all",
    [
      "==",
      "class",
      "country"
    ],
    [
      ">=",
      "rank",
      4
    ]
  ]
},
{
  "type": "symbol",
  "id": "country_label_3",
  "paint": {
    "text-color": "@country_label_3"
  },
  "source-layer": "place",
  "filter": [
    "all",
    [
      "==",
      "class",
      "country"
    ],
    [
      "==",
      "rank",
      3
    ]
  ]
},
{
  "type": "symbol",
  "id": "country_label_2",
  "paint": {
    "text-color": "@country_label_2"
  },
  "source-layer": "place",
  "filter": [
    "all",
    [
      "==",
      "class",
      "country"
    ],
    [
      "==",
      "rank",
      2
    ]
  ]
},
{
  "type": "symbol",
  "id": "country_label_1",
  "paint": {
    "text-color": "@country_label_1"
  },
  "source-layer": "place",
  "filter": [
    "all",
    [
      "==",
      "class",
      "country"
    ],
    [
      "==",
      "rank",
      1
    ]
  ]
}
```