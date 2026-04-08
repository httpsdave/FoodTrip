import "dotenv/config";

import axios from "axios";
import cors from "cors";
import express from "express";
import { LRUCache } from "lru-cache";

type Coordinates = {
  latitude: number;
  longitude: number;
};

type Place = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  rating?: number;
  userRatingsTotal?: number;
  priceLevel?: number;
  openingNow?: boolean;
  openingHoursText?: string[];
  menuUrl?: string;
  photoUrl?: string;
  address?: string;
  source: "google" | "osm" | "backend";
};

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(cors({ origin: process.env.CORS_ORIGIN || "*" }));

const PORT = Number(process.env.PORT || 8787);
const CACHE_TTL_SECONDS = Number(process.env.CACHE_TTL_SECONDS || 900);
const MAX_RETURNED_PLACES = Number(process.env.MAX_RETURNED_PLACES || 400);
const GEOAPIFY_API_KEY = process.env.GEOAPIFY_API_KEY || "";
const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY || "";

const OSM_OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://lz4.overpass-api.de/api/interpreter"
];

const cache = new LRUCache<string, Place[]>({
  max: 1000,
  ttl: CACHE_TTL_SECONDS * 1000
});

function haversineDistanceMeters(a: Coordinates, b: Coordinates): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const r = 6371000;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 2 * r * Math.asin(Math.sqrt(h));
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function dedupePlaces(places: Place[]): Place[] {
  const byKey = new Map<string, Place>();

  for (const place of places) {
    const nameKey = place.name.trim().toLowerCase();
    const key = `${nameKey}:${round4(place.latitude)}:${round4(place.longitude)}`;
    const existing = byKey.get(key);

    if (!existing) {
      byKey.set(key, place);
      continue;
    }

    byKey.set(key, {
      ...existing,
      ...place,
      openingHoursText: place.openingHoursText ?? existing.openingHoursText,
      menuUrl: place.menuUrl ?? existing.menuUrl,
      photoUrl: place.photoUrl ?? existing.photoUrl,
      address: place.address ?? existing.address,
      rating: place.rating ?? existing.rating,
      userRatingsTotal: place.userRatingsTotal ?? existing.userRatingsTotal,
      priceLevel: place.priceLevel ?? existing.priceLevel
    });
  }

  return Array.from(byKey.values());
}

async function fetchGeoapify(center: Coordinates, radius: number): Promise<Place[]> {
  if (!GEOAPIFY_API_KEY) {
    return [];
  }

  const response = await axios.get("https://api.geoapify.com/v2/places", {
    params: {
      apiKey: GEOAPIFY_API_KEY,
      categories: "catering.restaurant,catering.fast_food,catering.cafe,catering.pub,catering.bar",
      filter: `circle:${center.longitude},${center.latitude},${radius}`,
      bias: `proximity:${center.longitude},${center.latitude}`,
      limit: 120,
      lang: "en"
    },
    timeout: 12000
  });

  return (response.data?.features ?? [])
    .map((feature: any) => {
      const props = feature?.properties;
      const latitude = Number(props?.lat);
      const longitude = Number(props?.lon);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        return null;
      }

      return {
        id: `geo-${props?.place_id ?? `${latitude}-${longitude}`}`,
        name: props?.name || props?.address_line1 || "Unnamed Food Place",
        latitude,
        longitude,
        address: props?.formatted || props?.address_line2,
        openingHoursText: props?.opening_hours ? [String(props.opening_hours)] : undefined,
        source: "osm" as const
      };
    })
    .filter(Boolean) as Place[];
}

