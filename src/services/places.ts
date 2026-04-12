import axios from "axios";

import { env } from "../config/env";
import { haversineDistanceMeters } from "./distance";
import type { Coordinates, Place } from "../types";

const GOOGLE_BASE = "https://maps.googleapis.com/maps/api/place";
const OSM_OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://lz4.overpass-api.de/api/interpreter"
];
const GEOAPIFY_PAGE_LIMIT = 100;
const GEOAPIFY_MAX_PAGES = 3;
const MAX_RETURNED_PLACES = 300;
const PRIMARY_PROVIDER_SATISFIED_COUNT = 120;

async function fetchBackendNearby(center: Coordinates, radiusMeters: number): Promise<Place[]> {
  const response = await axios.get(`${env.PLACES_BACKEND_URL.replace(/\/$/, "")}/places/search`, {
    params: {
      lat: center.latitude,
      lng: center.longitude,
      radius: radiusMeters,
      categories: "restaurant,cafe,fast_food,bakery,meal_takeaway"
    },
    timeout: 12000
  });

  const places = Array.isArray(response.data?.places) ? response.data.places : [];

  return places
    .map((item: any) => {
      const latitude = Number(item.latitude);
      const longitude = Number(item.longitude);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        return null;
      }

      return {
        id: String(item.id ?? `backend-${latitude}-${longitude}`),
        name: String(item.name ?? "Unnamed Food Place"),
        latitude,
        longitude,
        rating: Number.isFinite(Number(item.rating)) ? Number(item.rating) : undefined,
        userRatingsTotal: Number.isFinite(Number(item.userRatingsTotal))
          ? Number(item.userRatingsTotal)
          : undefined,
        priceLevel: Number.isFinite(Number(item.priceLevel)) ? Number(item.priceLevel) : undefined,
        openingNow: typeof item.openingNow === "boolean" ? item.openingNow : undefined,
        openingHoursText: Array.isArray(item.openingHoursText)
          ? item.openingHoursText.map((value: unknown) => String(value))
          : undefined,
        menuUrl: item.menuUrl ? String(item.menuUrl) : undefined,
        photoUrl: item.photoUrl ? String(item.photoUrl) : undefined,
        address: item.address ? String(item.address) : undefined,
        source: "backend" as const
      };
    })
    .filter(Boolean) as Place[];
}

function toGeoapifyPlace(feature: any): Place | null {
  const props = feature?.properties;
  const latitude = Number(props?.lat);
  const longitude = Number(props?.lon);
  if (Number.isNaN(latitude) || Number.isNaN(longitude)) {
    return null;
  }

  const name = props?.name || props?.address_line1 || "Unnamed Food Place";
  const openingHoursText = props?.opening_hours ? [String(props.opening_hours)] : undefined;

  return {
    id: `geo-${props?.place_id ?? `${latitude}-${longitude}`}`,
    name,
    latitude,
    longitude,
    address: props?.formatted || props?.address_line2,
    openingHoursText,
    source: "osm"
  };
}

async function fetchGeoapifyNearby(center: Coordinates, radiusMeters: number): Promise<Place[]> {
  const all: Place[] = [];

  for (let page = 0; page < GEOAPIFY_MAX_PAGES; page += 1) {
    const response = await axios.get("https://api.geoapify.com/v2/places", {
      params: {
        apiKey: env.GEOAPIFY_API_KEY,
        categories: "catering.restaurant,catering.fast_food,catering.cafe,catering.pub,catering.bar",
        filter: `circle:${center.longitude},${center.latitude},${radiusMeters}`,
        bias: `proximity:${center.longitude},${center.latitude}`,
        limit: GEOAPIFY_PAGE_LIMIT,
        offset: page * GEOAPIFY_PAGE_LIMIT,
        lang: "en"
      },
      timeout: 12000
    });

    const mapped = (response.data?.features ?? [])
      .map((feature: any) => toGeoapifyPlace(feature))
      .filter(Boolean) as Place[];

    all.push(...mapped);

    if (mapped.length < GEOAPIFY_PAGE_LIMIT) {
      break;
    }
  }

  return all;
}

function toNominatimPlace(item: any): Place | null {
  const latitude = Number(item.lat);
  const longitude = Number(item.lon);
  if (Number.isNaN(latitude) || Number.isNaN(longitude)) {
    return null;
  }

  const displayName = item.display_name ? String(item.display_name) : "";
  const name =
    item.name ||
    displayName.split(",")[0]?.trim() ||
    item.type ||
    "Unnamed Food Place";

  return {
    id: `nom-${item.place_id ?? `${latitude}-${longitude}`}`,
    name,
    latitude,
    longitude,
    address: displayName || undefined,
    source: "osm"
  };
}

