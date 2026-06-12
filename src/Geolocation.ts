/*
  MapSCII - Terminal Map Viewer
  Geolocation Module

  Uses @derhuerst/location for WiFi-based geolocation
  Falls back to IP-based geolocation via ipinfo.io
*/

export interface GeoPosition {
    latitude: number;
    longitude: number;
    accuracy?: number;
    source: string;
}

/**
 * Get current location using WiFi triangulation
 * Falls back to IP-based geolocation
 */
export async function getCurrentLocation(): Promise<GeoPosition> {
  // Try WiFi-based location first (uses @derhuerst/location)
  try {
    const location = await getWiFiLocation();
    if (location) return location;
  } catch {
    // WiFi location failed, fall through to IP
  }

  // Fallback to IP-based geolocation
  return await getIPLocation();
}

/**
 * WiFi-based geolocation using @derhuerst/location
 * This uses wifi-triangulate internally
 */
async function getWiFiLocation(): Promise<GeoPosition | null> {
  try {
    const queryLocation = (await import('@derhuerst/location')).default;

    const location = await Promise.race([
      queryLocation(),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 10000)) // 10s timeout
    ]);

    if (location && typeof location.latitude === 'number' && typeof location.longitude === 'number') {
      return {
        latitude: location.latitude,
        longitude: location.longitude,
        accuracy: location.accuracy,
        source: `WiFi${location.accuracy ? ` (±${Math.round(location.accuracy)}m)` : ''}`,
      };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Fallback: IP-based geolocation using ipinfo.io
 */
async function getIPLocation(): Promise<GeoPosition> {
  try {
    const response = await fetch('https://ipinfo.io/json');
    const data = await response.json() as { loc?: string; city?: string; country?: string };

    if (data.loc) {
      const [lat, lon] = data.loc.split(',').map(Number);
      return {
        latitude: lat,
        longitude: lon,
        source: `IP (${[data.city, data.country].filter(Boolean).join(', ') || 'Unknown'})`,
      };
    }

    throw new Error('No location data in response');
  } catch (error) {
    throw new Error(`Location unavailable: ${error}`);
  }
}
