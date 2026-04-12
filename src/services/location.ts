import * as Location from "expo-location";

import type { Coordinates } from "../types";

export async function requestLocationPermissions(): Promise<void> {
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== "granted") {
    throw new Error("Location permission was denied.");
  }
}

export async function getCurrentLocation(): Promise<Coordinates> {
  await requestLocationPermissions();
  
  const location = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.Balanced
  });

  return {
    latitude: location.coords.latitude,
    longitude: location.coords.longitude
  };
}

export async function watchCurrentLocation(
  onChange: (coords: Coordinates) => void
): Promise<Location.LocationSubscription> {
  await requestLocationPermissions();

  return await Location.watchPositionAsync(
    {
      accuracy: Location.Accuracy.BestForNavigation,
      distanceInterval: 15,
      timeInterval: 10000
    },
    (location) => {
      onChange({
        latitude: location.coords.latitude,
        longitude: location.coords.longitude
      });
    }
  );
}