async function fetchNominatimNearby(center: Coordinates, radiusMeters: number): Promise<Place[]> {
  const latOffset = radiusMeters / 111320;
  const lonOffset = radiusMeters / (111320 * Math.cos((center.latitude * Math.PI) / 180));
  const left = center.longitude - lonOffset;
  const right = center.longitude + lonOffset;
  const top = center.latitude + latOffset;
  const bottom = center.latitude - latOffset;
  const viewbox = `${left},${top},${right},${bottom}`;

  const categories = ["restaurant", "cafe", "fast food"];
  const collected: Place[] = [];
  const seen = new Set<string>();

  for (const category of categories) {
    const response = await axios.get("https://nominatim.openstreetmap.org/search", {
      params: {
        q: category,
        format: "jsonv2",
        limit: 12,
        bounded: 1,
        viewbox,
        countrycodes: "ph"
      },
      headers: {
        Accept: "application/json",
        "Accept-Language": "en",
        "User-Agent": "FoodTrip/0.1 (mobile app)"
      },
      timeout: 12000
    });

    for (const item of response.data ?? []) {
      const mapped = toNominatimPlace(item);
      if (!mapped || seen.has(mapped.id)) {
        continue;
      }
      seen.add(mapped.id);
      collected.push(mapped);
    }
  }

  return collected;
}

function describeAxiosError(error: unknown): string {
  if (!axios.isAxiosError(error)) {
    return "Unknown network error.";
  }

  const status = error.response?.status;
  const statusText = error.response?.statusText;
  const message = error.message;

  if (status) {
    return `HTTP ${status}${statusText ? ` ${statusText}` : ""}: ${message}`;
  }

  return message;
}

function buildGooglePhotoUrl(photoReference?: string, maxWidth = 600): string | undefined {
  if (!photoReference || !env.hasGoogleMaps) {
    return undefined;
  }

  return `${GOOGLE_BASE}/photo?maxwidth=${maxWidth}&photo_reference=${photoReference}&key=${env.GOOGLE_MAPS_API_KEY}`;
}

async function fetchGoogleNearby(center: Coordinates, radiusMeters: number): Promise<Place[]> {
  const url = `${GOOGLE_BASE}/nearbysearch/json`;
  const types = ["restaurant", "cafe", "bakery", "meal_takeaway"];
  const seen = new Set<string>();
  const merged: Place[] = [];

  for (const type of types) {
    const response = await axios.get(url, {
      params: {
        key: env.GOOGLE_MAPS_API_KEY,
        location: `${center.latitude},${center.longitude}`,
        radius: radiusMeters,
        type
      },
      timeout: 12000
    });

    const results = response.data?.results ?? [];

    for (const item of results) {
      const placeId = String(item.place_id ?? "");
      if (!placeId || seen.has(placeId)) {
        continue;
      }
      seen.add(placeId);
      merged.push({
        id: placeId,
        name: item.name,
        latitude: item.geometry?.location?.lat,
        longitude: item.geometry?.location?.lng,
        rating: item.rating,
        userRatingsTotal: item.user_ratings_total,
        priceLevel: Number.isFinite(Number(item.price_level)) ? Number(item.price_level) : undefined,
        openingNow: item.opening_hours?.open_now,
        photoUrl: buildGooglePhotoUrl(item.photos?.[0]?.photo_reference),
        address: item.vicinity,
        source: "google"
      });
    }
  }

  return merged;
}

function dedupePlaces(places: Place[]): Place[] {
  const byKey = new Map<string, Place>();

  for (const place of places) {
    if (!Number.isFinite(place.latitude) || !Number.isFinite(place.longitude)) {
      continue;
    }

    const nameKey = (place.name || "").trim().toLowerCase();
    const latKey = Math.round(place.latitude * 10000) / 10000;
    const lonKey = Math.round(place.longitude * 10000) / 10000;
    const key = `${nameKey}:${latKey}:${lonKey}`;
    const existing = byKey.get(key);

    if (!existing) {
      byKey.set(key, place);
      continue;
    }

    byKey.set(key, {
      ...existing,
      ...place,
      // Keep richer metadata from whichever provider returned it.
      openingHoursText: place.openingHoursText ?? existing.openingHoursText,
      menuUrl: place.menuUrl ?? existing.menuUrl,
      photoUrl: place.photoUrl ?? existing.photoUrl,
      address: place.address ?? existing.address,
      rating: place.rating ?? existing.rating,
      userRatingsTotal: place.userRatingsTotal ?? existing.userRatingsTotal
    });
  }

  return Array.from(byKey.values());
}

