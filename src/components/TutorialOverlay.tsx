import React, { useState, useEffect } from "react";
import { Modal, View, Text, StyleSheet, Pressable } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { MaterialIcons } from "@expo/vector-icons";

export const TUTORIAL_COMPLETED_KEY = "foodtrip_tutorial_completed";

export interface TutorialStep {
  id: string;
  title: string;
  description: string;
  icon: keyof typeof MaterialIcons.glyphMap;
}

export const DEFAULT_TUTORIAL_STEPS: TutorialStep[] = [
  {
    id: "welcome",
    title: "Welcome to FoodTrip!",
    description: "Discover the best food spots near your location in just a few taps.",
    icon: "restaurant"
  },
  {
    id: "map_navigation",
    title: "Interactive Map",
    description: "Pan and zoom to explore different areas. Tap the location icon to center back to your current spot.",
    icon: "map"
  },
  {
    id: "nearby_places",
    title: "Quick Navigation",
    description: "Swipe up the bottom sheet to view a curated list of nearby food places directly matching your search.",
    icon: "format-list-bulleted"
  },
  {
    id: "routing",
    title: "Real-time Routing",
    description: "Tap on any place to get estimated travel times and directions whether you're walking, biking, or driving.",
    icon: "directions"
  }
];

interface Props {
  visible: boolean;
  onClose: () => void;
  steps?: TutorialStep[];
}

export function TutorialOverlay({ visible, onClose, steps = DEFAULT_TUTORIAL_STEPS }: Props) {
  const [currentStep, setCurrentStep] = useState(0);
  const [dontShowAgain, setDontShowAgain] = useState(true);

  // Reset step if it becomes visible again
  useEffect(() => {
    if (visible) {
      setCurrentStep(0);
    }
  }, [visible]);

  const handleComplete = async () => {
    if (dontShowAgain) {
      try {
        await AsyncStorage.setItem(TUTORIAL_COMPLETED_KEY, "true");
      } catch (e) {
        console.warn("Failed to save tutorial preference", e);
      }
    }
    onClose();
  };

  const handleNext = () => {
    if (currentStep < steps.length - 1) {
      setCurrentStep(currentStep + 1);
    } else {
      void handleComplete();
    }
  };

  const handleSkip = () => {
    void handleComplete();
  };

  if (!visible || steps.length === 0) return null;

  const step = steps[currentStep];

  return (
    <Modal transparent visible={visible} animationType="fade" statusBarTranslucent>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <View style={styles.header}>
            <Pressable onPress={handleSkip} style={({ pressed }) => [styles.skipBtn, pressed && { opacity: 0.7 }]}>
              <Text style={styles.skipText}>Skip tour</Text>
            </Pressable>
          </View>

          <View style={styles.content}>
            <MaterialIcons name={step.icon} size={64} color="#52a447" style={styles.icon} />
            <Text style={styles.title}>{step.title}</Text>
            <Text style={styles.description}>{step.description}</Text>
          </View>

          <View style={styles.footer}>
            <View style={styles.dots}>
              {steps.map((_, i) => (
                <View key={i} style={[styles.dot, currentStep === i && styles.dotActive]} />
              ))}
            </View>

            <Pressable
              onPress={handleNext}
              style={({ pressed }) => [styles.nextBtn, pressed && { opacity: 0.8 }]}
            >
              <Text style={styles.nextText}>
                {currentStep === steps.length - 1 ? "Get Started" : "Next"}
              </Text>
            </Pressable>
          </View>

          <Pressable
            style={styles.dontShowContainer}
            onPress={() => setDontShowAgain(!dontShowAgain)}
          >
            <MaterialIcons
              name={dontShowAgain ? "check-box" : "check-box-outline-blank"}
              size={20}
              color={dontShowAgain ? "#52a447" : "#6B7280"}
            />
            <Text style={styles.dontShowText}>Don't show this again</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24
  },
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 24,
    width: "100%",
    maxWidth: 400,
    padding: 24,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 16,
    elevation: 10
  },
  header: {
    alignItems: "flex-end",
    marginBottom: 8
  },
  skipBtn: {
    paddingVertical: 4,
    paddingHorizontal: 8
  },
  skipText: {
    color: "#6B7280",
    fontFamily: "Poppins_400Regular",
    fontSize: 14
  },
  content: {
    alignItems: "center",
    paddingVertical: 16
  },
  icon: {
    marginBottom: 20
  },
  title: {
    fontSize: 22,
    fontFamily: "Poppins_700Bold",
    color: "#1F2937",
    textAlign: "center",
    marginBottom: 12
  },
  description: {
    fontSize: 15,
    fontFamily: "Poppins_400Regular",
    color: "#4B5563",
    textAlign: "center",
    lineHeight: 24
  },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 24,
    marginBottom: 16
  },
  dots: {
    flexDirection: "row",
    gap: 8
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#E5E7EB"
  },
  dotActive: {
    backgroundColor: "#52a447",
    width: 20
  },
  nextBtn: {
    backgroundColor: "#52a447",
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 24
  },
  nextText: {
    color: "#FFFFFF",
    fontFamily: "Poppins_700Bold",
    fontSize: 15
  },
  dontShowContainer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: "#F3F4F6",
    gap: 8
  },
  dontShowText: {
    fontSize: 14,
    fontFamily: "Poppins_400Regular",
    color: "#6B7280"
  }
});