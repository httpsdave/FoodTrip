import axios from "axios";

import { env } from "../config/env";
import { estimateDurationMinutes } from "./distance";
import type { Coordinates, RouteEstimate, TravelMode } from "../types";

const GEOAPIFY_MODE_MAP: Record<TravelMode, string> = {
  walking: "walk",
  bicycling: "bicycle",
  motorcycle: "motorcycle",
  car: "drive"
};

export async function estimateRoute(
  from: Coordinates,
  to: Coordinates,
  mode: TravelMode,
  fallbackDistanceMeters: number
): Promise<RouteEstimate> {
  const profile = GEOAPIFY_MODE_MAP[mode] || "walk";
  
  if (!env.hasGeoapify) {
    return {
      mode,
      distanceMeters: fallbackDistanceMeters,
      durationMinutes: estimateDurationMinutes(mode, fallbackDistanceMeters)
    };
  }

  const url = `https://api.geoapify.com/v1/routing?waypoints=${from.latitude},${from.longitude}|${to.latitude},${to.longitude}&mode=${profile}&apiKey=${env.GEOAPIFY_API_KEY}`;

  try {
    const response = await axios.get(url, { timeout: 10000 });
    const props = response.data?.features?.[0]?.properties;

    const distanceMeters = Number(props?.distance ?? fallbackDistanceMeters);
    const durationMinutes = Math.max(1, Math.round(Number(props?.time ?? 0) / 60));

    return {
      mode,
      distanceMeters,
      durationMinutes
    };
  } catch (err) {
    return {
      mode,
      distanceMeters: fallbackDistanceMeters,
      durationMinutes: estimateDurationMinutes(mode, fallbackDistanceMeters)
    };
  }
}

export async function getRoutePolyline(
  from: Coordinates,
  to: Coordinates,
  mode: TravelMode
): Promise<Coordinates[]> {
  if (!env.hasGeoapify) {
    throw new Error("Route geometry requires Geoapify API key.");
  }

  const profile = GEOAPIFY_MODE_MAP[mode] || "walk";
  const url = `https://api.geoapify.com/v1/routing?waypoints=${from.latitude},${from.longitude}|${to.latitude},${to.longitude}&mode=${profile}&apiKey=${env.GEOAPIFY_API_KEY}`;

  const response = await axios.get(url, { timeout: 15000 });
  const feature = response.data?.features?.[0];
  const geometry = feature?.geometry;
  
  if (!geometry || !geometry.coordinates) {
    throw new Error("No route geometry returned.");
  }

  // Geoapify routing returns MultiLineString or LineString
  const points: Coordinates[] = [];
  
  if (geometry.type === "MultiLineString") {
    for (const line of geometry.coordinates) {
      for (const pt of line) {
        points.push({ latitude: pt[1], longitude: pt[0] });
      }
    }
  } else if (geometry.type === "LineString") {
    for (const pt of geometry.coordinates) {
      points.push({ latitude: pt[1], longitude: pt[0] });
    }
  }

  return points.filter((point) =>
    Number.isFinite(point.latitude) && Number.isFinite(point.longitude)
  );
}
