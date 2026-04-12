import type { ExpoConfig } from "expo/config";

const googleMapsApiKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;

const config: ExpoConfig = {
  name: "FoodTrip",
  slug: "foodtrip",
  version: "1.0.2",
  orientation: "portrait",
  userInterfaceStyle: "light",
  icon: "./assets/icon.png",
  ios: {
    supportsTablet: true,
    infoPlist: {
      NSLocationWhenInUseUsageDescription:
        "FoodTrip uses your location to show nearby food places and travel times."
    },
    config: googleMapsApiKey
      ? {
          googleMapsApiKey
        }
      : undefined
  },
  android: {
    permissions: ["ACCESS_FINE_LOCATION", "ACCESS_COARSE_LOCATION"],
    package: "com.foodtrip.app",
    adaptiveIcon: {
      foregroundImage: "./assets/adaptive-icon.png",
      backgroundColor: "#52a447"
    },
    config: googleMapsApiKey
      ? {
          googleMaps: {
            apiKey: googleMapsApiKey
          }
        }
      : undefined
  },
  plugins: ["expo-location", "expo-font"]
};

export default config;
