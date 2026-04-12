import { memo, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  BackHandler,
  FlatList,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  useWindowDimensions,
  View
} from "react-native";

import { StatusBar } from "expo-status-bar";
import MapView, { Circle, Marker, Polyline } from "react-native-maps";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import {
  Poppins_400Regular,
  Poppins_500Medium,
  Poppins_600SemiBold,
  Poppins_700Bold,
  useFonts
} from "@expo-google-fonts/poppins";

import { haversineDistanceMeters } from "./src/services/distance";
import { getCurrentLocation } from "./src/services/location";
import { enrichGooglePlaceDetails, fetchNearbyPlaces } from "./src/services/places";
import { estimateRoute, getRoutePolyline } from "./src/services/routing";
import type { Coordinates, Place, TravelMode } from "./src/types";

const MODES: TravelMode[] = ["walking", "bicycling", "motorcycle", "car"];
const DEFAULT_RADIUS_METERS = 3500;
const CONFIRM_PREFS_KEY = "foodtrip.confirmations";
const RECENT_SEARCHES_KEY = "foodtrip.recentSearches";
const BOOKMARKS_KEY = "foodtrip.bookmarks";
const FAVORITES_KEY = "foodtrip.favorites";
const SHEET_PEEK = 150;
const SHEET_MIN_TOP = 120;
const SHEET_MAX_TOP_OFFSET = 0.78;
const PLACE_CARD_ESTIMATED_HEIGHT = 122;
const MAX_RECENT_SEARCHES = 8;
const SEARCH_RESULTS_PAGE_SIZE = 15;

const COLORS = {
  primary: "#10B981",
  primaryDark: "#059669",
  text: "#1F2937",
  textMuted: "#6B7280",
  surface: "#FFFFFF",
  surfaceSoft: "#F8F9FA",
  borderSoft: "#E5E7EB",
  danger: "#e74c3c",
  warning: "#F59E0B",
  info: "#2980b9"
} as const;

type ConfirmKey = "refresh" | "logout" | "exit";

type ConfirmModalState = {
  visible: boolean;
  key: ConfirmKey;
  title: string;
  message: string;
  skipOptionAllowed: boolean;
  onConfirm: (() => void) | null;
};

type RecentSearchItem = {
  placeId: string;
  name: string;
  address?: string;
  searchedAt: string;
};

function formatDistance(distanceMeters: number): string {
  if (distanceMeters <= 500) {
    return `${Math.round(distanceMeters)} m`;
  }

  const kmTruncated = Math.floor((distanceMeters / 1000) * 100) / 100;
  return `${kmTruncated.toFixed(2)} km`;
}

function modeIcon(mode: TravelMode): keyof typeof MaterialCommunityIcons.glyphMap {
  if (mode === "walking") return "walk";
  if (mode === "bicycling") return "bike";
  if (mode === "motorcycle") return "motorbike";
  return "car";
}

function getOpenStatusText(place: Place): string {
  if (place.openingNow === true) {
    return "Open now";
  }

  if (place.openingNow === false) {
    return "Closed now";
  }

  if (place.openingHoursText?.length) {
    return `Hours: ${place.openingHoursText[0]}`;
  }

  return "Hours unavailable";
}

function formatPriceLevel(level?: number): string {
  if (!Number.isFinite(level)) {
    return "Price unknown";
  }

  const normalized = Math.max(0, Math.min(4, Math.round(level as number)));
  if (normalized === 0) {
    return "Free/unknown pricing";
  }

  return "$".repeat(normalized);
}

function formatTimeAgo(isoDate: string): string {
  const then = new Date(isoDate).getTime();
  if (!Number.isFinite(then)) {
    return "just now";
  }

  const diffSeconds = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (diffSeconds < 60) return "just now";
  if (diffSeconds < 3600) return `${Math.floor(diffSeconds / 60)}m ago`;
  if (diffSeconds < 86400) return `${Math.floor(diffSeconds / 3600)}h ago`;
  return `${Math.floor(diffSeconds / 86400)}d ago`;
}

type PlaceCardProps = {
  item: Place;
  isSelected: boolean;
  isFavorite: boolean;
  isBookmarked: boolean;
  onPress: (place: Place) => void;
  onToggleFavorite: (place: Place) => void;
  onToggleBookmark: (place: Place) => void;
};

const PlaceCard = memo(function PlaceCard({ item, isSelected, isFavorite, isBookmarked, onPress, onToggleFavorite, onToggleBookmark }: PlaceCardProps) {
  return (
    <Pressable
      style={[styles.card, isSelected ? styles.cardSelected : undefined]}
      onPress={() => onPress(item)}
    >
      <View style={styles.cardHeader}>
        <Text style={[styles.cardTitle, { flex: 1 }]}>{item.name}</Text>
        <View style={styles.cardActions}>
          <Pressable onPress={() => onToggleFavorite(item)} style={styles.actionIcon}>
            <MaterialCommunityIcons name={isFavorite ? "heart" : "heart-outline"} size={22} color={isFavorite ? "#e74c3c" : "#111"} />
          </Pressable>
          <Pressable onPress={() => onToggleBookmark(item)} style={styles.actionIcon}>
            <MaterialCommunityIcons name={isBookmarked ? "bookmark" : "bookmark-outline"} size={22} color={isBookmarked ? COLORS.warning : "#111"} />
          </Pressable>
        </View>
      </View>
      <View style={styles.metaRow}>
        <MaterialCommunityIcons name="map-marker-distance" size={16} color="#111" />
        <Text style={styles.cardMeta}>{formatDistance(item.distanceMeters ?? 0)} away</Text>
      </View>
      <View style={styles.metaRow}>
        <MaterialCommunityIcons name="star-outline" size={16} color="#111" />
        <Text style={styles.cardMeta}>
          {item.rating ? `Rating ${item.rating} (${item.userRatingsTotal ?? 0})` : "No rating available"}
        </Text>
      </View>
      <View style={styles.metaRow}>
        <MaterialCommunityIcons name="clock-time-five-outline" size={16} color="#111" />
        <Text style={styles.cardMeta}>{getOpenStatusText(item)}</Text>
      </View>
      <View style={styles.metaRow}>
        <MaterialCommunityIcons name="cash" size={16} color="#111" />
        <Text style={styles.cardMeta}>{formatPriceLevel(item.priceLevel)}</Text>
      </View>
    </Pressable>
  );
});