async function fetchGoogle(center: Coordinates, radius: number): Promise<Place[]> {
  if (!GOOGLE_MAPS_API_KEY) {
    return [];
  }

  const url = "https://maps.googleapis.com/maps/api/place/nearbysearch/json";
  const types = ["restaurant", "cafe", "bakery", "meal_takeaway"];
  const places: Place[] = [];
  const seen = new Set<string>();

  for (const type of types) {
    const response = await axios.get(url, {
      params: {
        key: GOOGLE_MAPS_API_KEY,
        location: `${center.latitude},${center.longitude}`,
        radius,
        type
      },
      timeout: 12000
    });

    for (const item of response.data?.results ?? []) {
      const placeId = String(item.place_id ?? "");
      if (!placeId || seen.has(placeId)) {
        continue;
      }
      seen.add(placeId);
      places.push({
        id: placeId,
        name: item.name || "Unnamed Food Place",
        latitude: Number(item.geometry?.location?.lat),
        longitude: Number(item.geometry?.location?.lng),
        rating: Number.isFinite(Number(item.rating)) ? Number(item.rating) : undefined,
        userRatingsTotal: Number.isFinite(Number(item.user_ratings_total))
          ? Number(item.user_ratings_total)
          : undefined,
        priceLevel: Number.isFinite(Number(item.price_level)) ? Number(item.price_level) : undefined,
        openingNow: typeof item.opening_hours?.open_now === "boolean" ? item.opening_hours.open_now : undefined,
        address: item.vicinity,
        source: "google"
      });
    }
  }

  return places.filter((p) => Number.isFinite(p.latitude) && Number.isFinite(p.longitude));
}

async function fetchOverpass(center: Coordinates, radius: number): Promise<Place[]> {
  const query = `
[out:json][timeout:20];
(
  node(around:${radius},${center.latitude},${center.longitude})["amenity"~"restaurant|fast_food|cafe|bar|pub"];
  way(around:${radius},${center.latitude},${center.longitude})["amenity"~"restaurant|fast_food|cafe|bar|pub"];
);
out center tags 300;
`;

  let response: any;
  for (const endpoint of OSM_OVERPASS_ENDPOINTS) {
    try {
      response = await axios.post(endpoint, query, {
        headers: { "Content-Type": "text/plain" },
        timeout: 15000
      });
      break;
    } catch {
      continue;
    }
  }

  if (!response) {
    return [];
  }

  return (response.data?.elements ?? [])
    .map((el: any) => {
      const latitude = Number(el.lat ?? el.center?.lat);
      const longitude = Number(el.lon ?? el.center?.lon);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        return null;
      }

      return {
        id: `osm-${String(el.id)}`,
        name: el.tags?.name ?? "Unnamed Food Place",
        latitude,
        longitude,
        openingHoursText: el.tags?.opening_hours ? [String(el.tags.opening_hours)] : undefined,
        menuUrl: el.tags?.website,
        address: el.tags?.["addr:full"],
        source: "osm" as const
      };
    })
    .filter(Boolean) as Place[];
}

function parseNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/places/search", async (req, res) => {
  const lat = parseNumber(req.query.lat);
  const lng = parseNumber(req.query.lng);
  const radius = parseNumber(req.query.radius) ?? 3500;

  if (lat === null || lng === null || radius < 200 || radius > 50000) {
    res.status(400).json({
      error: "Invalid query params. Use lat, lng, and radius in meters (200-50000)."
    });
    return;
  }

  const center: Coordinates = { latitude: lat, longitude: lng };
  const cacheKey = `${round4(lat)}:${round4(lng)}:${Math.round(radius / 100) * 100}`;
  const cached = cache.get(cacheKey);

  if (cached) {
    res.json({ places: cached, cached: true, count: cached.length });
    return;
  }

  try {
    const [google, geoapify, osm] = await Promise.allSettled([
      fetchGoogle(center, radius),
      fetchGeoapify(center, radius),
      fetchOverpass(center, radius)
    ]);

    const merged: Place[] = [];
    if (google.status === "fulfilled") {
      merged.push(...google.value);
    }
    if (geoapify.status === "fulfilled") {
      merged.push(...geoapify.value);
    }
    if (osm.status === "fulfilled") {
      merged.push(...osm.value);
    }

    const result = dedupePlaces(merged)
      .map((place) => ({
        ...place,
        distanceMeters: haversineDistanceMeters(center, {
          latitude: place.latitude,
          longitude: place.longitude
        })
      }))
      .sort((a, b) => (a.distanceMeters ?? 0) - (b.distanceMeters ?? 0))
      .slice(0, MAX_RETURNED_PLACES)
      .map((place) => ({
        ...place,
        source: "backend" as const
      }));

    cache.set(cacheKey, result);

    res.json({ places: result, cached: false, count: result.length });
  } catch (error) {
    console.error("places/search failed", error);
    res.status(500).json({ error: "Failed to retrieve places." });
  }
});

app.listen(PORT, () => {
  console.log(`FoodTrip places backend listening on port ${PORT}`);
});
