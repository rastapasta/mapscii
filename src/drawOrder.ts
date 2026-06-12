/*
  MapSCII - Terminal Map Viewer

  Shared layer draw order for the OpenMapTiles schema.
  Used by both the flat Renderer and the Globe so that paint order
  (e.g. water vs. landcover) stays consistent between the two views.
*/

/**
 * Layers whose features are symbols/labels. These are deferred to the end of
 * the frame and placed via the LabelBuffer (sorted by rank), and skipped
 * entirely when config.noLabels is enabled.
 */
export function isLabelLayer(layerId: string): boolean {
  return (
    layerId.includes('name') ||
    layerId === 'place' ||
    layerId === 'poi' ||
    layerId === 'housenumber' ||
    layerId === 'mountain_peak'
  );
}

/**
 * Background-to-foreground layer order for a given (integer) zoom level.
 */
export function generateDrawOrder(zoom: number): string[] {
  if (zoom < 2) {
    return [
      'boundary',
      'water',
      'place',
      'water_name',
    ];
  }
  return [
    'landcover',
    'landuse',
    'water',
    'waterway',
    'water_name',
    'aeroway',
    'park',
    'building',
    'transportation',
    'boundary',
    'place',
    'poi',
    'transportation_name',
    'housenumber',
    'mountain_peak',
  ];
}