export default function App() {
  const [fontsLoaded] = useFonts({
    Poppins_400Regular,
    Poppins_500Medium,
    Poppins_600SemiBold,
    Poppins_700Bold
  });
  const { height: screenHeight } = useWindowDimensions();

  const [userLocation, setUserLocation] = useState<Coordinates | null>(null);
  const [places, setPlaces] = useState<Place[]>([]);
  const [selectedPlace, setSelectedPlace] = useState<Place | null>(null);
  const [routeMode, setRouteMode] = useState<TravelMode>("motorcycle");
  const [routePath, setRoutePath] = useState<Coordinates[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [currentTab, setCurrentTab] = useState<"food" | "search" | "account" | "favorites">("food");
  const [searchResultLimit, setSearchResultLimit] = useState(SEARCH_RESULTS_PAGE_SIZE);

  useEffect(() => {
    setSearchResultLimit(SEARCH_RESULTS_PAGE_SIZE);
  }, [searchQuery]);
  const [recentSearches, setRecentSearches] = useState<RecentSearchItem[]>([]);
  const [bookmarks, setBookmarks] = useState<Place[]>([]);
  const [favorites, setFavorites] = useState<Place[]>([]);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [radiusInput, setRadiusInput] = useState(String(DEFAULT_RADIUS_METERS));
  const [radiusMeters, setRadiusMeters] = useState(DEFAULT_RADIUS_METERS);
  const [showRadiusPicker, setShowRadiusPicker] = useState(false);
  const [mapFullscreen, setMapFullscreen] = useState(false);
  const [confirmPrefs, setConfirmPrefs] = useState<Record<ConfirmKey, boolean>>({
    refresh: false,
    logout: false,
    exit: false
  });
  const [confirmSkipChecked, setConfirmSkipChecked] = useState(false);
  const [confirmModal, setConfirmModal] = useState<ConfirmModalState>({
    visible: false,
    key: "refresh",
    title: "Confirm action",
    message: "Continue?",
    skipOptionAllowed: false,
    onConfirm: null
  });

  const toastAnim = useRef(new Animated.Value(0)).current;
  const mapRef = useRef<MapView | null>(null);
  const sheetListRef = useRef<FlatList>(null);

  const dynamicMaxSheetTop = selectedPlace ? screenHeight * 0.55 : Math.max(screenHeight * 0.65, SHEET_PEEK);
  const minSheetTop = Math.min(SHEET_MIN_TOP, screenHeight * 0.15);
  const sheetTop = useRef(new Animated.Value(dynamicMaxSheetTop)).current;
  const sheetTopValue = useRef(dynamicMaxSheetTop);

  useEffect(() => {
    const listenerId = sheetTop.addListener(({ value }) => {
      sheetTopValue.current = value;
    });

    return () => {
      sheetTop.removeListener(listenerId);
    };
  }, [sheetTop]);

  useEffect(() => {
    void loadConfirmPrefs();
    void loadRecentSearches();
    void loadBookmarksAndFavorites();
    void bootstrap();
  }, []);

  useEffect(() => {
    if (!selectedPlace || !userLocation) return;

    void buildRoutePath(selectedPlace, routeMode);
  }, [routeMode]);

  // Ensure we snap the sheet to the correct resting position when selectedPlace or related variables change
  useEffect(() => {
    Animated.spring(sheetTop, {
      toValue: dynamicMaxSheetTop,
      useNativeDriver: true,
      speed: 16,
      bounciness: 2
    }).start();
  }, [dynamicMaxSheetTop, sheetTop]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_evt, gestureState) => Math.abs(gestureState.dy) > 5,
        onPanResponderGrant: () => {
          sheetTop.stopAnimation((value: number) => {
            sheetTopValue.current = value;
          });
        },
        onPanResponderMove: (_evt, gestureState) => {
          let expectedTop = sheetTopValue.current + gestureState.dy;
          const currentMaxTop = dynamicMaxSheetTop;
          const nextTop = Math.min(currentMaxTop, Math.max(minSheetTop, expectedTop));
          sheetTop.setValue(nextTop);
        },
        onPanResponderRelease: (_evt, gestureState) => {
          const middle = (dynamicMaxSheetTop + minSheetTop) / 2;
          const currentExpectedTop = sheetTopValue.current + gestureState.dy;
          let destination = currentExpectedTop < middle ? minSheetTop : dynamicMaxSheetTop;

          if (gestureState.vy < -0.3) {
            destination = minSheetTop; // Swiped up fast
          } else if (gestureState.vy > 0.3) {
            destination = dynamicMaxSheetTop; // Swiped down fast
          }

          Animated.spring(sheetTop, {
            toValue: destination,
            useNativeDriver: true,
            speed: 20,
            bounciness: 2
          }).start();
        }
      }),
    [dynamicMaxSheetTop, minSheetTop, sheetTop]
  );

  function showToast(message: string) {
    setToastMessage(message);
    toastAnim.setValue(0);
    Animated.sequence([
      Animated.timing(toastAnim, { toValue: 1, duration: 180, useNativeDriver: true }),
      Animated.delay(1100),
      Animated.timing(toastAnim, { toValue: 0, duration: 220, useNativeDriver: true })
    ]).start(() => setToastMessage(null));
  }

  async function loadConfirmPrefs() {
    const stored = await AsyncStorage.getItem(CONFIRM_PREFS_KEY);
    if (!stored) return;

    try {
      const parsed = JSON.parse(stored) as Record<ConfirmKey, boolean>;
      setConfirmPrefs((prev) => ({ ...prev, ...parsed }));
    } catch {
      // Keep defaults if parsing fails.
    }
  }

  async function loadBookmarksAndFavorites() {
    try {
      const storedFavs = await AsyncStorage.getItem(FAVORITES_KEY);
      if (storedFavs) setFavorites(JSON.parse(storedFavs));
      const storedBooks = await AsyncStorage.getItem(BOOKMARKS_KEY);
      if (storedBooks) setBookmarks(JSON.parse(storedBooks));
    } catch {
      // Ignore
    }
  }

  async function toggleFavorite(place: Place) {
    const isFav = favorites.find(f => f.id === place.id);
    let next: Place[];
    if (isFav) {
      next = favorites.filter(f => f.id !== place.id);
      showToast("Removed from favorites");
    } else {
      next = [...favorites, place];
      showToast("Added to favorites");
    }
    setFavorites(next);
    await AsyncStorage.setItem(FAVORITES_KEY, JSON.stringify(next));
  }

  async function toggleBookmark(place: Place) {
    const isBook = bookmarks.find(b => b.id === place.id);
    let next: Place[];
    if (isBook) {
      next = bookmarks.filter(b => b.id !== place.id);
      showToast("Removed from bookmarks");
    } else {
      next = [...bookmarks, place];
      showToast("Added to bookmarks");
    }
    setBookmarks(next);
    await AsyncStorage.setItem(BOOKMARKS_KEY, JSON.stringify(next));
  }

  async function loadRecentSearches() {
    const stored = await AsyncStorage.getItem(RECENT_SEARCHES_KEY);
    if (!stored) return;

    try {
      const parsed = JSON.parse(stored) as RecentSearchItem[];
      if (Array.isArray(parsed)) {
        setRecentSearches(parsed.slice(0, MAX_RECENT_SEARCHES));
      }
    } catch {
      // Ignore malformed cache and continue with empty history.
    }
  }

  async function persistRecentSearches(next: RecentSearchItem[]) {
    setRecentSearches(next);
    await AsyncStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(next));
  }

  async function addRecentSearch(place: Place) {
    const next: RecentSearchItem[] = [
      {
        placeId: place.id,
        name: place.name,
        address: place.address,
        searchedAt: new Date().toISOString()
      },
      ...recentSearches.filter((item) => item.placeId !== place.id)
    ].slice(0, MAX_RECENT_SEARCHES);

    await persistRecentSearches(next);
  }

  async function persistConfirmPrefs(next: Record<ConfirmKey, boolean>) {
    setConfirmPrefs(next);
    await AsyncStorage.setItem(CONFIRM_PREFS_KEY, JSON.stringify(next));
  }

  function requestConfirm(
    key: ConfirmKey,
    title: string,
    message: string,
    onConfirm: () => void,
    skipOptionAllowed = true
  ) {
    if (confirmPrefs[key]) {
      onConfirm();
      return;
    }

    setConfirmSkipChecked(false);
    setConfirmModal({
      visible: true,
      key,
      title,
      message,
      skipOptionAllowed,
      onConfirm
    });
  }

  async function confirmAction() {
    const action = confirmModal.onConfirm;
    const key = confirmModal.key;

    setConfirmModal((prev) => ({ ...prev, visible: false, onConfirm: null }));

    if (confirmSkipChecked && confirmModal.skipOptionAllowed) {
      const nextPrefs = { ...confirmPrefs, [key]: true };
      await persistConfirmPrefs(nextPrefs);
    }

    action?.();
  }

  async function bootstrap() {
    try {
      setIsLoading(true);
      const current = await getCurrentLocation();
      setUserLocation(current);

      const nearby = await fetchNearbyPlaces(current, radiusMeters);
      setPlaces(nearby);
      setError(null);
      showToast("Nearby places updated");
    } catch (err: any) {
      setError(
        err?.message
          ? `Failed to load nearby places: ${err.message}`
          : "Failed to load nearby places. Please check internet and try again."
      );
    } finally {
      setIsLoading(false);
    }
  }

  async function refreshPlaces(nextRadiusMeters = radiusMeters) {
    if (!userLocation) return;

    try {
      setIsRefreshing(true);
      setError(null);
      const nearby = await fetchNearbyPlaces(userLocation, nextRadiusMeters);
      setPlaces(nearby);

      setSelectedPlace(null);
      setRoutePath([]);

      showToast("Places refreshed");
    } catch (err: any) {
      setError(
        err?.message
          ? `Failed to refresh places: ${err.message}`
          : "Failed to refresh places. Please check internet and try again."
      );
    } finally {
      setIsRefreshing(false);
    }
  }

  async function buildRoutePath(place: Place, mode: TravelMode) {
    if (!userLocation) return;

    try {
      const path = await getRoutePolyline(
        userLocation,
        { latitude: place.latitude, longitude: place.longitude },
        mode
      );

      if (path.length > 1) {
        setRoutePath(path);
      }
    } catch (routeErr) {
      console.warn("Failed to retrieve true route geometry:", routeErr);
      setRoutePath([
        { latitude: userLocation.latitude, longitude: userLocation.longitude },
        { latitude: place.latitude, longitude: place.longitude }
      ]);
    }
  }

  function applyRadius() {
    const parsed = Number(radiusInput);
    if (Number.isNaN(parsed) || parsed < 500 || parsed > 15000) {
      Alert.alert("Invalid radius", "Use a radius between 500 and 15,000 meters.");
      return;
    }

    requestConfirm(
      "refresh",
      "Apply new radius?",
      `Reload places within ${parsed} meters?`,
      () => {
        setRadiusMeters(parsed);
        setShowRadiusPicker(false);
        void refreshPlaces(parsed);
        showToast(`Radius set to ${parsed} m`);
      }
    );
  }

  async function onSelectPlace(place: Place) {
    if (!userLocation) return;

    // Instantly show selection to keep UI snappy
    setSelectedPlace(place);
    sheetListRef.current?.scrollToOffset({ offset: 0, animated: true });
    void addRecentSearch(place);
    setRoutePath([]); // Clear previous route to avoid straight-line flash

    const midLatitude = (userLocation.latitude + place.latitude) / 2;
    const midLongitude = (userLocation.longitude + place.longitude) / 2;
    const latDelta = Math.max(0.005, Math.abs(userLocation.latitude - place.latitude) * 2.6);
    const lonDelta = Math.max(0.005, Math.abs(userLocation.longitude - place.longitude) * 2.6);

    mapRef.current?.animateToRegion(
      {
        latitude: midLatitude,
        longitude: midLongitude,
        latitudeDelta: latDelta,
        longitudeDelta: lonDelta
      },
      400
    );

    // Move the sheet down to the minimal peek state so the map is fully visible immediately
    Animated.spring(sheetTop, { toValue: dynamicMaxSheetTop, useNativeDriver: true }).start();

    // Async operations run in the background after UI responds
    const baseDistance = haversineDistanceMeters(userLocation, {
      latitude: place.latitude,
      longitude: place.longitude
    });

    const detailsPromise = place.source === "google" ? enrichGooglePlaceDetails(place.id) : Promise.resolve({});

    const estimatesPromise = Promise.all(
      MODES.map((mode) =>
        estimateRoute(
          userLocation,
          { latitude: place.latitude, longitude: place.longitude },
          mode,
          baseDistance
        )
      )
    );

    const [details, estimates] = await Promise.all([detailsPromise, estimatesPromise]);

    const etaByMode = estimates.reduce<Record<TravelMode, number>>((acc, estimate) => {
      acc[estimate.mode] = estimate.durationMinutes;
      return acc;
    }, {} as Record<TravelMode, number>);

    const mergedPlace: Place = {
      ...place,
      ...details,
      distanceMeters:
        estimates.find((e) => e.mode === routeMode)?.distanceMeters ?? estimates[0]?.distanceMeters ?? baseDistance,
      etaByMode
    };

    // Update with enriched details gracefully
    setSelectedPlace(mergedPlace);

    // Finally fetch and draw the actual road route path
    await buildRoutePath(mergedPlace, routeMode);
  }

  function performLogout() {
    setIsAuthenticated(false);
    showToast("Logged out (placeholder)");
  }

  function performExit() {
    if (Platform.OS === "android") {
      Alert.alert("Exit app", "Closing FoodTrip now.", [
        {
          text: "OK",
          onPress: () => BackHandler.exitApp()
        }
      ]);
      return;
    }

    Alert.alert("Exit not supported", "Manual close is required on iOS.");
  }

  const filteredPlaces = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) {
      return places;
    }

    return places.filter((place) => {
      const name = place.name.toLowerCase();
      const address = (place.address ?? "").toLowerCase();
      return name.includes(query) || address.includes(query);
    });
  }, [places, searchQuery]);

  const favoriteIds = useMemo(() => new Set(favorites.map((item) => item.id)), [favorites]);
  const bookmarkIds = useMemo(() => new Set(bookmarks.map((item) => item.id)), [bookmarks]);
  const placesById = useMemo(() => new Map(places.map((item) => [item.id, item])), [places]);

  const paginatedFilteredPlaces = useMemo(
    () => filteredPlaces.slice(0, searchResultLimit),
    [filteredPlaces, searchResultLimit]
  );

  const canLoadMoreSearchResults = searchResultLimit < filteredPlaces.length;

  const region = useMemo(() => {
    if (!userLocation) return undefined;

    // By default, show a tight delta so the map starts out zoomed in near the user.
    const delta = 0.001; // ~111 meters delta
    return {
      latitude: userLocation.latitude,
      longitude: userLocation.longitude,
      latitudeDelta: delta,
      longitudeDelta: delta
    };
  }, [userLocation]);

  const mapStyle = useMemo(
    () => [
      styles.map,
      mapFullscreen ? styles.mapFull : { height: Math.max(460, screenHeight * 0.68) },
      { display: currentTab === "food" ? ("flex" as const) : ("none" as const) }
    ],
    [currentTab, mapFullscreen, screenHeight]
  );

  if (!fontsLoaded || isLoading || !region || !userLocation) {
    return (
      <SafeAreaProvider>
        <View style={[styles.center, { backgroundColor: COLORS.primary }]}>
          <MaterialCommunityIcons name="map-marker-path" size={80} color="#FFF" />
          <Text style={[styles.title, { color: "#FFF", fontSize: 44, marginTop: 12 }]}>FoodTrip</Text>
          <ActivityIndicator size="large" color="#FFF" style={{ marginTop: 32 }} />
          <Text style={[styles.caption, { color: "rgba(255,255,255,0.8)" }]}>Finding good food near you</Text>
        </View>
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.container} edges={["top"]}>
        <StatusBar style="dark" />

        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        <View style={styles.mainContent}>
          <View style={[styles.foodPage, { display: currentTab === "food" ? "flex" : "none" }]}>
            {!mapFullscreen ? (
              <View style={styles.headerContainer} pointerEvents="box-none">
                <View style={styles.headerRow}>
                  <View style={[styles.iconButton, { width: 50, height: 50, borderRadius: 25 }]}>
                    <MaterialCommunityIcons name="map-marker-path" size={50} color={COLORS.primary} />
                  </View>
                  <View style={styles.headerTextWrap}>
                    <Text style={styles.title}>FoodTrip</Text>
                    <Text style={styles.subtitle}>Finding good food near you</Text>
                  </View>
                    <Pressable
                      style={styles.iconButton}
                      onPress={() => {
                        setCurrentTab("favorites");
                      }}
                    >
                      <MaterialCommunityIcons name="heart-outline" size={24} color={COLORS.primary} />
                    </Pressable>
                </View>
              </View>
            ) : null}

            <View style={mapStyle} pointerEvents={currentTab === "food" ? "auto" : "none"}>
          <MapView
            ref={mapRef}
            style={StyleSheet.absoluteFillObject}
            initialRegion={region}
            onMapReady={() => {
              if (region) {
                mapRef.current?.animateToRegion(region, 100);
              }
            }}
            scrollEnabled={currentTab === "food"}
            onPress={() => {
              setShowRadiusPicker(false);
              setSelectedPlace(null);
            }}
            customMapStyle={[
              {
                featureType: "poi",
                elementType: "labels",
                stylers: [{ visibility: "off" }]
              },
              {
                featureType: "transit",
                elementType: "labels",
                stylers: [{ visibility: "off" }]
              }
            ]}
          >
            <Marker coordinate={userLocation} title="You" pinColor={COLORS.primary} />

            <Circle
              center={userLocation}
              radius={radiusMeters}
              strokeColor={showRadiusPicker ? "rgba(16,185,129,0.9)" : "rgba(16,185,129,0.65)"}
              fillColor={showRadiusPicker ? "rgba(16,185,129,0.14)" : "rgba(16,185,129,0.08)"}
              strokeWidth={showRadiusPicker ? 3 : 2}
            />

            {places.map((place) => {
              if (selectedPlace && selectedPlace.id !== place.id) {
                return null;
              }

              const isFav = favoriteIds.has(place.id);
              const isBook = bookmarkIds.has(place.id);
              const isSelected = selectedPlace?.id === place.id;
              
              const pinColor = isSelected ? COLORS.primary : isFav ? COLORS.danger : isBook ? COLORS.warning : "red";
              
              return (
                <Marker
                  key={`${place.id}-${isSelected ? 'sel' : isFav ? 'fav' : isBook ? 'book' : 'normal'}`}
                  coordinate={{ latitude: place.latitude, longitude: place.longitude }}
                  title={place.name}
                  description={place.address}
                  onPress={() => void onSelectPlace(place)}
                  pinColor={pinColor}
                />
              );
            })}

            {routePath.length > 1 ? (
              <Polyline coordinates={routePath} strokeColor={COLORS.primary} strokeWidth={8} />
            ) : null}
          </MapView>

          <View style={styles.mapControls}>
            <Pressable style={styles.controlButton} onPress={() => setShowRadiusPicker((prev) => !prev)}>
              <MaterialCommunityIcons name="crosshairs-gps" size={20} color="#000" />
            </Pressable>
            <Pressable
              style={styles.controlButton}
              onPress={() =>
                requestConfirm("refresh", "Refresh nearby places?", "Fetch latest nearby places now?", () => {
                  void refreshPlaces();
                })
              }
            >
              <MaterialCommunityIcons name="refresh" size={20} color="#000" />
            </Pressable>
            <Pressable
              style={styles.controlButton}
              onPress={() => {
                const next = !mapFullscreen;
                setMapFullscreen(next);
              }}
            >
              <MaterialCommunityIcons name={mapFullscreen ? "fullscreen-exit" : "fullscreen"} size={20} color="#000" />
            </Pressable>
            <Pressable
              style={styles.controlButton}
              onPress={() => {
                mapRef.current?.getCamera().then((cam) => {
                  if (cam && cam.zoom) {
                    mapRef.current?.animateCamera({ zoom: cam.zoom + 1 });
                  }
                });
              }}
            >
              <MaterialCommunityIcons name="plus" size={20} color="#000" />
            </Pressable>
            <Pressable
              style={styles.controlButton}
              onPress={() => {
                mapRef.current?.getCamera().then((cam) => {
                  if (cam && cam.zoom) {
                    mapRef.current?.animateCamera({ zoom: cam.zoom - 1 });
                  }
                });
              }}
            >
              <MaterialCommunityIcons name="minus" size={20} color="#000" />
            </Pressable>
          </View>

          {showRadiusPicker ? (
            <View 
              style={styles.radiusPanel}
              onStartShouldSetResponder={() => true}
              onTouchStart={(e) => e.stopPropagation()}
            >
              <Text style={styles.radiusPanelTitle}>Search radius</Text>
              <TextInput
                value={radiusInput}
                onChangeText={setRadiusInput}
                keyboardType="number-pad"
                style={styles.radiusInput}
                placeholder="3500"
                placeholderTextColor="#555"
              />
              <View style={styles.radiusPresetRow}>
                {[1000, 2500, 5000, 10000].map((r) => (
                  <Pressable key={r} style={styles.presetChip} onPress={() => setRadiusInput(String(r))}>
                    <Text style={styles.presetChipText}>{r}m</Text>
                  </Pressable>
                ))}
              </View>
              <Pressable style={styles.applyRadiusButton} onPress={applyRadius}>
                <Text style={styles.applyRadiusButtonText}>Apply radius</Text>
              </Pressable>
            </View>
          ) : null}
            </View>

            <Animated.View
          pointerEvents={currentTab === "food" ? "auto" : "none"}
          style={[
            styles.sheet,
            {
              top: 0,
              height: screenHeight + 200,
              transform: [{ translateY: sheetTop }],
              display: currentTab === "food" ? "flex" : "none"
            }
          ]}
        >
          <View {...panResponder.panHandlers} style={{ backgroundColor: "transparent" }}>
            <View style={styles.sheetHandleWrap}>
              <View style={styles.sheetHandle} />
            </View>

            <View style={styles.sheetHeaderRow}>
              <Text style={styles.sheetTitle}>Nearby places ({filteredPlaces.length})</Text>
              <Text style={styles.sheetSub}>{formatDistance(radiusMeters)} radius</Text>
            </View>
          </View>

          <FlatList
            ref={sheetListRef}
            data={filteredPlaces}
            keyExtractor={(item) => item.id}
            refreshing={isRefreshing}
            onRefresh={() => void refreshPlaces()}
            removeClippedSubviews={true}
            initialNumToRender={10}
            maxToRenderPerBatch={10}
            updateCellsBatchingPeriod={50}
            windowSize={8}
            contentContainerStyle={styles.listContent}
            renderItem={({ item }) => (
              <PlaceCard
                item={item}
                isSelected={selectedPlace?.id === item.id}
                isFavorite={favoriteIds.has(item.id)}
                isBookmarked={bookmarkIds.has(item.id)}
                onPress={(place) => void onSelectPlace(place)}
                onToggleFavorite={(place) => void toggleFavorite(place)}
                onToggleBookmark={(place) => void toggleBookmark(place)}
              />
            )}
            ListHeaderComponent={
              <>
                {selectedPlace ? (
                  <View style={styles.details}>
                    <Text style={styles.detailsTitle}>{selectedPlace.name}</Text>
                    <Text style={styles.detailsTextMuted}>{selectedPlace.address ?? "Address unavailable"}</Text>
                    <Text style={styles.detailsTextStrong}>
                      Distance: {formatDistance(selectedPlace.distanceMeters ?? 0)}
                    </Text>
                    <Text style={styles.detailsTextMuted}>Price: {formatPriceLevel(selectedPlace.priceLevel)}</Text>
                    <View style={styles.etaGrid}>
                      {MODES.map((mode) => (
                        <Pressable
                          key={mode}
                          style={[styles.etaPill, routeMode === mode ? styles.etaPillActive : undefined]}
                          onPress={() => {
                            setRouteMode(mode);
                            showToast(`Route mode: ${mode}`);
                          }}
                        >
                          <MaterialCommunityIcons name={modeIcon(mode)} size={16} color="#000" />
                          <Text style={styles.etaText}>{selectedPlace.etaByMode?.[mode] ?? "-"} min</Text>
                        </Pressable>
                      ))}
                    </View>
                    <Text style={styles.detailsTextMuted}>{getOpenStatusText(selectedPlace)}</Text>
                    <Text style={styles.detailsTextMuted}>Menu/Website: {selectedPlace.menuUrl ?? "Not available"}</Text>
                  </View>
                ) : null}
              </>
            }
            ListEmptyComponent={
              <View style={styles.emptySearchWrap}>
                <Text style={styles.emptySearchTitle}>No matching places</Text>
                <Text style={styles.emptySearchMeta}>Try a different keyword or refresh nearby places.</Text>
              </View>
            }
          />
            </Animated.View>
          </View>

          <View style={[styles.searchPage, { display: currentTab === "search" ? "flex" : "none" }]}>
            <View style={styles.searchPageHeader}>
              <Text style={styles.searchPageTitle}>Search</Text>
              <Text style={styles.searchPageSubtitle}>Find places by name or address</Text>
            </View>

            <View style={styles.searchPageInputWrap}>
              <MaterialCommunityIcons name="magnify" size={20} color={COLORS.textMuted} />
              <TextInput
                value={searchQuery}
                onChangeText={setSearchQuery}
                placeholder="Search food, cafe, bakery..."
                placeholderTextColor={COLORS.textMuted}
                style={styles.searchInput}
              />
              {searchQuery ? (
                <Pressable onPress={() => setSearchQuery("")}>
                  <MaterialCommunityIcons name="close-circle-outline" size={18} color={COLORS.textMuted} />
                </Pressable>
              ) : null}
            </View>

            {searchQuery.trim().length > 0 ? (
              <FlatList
                data={paginatedFilteredPlaces}
                onEndReached={() => {
                  if (!canLoadMoreSearchResults) return;
                  setSearchResultLimit((prev) => prev + SEARCH_RESULTS_PAGE_SIZE);
                }}
                onEndReachedThreshold={0.5}
                keyExtractor={(item) => `search-${item.id}`}
                contentContainerStyle={styles.searchPageList}
                removeClippedSubviews={true}
                initialNumToRender={10}
                maxToRenderPerBatch={10}
                updateCellsBatchingPeriod={50}
                windowSize={8}
                renderItem={({ item }) => (
                  <Pressable
                    style={styles.searchOverlayItem}
                    onPress={() => {
                      setSearchQuery("");
                      setCurrentTab("food");
                      void onSelectPlace(item);
                    }}
                  >
                    <View style={styles.searchOverlayLeft}>
                      <MaterialCommunityIcons name="silverware-fork-knife" size={16} color={COLORS.textMuted} />
                      <View style={styles.searchOverlayTextWrap}>
                        <Text style={styles.searchOverlayName}>{item.name}</Text>
                        <Text style={styles.searchOverlayMeta}>{item.address ?? "Address unavailable"}</Text>
                      </View>
                    </View>
                    <Text style={styles.searchOverlayDistance}>{formatDistance(item.distanceMeters ?? 0)}</Text>
                  </Pressable>
                )}
                ListEmptyComponent={
                  <View style={styles.emptySearchWrap}>
                    <Text style={styles.emptySearchTitle}>No matching places</Text>
                    <Text style={styles.emptySearchMeta}>Try a different keyword.</Text>
                  </View>
                }
                ListFooterComponent={
                  canLoadMoreSearchResults ? (
                    <View style={styles.searchOverlayFooter}>
                      <ActivityIndicator size="small" color={COLORS.primary} />
                      <Text style={styles.searchOverlayMeta}>
                        Showing {paginatedFilteredPlaces.length} of {filteredPlaces.length}
                      </Text>
                    </View>
                  ) : null
                }
              />
            ) : (
              <FlatList
                data={recentSearches}
                keyExtractor={(item) => `recent-page-${item.placeId}-${item.searchedAt}`}
                contentContainerStyle={styles.searchPageList}
                removeClippedSubviews={true}
                initialNumToRender={10}
                maxToRenderPerBatch={10}
                updateCellsBatchingPeriod={50}
                windowSize={8}
                ListHeaderComponent={<Text style={styles.searchOverlayTitle}>Recent searches</Text>}
                renderItem={({ item }) => {
                  const matched = placesById.get(item.placeId);
                  return (
                    <Pressable
                      style={styles.searchOverlayItem}
                      onPress={() => {
                        if (matched) {
                          setCurrentTab("food");
                          void onSelectPlace(matched);
                        } else {
                          setSearchQuery(item.name);
                        }
                      }}
                    >
                      <View style={styles.searchOverlayLeft}>
                        <MaterialCommunityIcons name="clock-time-four-outline" size={16} color={COLORS.textMuted} />
                        <View style={styles.searchOverlayTextWrap}>
                          <Text style={styles.searchOverlayName}>{item.name}</Text>
                          <Text style={styles.searchOverlayMeta}>{item.address ?? "Address unavailable"}</Text>
                        </View>
                      </View>
                      <Text style={styles.searchOverlayDistance}>{formatTimeAgo(item.searchedAt)}</Text>
                    </Pressable>
                  );
                }}
                ListEmptyComponent={
                  <View style={styles.emptySearchWrap}>
                    <Text style={styles.emptySearchMeta}>No recent searches yet.</Text>
                  </View>
                }
              />
            )}
          </View>

          <View style={[styles.favoritesPage, { display: currentTab === "favorites" ? "flex" : "none" }]}>
            <View style={styles.searchPageHeader}>
              <Text style={styles.searchPageTitle}>Favorites</Text>
              <Text style={styles.searchPageSubtitle}>Places you liked</Text>
            </View>

            <FlatList
              data={favorites}
              keyExtractor={(item) => `fav-page-${item.id}`}
              contentContainerStyle={styles.favoritesList}
              removeClippedSubviews={true}
              initialNumToRender={8}
              maxToRenderPerBatch={8}
              updateCellsBatchingPeriod={50}
              windowSize={6}
              renderItem={({ item }) => (
                <PlaceCard
                  item={item}
                  isSelected={selectedPlace?.id === item.id}
                  isFavorite={favoriteIds.has(item.id)}
                  isBookmarked={bookmarkIds.has(item.id)}
                  onPress={(place) => {
                    setCurrentTab("food");
                    void onSelectPlace(place);
                  }}
                  onToggleFavorite={(place) => void toggleFavorite(place)}
                  onToggleBookmark={(place) => void toggleBookmark(place)}
                />
              )}
              ListEmptyComponent={
                <View style={styles.emptySearchWrap}>
                  <Text style={styles.emptySearchTitle}>No favorites yet</Text>
                  <Text style={styles.emptySearchMeta}>Tap the heart on a place to save it here.</Text>
                </View>
              }
              ListFooterComponent={
                <View style={styles.minorSectionWrap}>
                  <Text style={styles.minorSectionTitle}>Bookmarked</Text>
                  {bookmarks.length === 0 ? (
                    <Text style={styles.minorSectionEmpty}>No bookmarks yet.</Text>
                  ) : (
                    bookmarks.slice(0, 6).map((item) => (
                      <Pressable
                        key={`minor-bookmark-${item.id}`}
                        style={styles.minorItem}
                        onPress={() => {
                          setCurrentTab("food");
                          void onSelectPlace(item);
                        }}
                      >
                        <MaterialCommunityIcons name="bookmark-outline" size={14} color={COLORS.warning} />
                        <View style={styles.minorTextWrap}>
                          <Text style={styles.minorItemTitle}>{item.name}</Text>
                          <Text style={styles.minorItemMeta}>{item.address ?? "Address unavailable"}</Text>
                        </View>
                      </Pressable>
                    ))
                  )}
                </View>
              }
            />
          </View>

          <ScrollView
            style={[styles.accountPage, { display: currentTab === "account" ? "flex" : "none" }]}
            contentContainerStyle={styles.accountPageContent}
            showsVerticalScrollIndicator={false}
          >
            <Text style={styles.settingsTitle}>Account & Settings</Text>

            <View style={styles.settingsRow}>
              <Text style={styles.settingsLabel}>Ask confirmation on refresh</Text>
              <Switch
                value={!confirmPrefs.refresh}
                onValueChange={(value) => {
                  const next = { ...confirmPrefs, refresh: !value };
                  void persistConfirmPrefs(next);
                  showToast("Settings saved");
                }}
              />
            </View>

            <View style={styles.settingsRow}>
              <Text style={styles.settingsLabel}>Ask confirmation on logout</Text>
              <Switch
                value={!confirmPrefs.logout}
                onValueChange={(value) => {
                  const next = { ...confirmPrefs, logout: !value };
                  void persistConfirmPrefs(next);
                  showToast("Settings saved");
                }}
              />
            </View>

            <Text style={styles.settingsSubTitle}>Preferred route mode</Text>
            <View style={styles.settingsModeRow}>
              {MODES.map((mode) => (
                <Pressable
                  key={mode}
                  style={[styles.modeOption, routeMode === mode ? styles.modeOptionActive : undefined]}
                  onPress={() => {
                    setRouteMode(mode);
                    showToast(`Mode set to ${mode}`);
                  }}
                >
                  <MaterialCommunityIcons name={modeIcon(mode)} size={18} color="#000" />
                  <Text style={styles.modeOptionText}>{mode}</Text>
                </Pressable>
              ))}
            </View>

            <View style={styles.accountQuickActions}>
              {!isAuthenticated ? (
                <Pressable
                  style={styles.accountActionButton}
                  onPress={() => {
                    setIsAuthenticated(true);
                    showToast("Signed in (mock)");
                  }}
                >
                  <MaterialCommunityIcons name="account-check-outline" size={18} color={COLORS.primaryDark} />
                  <Text style={styles.accountActionText}>Signup / Login</Text>
                </Pressable>
              ) : (
                <Pressable
                  style={styles.accountActionButton}
                  onPress={() => requestConfirm("logout", "Confirm logout?", "You will be logged out (placeholder action).", performLogout)}
                >
                  <MaterialCommunityIcons name="logout" size={18} color={COLORS.primaryDark} />
                  <Text style={styles.accountActionText}>Logout</Text>
                </Pressable>
              )}

              <Pressable
                style={styles.accountActionButton}
                onPress={() => requestConfirm("exit", "Exit FoodTrip?", "Are you sure you want to close the app?", performExit)}
              >
                <MaterialCommunityIcons name="exit-to-app" size={18} color={COLORS.danger} />
                <Text style={[styles.accountActionText, { color: COLORS.danger }]}>Exit app</Text>
              </Pressable>
            </View>
          </ScrollView>
        </View>

        <Modal
          visible={confirmModal.visible}
          transparent
          animationType="fade"
          onRequestClose={() => setConfirmModal((prev) => ({ ...prev, visible: false }))}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>{confirmModal.title}</Text>
              <Text style={styles.modalMessage}>{confirmModal.message}</Text>

              {confirmModal.skipOptionAllowed ? (
                <View style={styles.skipRow}>
                  <Switch value={confirmSkipChecked} onValueChange={setConfirmSkipChecked} />
                  <Text style={styles.skipText}>Do not show this again for this action</Text>
                </View>
              ) : null}

              <View style={styles.modalButtons}>
                <Pressable
                  style={[styles.modalButton, styles.modalButtonSecondary]}
                  onPress={() => setConfirmModal((prev) => ({ ...prev, visible: false }))}
                >
                  <Text style={styles.modalButtonTextSecondary}>Cancel</Text>
                </Pressable>
                <Pressable
                  style={[styles.modalButton, styles.modalButtonPrimary]}
                  onPress={() => void confirmAction()}
                >
                  <Text style={styles.modalButtonTextPrimary}>Confirm</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>

        {toastMessage ? (
          <Animated.View style={[styles.toast, { opacity: toastAnim }]}>
            <MaterialCommunityIcons name="check-circle-outline" size={16} color="#fff" />
            <Text style={styles.toastText}>{toastMessage}</Text>
          </Animated.View>
        ) : null}

        <View style={styles.bottomNav}>
          <Pressable style={styles.bottomNavItem} onPress={() => setCurrentTab("food")}>
            <MaterialCommunityIcons
              name="silverware-fork-knife"
              size={24}
              color={currentTab === "food" ? COLORS.primary : "#8AA599"}
            />
            <Text style={[styles.bottomNavLabel, currentTab === "food" ? styles.bottomNavLabelActive : null]}>Food</Text>
          </Pressable>

          <Pressable style={styles.bottomNavItem} onPress={() => setCurrentTab("search")}>
            <MaterialCommunityIcons name="magnify" size={24} color={currentTab === "search" ? COLORS.primary : "#8AA599"} />
            <Text style={[styles.bottomNavLabel, currentTab === "search" ? styles.bottomNavLabelActive : null]}>Search</Text>
          </Pressable>

          <Pressable style={styles.bottomNavItem} onPress={() => setCurrentTab("account")}>
            <MaterialCommunityIcons name="account" size={24} color={currentTab === "account" ? COLORS.primary : "#8AA599"} />
            <Text style={[styles.bottomNavLabel, currentTab === "account" ? styles.bottomNavLabelActive : null]}>Account</Text>
          </Pressable>
        </View>

      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.surfaceSoft
  },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: COLORS.surfaceSoft
  },
  caption: {
    marginTop: 10,
    color: COLORS.textMuted,
    fontFamily: "Poppins_400Regular"
  },
  headerContainer: {
    zIndex: 100,
    elevation: 20
  },
  headerContainerExpanded: {
    zIndex: 100,
    elevation: 20
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    paddingBottom: 6,
    backgroundColor: COLORS.surfaceSoft,
    borderBottomLeftRadius: 20,
    borderBottomRightRadius: 20,
  },
  headerTextWrap: {
    flex: 1
  },
  headerSearchWrap: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: 12,
    marginVertical: 8,
    marginBottom: 6,
    minHeight: 44,
    borderRadius: 20,
    paddingHorizontal: 10,
    backgroundColor: COLORS.surface,
    gap: 8,
    zIndex: 101,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.08,
    shadowRadius: 14,
    elevation: 6
  },
  headerSearchWrapConnected: {
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    marginBottom: 0
  },
  title: {
    fontSize: 28,
    color: COLORS.primary,
    fontFamily: "Poppins_700Bold",
    letterSpacing: 0.3,
    lineHeight: 34
  },
  subtitle: {
    color: COLORS.textMuted,
    fontFamily: "Poppins_400Regular",
    fontStyle: "italic",
    marginTop: -2
  },
  iconButton: {
    width: 44,
    height: 44,
    backgroundColor: "transparent",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 22,
  },
  iconButtonDisabled: {
    opacity: 0.55
  },
  map: {
    width: "100%",
    backgroundColor: "#f2f2f2",
    borderBottomLeftRadius: 30,
    borderBottomRightRadius: 30,
    overflow: "hidden"
  },
  mapFull: {
    flex: 1,
    borderRadius: 0
  },
  customMarkerWrap: {
    alignItems: "center",
    justifyContent: "center",
    width: 64,
    height: 64,
    backgroundColor: "transparent",
  },
  defaultMarkerWrap: {
    alignItems: "center",
    justifyContent: "center",
    width: 32,
    height: 32
  },
  mapControls: {
    position: "absolute",
    right: 12,
    top: 12,
    gap: 8
  },
  controlButton: {
    width: 40,
    height: 40,
    backgroundColor: COLORS.surface,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 10,
    elevation: 4
  },
  radiusPanel: {
    position: "absolute",
    left: 12,
    top: 12,
    right: 68,
    backgroundColor: COLORS.surface,
    borderRadius: 20,
    padding: 10
  },
  searchDropdown: {
    marginHorizontal: 12,
    marginTop: 0,
    backgroundColor: COLORS.surface,
    borderBottomLeftRadius: 20,
    borderBottomRightRadius: 20,
    maxHeight: 280,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.1,
    shadowRadius: 18,
    elevation: 8,
    display: "flex",
    flexDirection: "column"
  },
  searchDropdownList: {
    maxHeight: 220,
    flexGrow: 0
  },
  searchOverlayTitle: {
    fontFamily: "Poppins_600SemiBold",
    color: COLORS.text,
    marginBottom: 8,
    paddingHorizontal: 10,
    paddingTop: 8
  },
  searchOverlayItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderTopWidth: 1,
    borderTopColor: COLORS.borderSoft,
    paddingHorizontal: 10,
    paddingVertical: 10,
    gap: 8
  },
  searchDropdownWrapper: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 999,
    elevation: 99
  },
  searchOverlayLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flex: 1,
    paddingRight: 8
  },
  searchOverlayTextWrap: {
    flex: 1
  },
  searchOverlayName: {
    color: COLORS.text,
    fontFamily: "Poppins_500Medium",
    fontSize: 13
  },
  searchOverlayMeta: {
    color: COLORS.textMuted,
    fontFamily: "Poppins_400Regular",
    fontSize: 11
  },
  searchOverlayDistance: {
    color: COLORS.textMuted,
    fontFamily: "Poppins_500Medium",
    fontSize: 11
  },
  searchOverlayEmpty: {
    borderTopWidth: 1,
    borderTopColor: COLORS.borderSoft,
    paddingVertical: 10
  },
  searchOverlayFooter: {
    borderTopWidth: 1,
    borderTopColor: COLORS.borderSoft,
    paddingVertical: 10,
    alignItems: "center",
    gap: 6
  },
  radiusPanelTitle: {
    fontFamily: "Poppins_600SemiBold",
    color: COLORS.text,
    marginBottom: 8
  },
  radiusInput: {
    borderWidth: 1,
    borderColor: COLORS.borderSoft,
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontFamily: "Poppins_500Medium",
    color: COLORS.text,
    backgroundColor: COLORS.surfaceSoft
  },
  radiusPresetRow: {
    flexDirection: "row",
    gap: 6,
    marginTop: 8,
    marginBottom: 8,
    flexWrap: "wrap"
  },
  presetChip: {
    borderWidth: 1,
    borderColor: "rgba(16,185,129,0.28)",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: "rgba(16,185,129,0.08)"
  },
  presetChipText: {
    fontFamily: "Poppins_500Medium",
    color: COLORS.primaryDark,
    fontSize: 12
  },
  applyRadiusButton: {
    backgroundColor: COLORS.primary,
    borderRadius: 14,
    alignItems: "center",
    paddingVertical: 9
  },
  applyRadiusButtonText: {
    color: "#fff",
    fontFamily: "Poppins_600SemiBold"
  },
  errorText: {
    color: COLORS.text,
    backgroundColor: "rgba(245,158,11,0.14)",
    borderWidth: 1,
    borderColor: "rgba(245,158,11,0.35)",
    borderRadius: 14,
    padding: 8,
    marginHorizontal: 12,
    marginBottom: 8,
    fontFamily: "Poppins_400Regular"
  },
  mainContent: {
    flex: 1
  },
  foodPage: {
    flex: 1
  },
  searchPage: {
    flex: 1,
    backgroundColor: COLORS.surfaceSoft,
    paddingHorizontal: 12,
    paddingTop: 8
  },
  searchPageHeader: {
    marginBottom: 8
  },
  searchPageTitle: {
    color: COLORS.text,
    fontFamily: "Poppins_700Bold",
    fontSize: 24
  },
  searchPageSubtitle: {
    color: COLORS.textMuted,
    fontFamily: "Poppins_400Regular"
  },
  searchPageInputWrap: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 44,
    borderRadius: 14,
    backgroundColor: COLORS.surface,
    paddingHorizontal: 10,
    gap: 8,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: COLORS.borderSoft
  },
  searchPageList: {
    paddingBottom: 120
  },
  favoritesPage: {
    flex: 1,
    backgroundColor: COLORS.surfaceSoft,
    paddingHorizontal: 12,
    paddingTop: 8
  },
  favoritesList: {
    paddingBottom: 120
  },
  minorSectionWrap: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: COLORS.borderSoft,
    borderRadius: 14,
    backgroundColor: COLORS.surface,
    padding: 10
  },
  minorSectionTitle: {
    color: COLORS.textMuted,
    fontFamily: "Poppins_600SemiBold",
    marginBottom: 6,
    fontSize: 12,
    textTransform: "uppercase"
  },
  minorSectionEmpty: {
    color: COLORS.textMuted,
    fontFamily: "Poppins_400Regular",
    fontSize: 12
  },
  minorItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: COLORS.borderSoft,
    paddingVertical: 8
  },
  minorTextWrap: {
    flex: 1
  },
  minorItemTitle: {
    color: COLORS.text,
    fontFamily: "Poppins_500Medium",
    fontSize: 12
  },
  minorItemMeta: {
    color: COLORS.textMuted,
    fontFamily: "Poppins_400Regular",
    fontSize: 11
  },
  accountPage: {
    flex: 1,
    backgroundColor: COLORS.surfaceSoft,
    paddingHorizontal: 14,
    paddingTop: 10
  },
  accountPageContent: {
    paddingBottom: 120
  },
  accountQuickActions: {
    marginTop: 14,
    gap: 10
  },
  accountActionButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.borderSoft,
    backgroundColor: COLORS.surface
  },
  accountActionText: {
    color: COLORS.primaryDark,
    fontFamily: "Poppins_600SemiBold"
  },
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    backgroundColor: COLORS.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 12
  },
  sheetHandleWrap: {
    alignItems: "center",
    paddingTop: 8,
    paddingBottom: 6
  },
  sheetHandle: {
    width: 54,
    height: 5,
    borderRadius: 99,
    backgroundColor: "#D1D5DB"
  },
  sheetHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 12,
    marginBottom: 6
  },
  searchInput: {
    flex: 1,
    height: 40,
    color: COLORS.text,
    fontFamily: "Poppins_400Regular"
  },
  sheetTitle: {
    fontFamily: "Poppins_700Bold",
    color: COLORS.text,
    fontSize: 16
  },
  sheetSub: {
    fontFamily: "Poppins_400Regular",
    color: COLORS.textMuted,
    fontStyle: "italic"
  },
  listContent: {
    paddingHorizontal: 12,
    paddingBottom: 270
  },
  card: {
    borderRadius: 18,
    padding: 10,
    marginBottom: 8,
    backgroundColor: COLORS.surface,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 10,
    elevation: 3
  },
  cardSelected: {
    backgroundColor: "#E6FAF0"
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    marginBottom: 4
  },
  cardActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8
  },
  actionIcon: {
    padding: 2
  },
  cardTitle: {
    color: COLORS.text,
    fontFamily: "Poppins_700Bold",
    marginBottom: 4
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 2
  },
  cardMeta: {
    color: COLORS.textMuted,
    fontFamily: "Poppins_400Regular",
    fontSize: 12
  },
  details: {
    borderRadius: 18,
    padding: 14,
    marginBottom: 8,
    backgroundColor: "#E8F7ED",
    borderWidth: 1,
    borderColor: "rgba(16,185,129,0.3)",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 10,
    elevation: 3
  },
  detailsTitle: {
    color: COLORS.text,
    fontFamily: "Poppins_700Bold",
    fontSize: 16
  },
  detailsTextStrong: {
    marginTop: 4,
    color: COLORS.text,
    fontFamily: "Poppins_600SemiBold"
  },
  detailsTextMuted: {
    marginTop: 2,
    color: COLORS.textMuted,
    fontFamily: "Poppins_400Regular",
    fontSize: 12
  },
  recentWrap: {
    borderRadius: 18,
    padding: 10,
    marginBottom: 8,
    backgroundColor: COLORS.surface,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 10,
    elevation: 3
  },
  recentTitle: {
    color: COLORS.text,
    fontFamily: "Poppins_600SemiBold",
    marginBottom: 6
  },
  recentRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 6,
    borderTopWidth: 1,
    borderTopColor: COLORS.borderSoft
  },
  recentLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flex: 1,
    paddingRight: 8
  },
  recentName: {
    color: COLORS.text,
    fontFamily: "Poppins_500Medium",
    fontSize: 13
  },
  recentMeta: {
    color: COLORS.textMuted,
    fontFamily: "Poppins_400Regular",
    fontSize: 11
  },
  recentTime: {
    color: COLORS.textMuted,
    fontFamily: "Poppins_400Regular",
    fontSize: 11
  },
  emptySearchWrap: {
    borderWidth: 1,
    borderColor: COLORS.borderSoft,
    borderRadius: 16,
    padding: 12,
    backgroundColor: COLORS.surface
  },
  emptySearchTitle: {
    color: COLORS.text,
    fontFamily: "Poppins_600SemiBold"
  },
  emptySearchMeta: {
    marginTop: 4,
    color: COLORS.textMuted,
    fontFamily: "Poppins_400Regular",
    fontSize: 12
  },
  etaGrid: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 4,
    marginTop: 8,
    marginBottom: 4
  },
  etaPill: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    borderWidth: 1,
    borderColor: "rgba(16,185,129,0.24)",
    borderRadius: 999,
    paddingHorizontal: 4,
    paddingVertical: 4,
    backgroundColor: COLORS.surface
  },
  etaPillActive: {
    backgroundColor: "rgba(16,185,129,0.16)"
  },
  etaText: {
    color: COLORS.primaryDark,
    fontFamily: "Poppins_500Medium",
    fontSize: 12
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 20
  },
  modalCard: {
    width: "100%",
    backgroundColor: COLORS.surface,
    borderRadius: 20,
    padding: 14
  },
  modalTitle: {
    fontFamily: "Poppins_700Bold",
    color: COLORS.text,
    fontSize: 18
  },
  modalMessage: {
    marginTop: 6,
    color: COLORS.textMuted,
    fontFamily: "Poppins_400Regular"
  },
  skipRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 12,
    gap: 8
  },
  skipText: {
    flex: 1,
    color: COLORS.text,
    fontFamily: "Poppins_400Regular",
    fontSize: 12
  },
  modalButtons: {
    flexDirection: "row",
    gap: 10,
    marginTop: 14
  },
  modalButton: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.borderSoft,
    alignItems: "center"
  },
  modalButtonPrimary: {
    backgroundColor: COLORS.primary
  },
  modalButtonSecondary: {
    backgroundColor: COLORS.surface
  },
  modalButtonTextPrimary: {
    color: "#fff",
    fontFamily: "Poppins_600SemiBold"
  },
  modalButtonTextSecondary: {
    color: COLORS.text,
    fontFamily: "Poppins_600SemiBold"
  },
  settingsCard: {
    width: "100%",
    maxHeight: "80%",
    backgroundColor: COLORS.surface,
    borderRadius: 20,
    padding: 14
  },
  settingsTitle: {
    fontFamily: "Poppins_700Bold",
    color: COLORS.text,
    fontSize: 20,
    marginBottom: 8
  },
  settingsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.borderSoft
  },
  settingsLabel: {
    flex: 1,
    color: COLORS.text,
    fontFamily: "Poppins_500Medium"
  },
  settingsSubTitle: {
    marginTop: 12,
    marginBottom: 8,
    color: COLORS.text,
    fontFamily: "Poppins_600SemiBold"
  },
  settingsModeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8
  },
  modeOption: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderColor: "rgba(16,185,129,0.24)",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5
  },
  modeOptionActive: {
    backgroundColor: "rgba(16,185,129,0.18)"
  },
  modeOptionText: {
    color: COLORS.primaryDark,
    fontFamily: "Poppins_500Medium",
    textTransform: "capitalize"
  },
  closeSettingsButton: {
    marginTop: 14,
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    alignItems: "center",
    paddingVertical: 10
  },
  closeSettingsText: {
    color: "#fff",
    fontFamily: "Poppins_600SemiBold"
  },
  toast: {
    position: "absolute",
    left: 14,
    right: 14,
    bottom: 18,
    backgroundColor: COLORS.primaryDark,
    borderRadius: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10
  },
  toastText: {
    color: "#fff",
    fontFamily: "Poppins_500Medium"
  },
  bottomNav: {
    flexDirection: "row",
    justifyContent: "space-around",
    alignItems: "center",
    backgroundColor: COLORS.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    elevation: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.08,
    shadowRadius: 10,
    paddingTop: 10,
    paddingBottom: 14,
    paddingHorizontal: 8
  },
  bottomNavItem: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 2
  },
  bottomNavLabel: {
    color: "#8AA599",
    fontFamily: "Poppins_500Medium",
    fontSize: 12
  },
  bottomNavLabelActive: {
    color: COLORS.primaryDark
  }
});




