async function fetchOSMNearby(center: Coordinates, radiusMeters: number): Promise<Place[]> {
  const query = `
[out:json][timeout:20];
(
  node(around:${radiusMeters},${center.latitude},${center.longitude})["amenity"~"restaurant|fast_food|cafe"];
  way(around:${radiusMeters},${center.latitude},${center.longitude})["amenity"~"restaurant|fast_food|cafe"];
);
out center tags 30;
`;

  let response;
  let lastError: string | null = null;

  for (const endpoint of OSM_OVERPASS_ENDPOINTS) {
    try {
      response = await axios.post(endpoint, query, {
        headers: { "Content-Type": "text/plain" },
        timeout: 15000
      });
      break;
    } catch (error) {
      lastError = `${endpoint} -> ${describeAxiosError(error)}`;
      console.warn("Overpass request failed:", lastError);
    }
  }

  if (!response) {
    throw new Error(`Food place provider failed. ${lastError ?? "No response from Overpass."}`);
  }

  const elements = response.data?.elements ?? [];

  return elements
    .map((el: any) => {
      const latitude = el.lat ?? el.center?.lat;
      const longitude = el.lon ?? el.center?.lon;
      if (!latitude || !longitude) {
        return null;
      }

      return {
        id: String(el.id),
        name: el.tags?.name ?? "Unnamed Food Place",
        latitude,
        longitude,
        openingHoursText: el.tags?.opening_hours ? [el.tags.opening_hours] : undefined,
        menuUrl: el.tags?.website,
        address: el.tags?.["addr:full"],
        source: "osm" as const
      };
    })
    .filter(Boolean) as Place[];
}

export async function fetchNearbyPlaces(center: Coordinates, radiusMeters = 2500): Promise<Place[]> {
  if (env.hasPlacesBackend) {
    try {
      const backendPlaces = await fetchBackendNearby(center, radiusMeters);
      if (backendPlaces.length > 0) {
        return backendPlaces
          .map((place) => ({
            ...place,
            distanceMeters: haversineDistanceMeters(center, {
              latitude: place.latitude,
              longitude: place.longitude
            })
          }))
          .sort((a, b) => (a.distanceMeters ?? 0) - (b.distanceMeters ?? 0))
          .slice(0, MAX_RETURNED_PLACES);
      }
    } catch (error) {
      console.warn("Backend places fetch failed, falling back to direct providers:", describeAxiosError(error));
    }
  }

  const collected: Place[] = [];

  if (env.hasGoogleMaps) {
    try {
      collected.push(...(await fetchGoogleNearby(center, radiusMeters)));
    } catch (error) {
      console.warn("Google Places failed:", describeAxiosError(error));
    }
  }

  if (env.hasGeoapify) {
    try {
      collected.push(...(await fetchGeoapifyNearby(center, radiusMeters)));
    } catch (error) {
      console.warn("Geoapify Places failed:", describeAxiosError(error));
    }
  }

  if (collected.length < PRIMARY_PROVIDER_SATISFIED_COUNT) {
    try {
      collected.push(...(await fetchOSMNearby(center, radiusMeters)));
    } catch (error) {
      console.warn("Overpass exhausted, trying Nominatim fallback:", describeAxiosError(error));
      try {
        collected.push(...(await fetchNominatimNearby(center, radiusMeters)));
      } catch (nominatimError) {
        console.warn("Nominatim fallback failed:", describeAxiosError(nominatimError));
      }
    }
  }

  const places = dedupePlaces(collected);

  return places
    .map((place) => ({
      ...place,
      distanceMeters: haversineDistanceMeters(center, {
        latitude: place.latitude,
        longitude: place.longitude
      })
    }))
    .sort((a, b) => (a.distanceMeters ?? 0) - (b.distanceMeters ?? 0))
    .slice(0, MAX_RETURNED_PLACES);
}

export async function enrichGooglePlaceDetails(placeId: string): Promise<Partial<Place>> {
  if (!env.hasGoogleMaps) {
    return {};
  }

  const url = `${GOOGLE_BASE}/details/json`;
  const response = await axios.get(url, {
    params: {
      key: env.GOOGLE_MAPS_API_KEY,
      place_id: placeId,
      fields: [
        "name",
        "opening_hours",
        "url",
        "website",
        "editorial_summary",
        "photos",
        "formatted_address",
        "price_level",
        "rating",
        "user_ratings_total"
      ].join(",")
    },
    timeout: 12000
  });

  const result = response.data?.result;
  if (!result) {
    return {};
  }

  return {
    openingHoursText: result.opening_hours?.weekday_text,
    menuUrl: result.website,
    address: result.formatted_address,
    photoUrl: buildGooglePhotoUrl(result.photos?.[0]?.photo_reference, 1000),
    priceLevel: Number.isFinite(Number(result.price_level)) ? Number(result.price_level) : undefined,
    rating: Number.isFinite(Number(result.rating)) ? Number(result.rating) : undefined,
    userRatingsTotal: Number.isFinite(Number(result.user_ratings_total))
      ? Number(result.user_ratings_total)
      : undefined
  };
}

