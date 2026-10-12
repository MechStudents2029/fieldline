/**
 * Address geocoding stays behind this interface and is off.
 * Nothing in the app calls a map or geocoding service.
 */
export const GEOCODER_ENABLED = false;

export type GeocodeHit = { lat: number; lng: number };

export type Geocoder = {
  lookup(address: string): Promise<GeocodeHit | null>;
};

export const stubGeocoder: Geocoder = {
  async lookup() {
    return null;
  },
};

export async function geocodeAddress(address: string): Promise<GeocodeHit | null> {
  if (!GEOCODER_ENABLED) return null;
  const query = address.trim();
  if (!query) return null;
  return stubGeocoder.lookup(query);
}
