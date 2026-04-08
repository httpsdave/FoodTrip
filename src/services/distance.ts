import type { Coordinates, TravelMode } from "../types";

const EARTH_RADIUS_METERS = 6371000;

const SPEED_METERS_PER_MINUTE: Record<TravelMode, number> = {
  walking: 83.3,
  bicycling: 250,
  motorcycle: 500,
  car: 666.7
};

function toRadians(value: number): number {
  return (value * Math.PI) / 180;
}

export function haversineDistanceMeters(a: Coordinates, b: Coordinates): number {
  const dLat = toRadians(b.latitude - a.latitude);
  const dLon = toRadians(b.longitude - a.longitude);
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);

  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return EARTH_RADIUS_METERS * c;
}

export function estimateDurationMinutes(mode: TravelMode, distanceMeters: number): number {
  const speed = SPEED_METERS_PER_MINUTE[mode];
  return Math.max(1, Math.round(distanceMeters / speed));
}