function normalizeName(value: string | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseOsmRating(tags: Record<string, any> | undefined): number | undefined {
  if (!tags) {
    return undefined;
  }

  const candidates = [tags.stars, tags.rating, tags["rating:overall"]];
  for (const value of candidates) {
    if (value === undefined || value === null) {
      continue;
    }
    const parsed = Number(String(value).replace(",", "."));
    if (Number.isFinite(parsed) && parsed > 0) {
      // Clamp to the familiar 0-5 scale used in the UI.
      return Math.max(0, Math.min(5, parsed));
    }
  }

  return undefined;
}

function parseOsmPriceLevel(tags: Record<string, any> | undefined): number | undefined {
  if (!tags) {
    return undefined;
  }

  const byLevel = Number(tags["price_level"]);
  if (Number.isFinite(byLevel) && byLevel >= 0) {
    return Math.max(0, Math.min(4, byLevel));
  }

  const raw = String(tags["price_range"] ?? tags["price"] ?? tags.fee ?? "").trim();
  if (!raw) {
    return undefined;
  }

  const symbolCount = (raw.match(/[$€£₱]/g) ?? []).length;
  if (symbolCount > 0) {
    return Math.max(1, Math.min(4, symbolCount));
  }

  const numeric = Number(raw.replace(/[^0-9.]/g, ""));
  if (Number.isFinite(numeric) && numeric > 0) {
    if (numeric < 150) return 1;
    if (numeric < 350) return 2;
    if (numeric < 700) return 3;
    return 4;
  }

  return undefined;
}

function composeOsmAddress(tags: Record<string, any> | undefined): string | undefined {
  if (!tags) {
    return undefined;
  }

  if (tags["addr:full"]) {
    return String(tags["addr:full"]);
  }

  const parts = [
    tags["addr:housenumber"],
    tags["addr:street"],
    tags["addr:city"] ?? tags["addr:town"] ?? tags["addr:village"],
    tags["addr:state"],
    tags["addr:postcode"]
  ]
    .filter(Boolean)
    .map((v) => String(v));

  return parts.length > 0 ? parts.join(", ") : undefined;
}

async function enrichOsmPlaceDetails(place: Place): Promise<Partial<Place>> {
  const query = `
[out:json][timeout:18];
(
  node(around:140,${place.latitude},${place.longitude})["amenity"~"restaurant|fast_food|cafe|bar|pub|bakery"];
  way(around:140,${place.latitude},${place.longitude})["amenity"~"restaurant|fast_food|cafe|bar|pub|bakery"];
);
out center tags 40;
`;

  let response: any;
  for (const endpoint of OSM_OVERPASS_ENDPOINTS) {
    try {
      response = await axios.post(endpoint, query, {
        headers: { "Content-Type": "text/plain" },
        timeout: 12000
      });
      break;
    } catch {
      continue;
    }
  }

  const elements = response?.data?.elements ?? [];
  if (elements.length === 0) {
    return {};
  }

  const targetName = normalizeName(place.name);
  const scored = elements
    .map((el: any) => {
      const tags = el.tags ?? {};
      const lat = Number(el.lat ?? el.center?.lat);
      const lon = Number(el.lon ?? el.center?.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        return null;
      }

      const dist = haversineDistanceMeters(
        { latitude: place.latitude, longitude: place.longitude },
        { latitude: lat, longitude: lon }
      );

      const nameScore = normalizeName(tags.name) === targetName ? 0 : 1;
      return { tags, dist, nameScore };
    })
    .filter(Boolean)
    .sort((a: any, b: any) => a.nameScore - b.nameScore || a.dist - b.dist);

  const best = scored[0]?.tags;
  if (!best) {
    return {};
  }

  const website = best.website ?? best["contact:website"];
  const openingHoursRaw = best.opening_hours;
  const cuisine = best.cuisine ? String(best.cuisine).replace(/;/g, ", ") : undefined;

  const parsedAddress = composeOsmAddress(best);

  return {
    rating: parseOsmRating(best),
    priceLevel: parseOsmPriceLevel(best),
    priceRangeLabel: best["price_range"] ? String(best["price_range"]) : undefined,
    openingHoursText: openingHoursRaw ? [String(openingHoursRaw)] : undefined,
    menuUrl: website ? String(website) : undefined,
    address: parsedAddress ?? (cuisine ? `Cuisine: ${cuisine}` : undefined),
    // If we do not have ratings total from OSM, leave undefined.
    userRatingsTotal: undefined
  };
}

export async function enrichPlaceDetails(place: Place): Promise<Partial<Place>> {
  if (place.source === "google") {
    return enrichGooglePlaceDetails(place.id);
  }

  try {
    return await enrichOsmPlaceDetails(place);
  } catch (error) {
    console.warn("OSM place enrichment failed:", describeAxiosError(error));
    return {};
  }
}
