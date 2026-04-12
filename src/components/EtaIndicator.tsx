import React, { useMemo } from "react";
import { View, Text, StyleSheet } from "react-native";
import Svg, { Circle } from "react-native-svg";

interface Props {
  initialMinutes: number;
  currentMinutes: number;
}

export function EtaIndicator({ initialMinutes, currentMinutes }: Props) {
  // Format the text logically
  const formattedTime = useMemo(() => {
    if (currentMinutes < 60) {
      return `${Math.max(1, currentMinutes)} min`;
    }
    const hrs = Math.floor(currentMinutes / 60);
    const mins = currentMinutes % 60;
    return `${hrs}h ${mins}m`;
  }, [currentMinutes]);

  // Calculate percentage of remaining route
  // If we've driven 5 min of a 10 min route, radius goes down
  const progressRatio = Math.max(0, Math.min(1, currentMinutes / Math.max(1, initialMinutes)));

  const radius = 22;
  const strokeWidth = 8;
  const cx = 28;
  const cy = 28;
  // Circumference of the circle
  const circumference = 2 * Math.PI * radius;
  // Arc length to show (progressRatio)
  const strokeDashoffset = circumference * (1 - progressRatio);

  return (
    <View style={styles.container}>
      <Text style={styles.timeText} numberOfLines={1}>{formattedTime}</Text>
      
      <View style={styles.circleWrap}>
        <Svg width={56} height={56} viewBox="0 0 56 56">
           {/* Background Track Circle */}
           <Circle
            cx={cx}
            cy={cy}
            r={radius}
            stroke="#E5E7EB" // light gray
            strokeWidth={strokeWidth}
            fill="transparent"
          />
          
          {/* Progress Circular Indicator */}
          <Circle
            cx={cx}
            cy={cy}
            r={radius}
            stroke="#10B981" // green
            strokeWidth={strokeWidth}
            fill="transparent"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
            transform={`rotate(-90 ${cx} ${cy})`}
          />
        </Svg>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    paddingLeft: 16,
    paddingRight: 6,
    paddingVertical: 6,
    borderTopLeftRadius: 18,
    borderBottomLeftRadius: 18,
    borderTopRightRadius: 40,
    borderBottomRightRadius: 40,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 6,
    gap: 12
  },
  timeText: {
    fontFamily: "Poppins_700Bold",
    color: "#1F2937",
    fontSize: 24,
    minWidth: 58,
    textAlign: "right"
  },
  circleWrap: {
    width: 56,
    height: 56,
    alignItems: "center",
    justifyContent: "center",
  }
});