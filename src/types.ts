export type TravelMode = "walking" | "bicycling" | "motorcycle" | "car";

export type Coordinates = {
  latitude: number;
  longitude: number;
};

export type Place = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  rating?: number;
  userRatingsTotal?: number;
  priceLevel?: number;
  priceRangeLabel?: string;
  distanceMeters?: number;
  etaByMode?: Record<TravelMode, number>;
  openingNow?: boolean;
  openingHoursText?: string[];
  menuUrl?: string;
  photoUrl?: string;
  source: "google" | "osm" | "backend";
  address?: string;
};

export type RouteEstimate = {
  mode: TravelMode;
  distanceMeters: number;
  durationMinutes: number;
};
