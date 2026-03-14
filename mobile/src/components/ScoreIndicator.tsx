import React from 'react';
import { View, Text, StyleSheet, ViewStyle, TextStyle } from 'react-native';

interface ScoreIndicatorProps {
  score: number;
  par: number;
  /** Font size for the score text. Defaults to 12. */
  size?: number;
  /** Override text color. Defaults to '#1A1A2E'. */
  color?: string;
  /** Override font weight. Defaults to '600'. */
  fontWeight?: TextStyle['fontWeight'];
}

/**
 * Renders a golf score with traditional scorecard markings:
 * - Albatross (3 under): double circle
 * - Eagle (2 under): double circle
 * - Birdie (1 under): single circle
 * - Par: plain number
 * - Bogey (1 over): single square
 * - Double bogey (2 over): double square
 * - Triple bogey+ (3+ over): triple square
 */
export function ScoreIndicator({ score, par, size = 12, color = '#1A1A2E', fontWeight = '600' }: ScoreIndicatorProps) {
  const diff = score - par;

  const textStyle: TextStyle = { fontSize: size, fontWeight, color, textAlign: 'center' };

  // Par — plain number
  if (diff === 0) {
    return <Text style={textStyle}>{score}</Text>;
  }

  // Under par — circles
  if (diff < 0) {
    const rings = Math.min(Math.abs(diff), 2); // 1 = birdie, 2 = eagle/albatross
    const circleSize = size + 8;
    const outerSize = circleSize + 6;

    if (rings === 1) {
      // Single circle (birdie)
      return (
        <View style={[styles.circleOuter, { width: circleSize, height: circleSize, borderRadius: circleSize / 2, borderColor: color }]}>
          <Text style={textStyle}>{score}</Text>
        </View>
      );
    }
    // Double circle (eagle / albatross)
    return (
      <View style={[styles.circleOuter, { width: outerSize, height: outerSize, borderRadius: outerSize / 2, borderColor: color }]}>
        <View style={[styles.circleOuter, { width: circleSize, height: circleSize, borderRadius: circleSize / 2, borderColor: color }]}>
          <Text style={textStyle}>{score}</Text>
        </View>
      </View>
    );
  }

  // Over par — squares
  const boxes = Math.min(diff, 3); // 1 = bogey, 2 = double, 3 = triple+
  const boxSize = size + 6;
  const midSize = boxSize + 5;
  const outerBoxSize = midSize + 5;

  if (boxes === 1) {
    // Single square (bogey)
    return (
      <View style={[styles.squareOuter, { width: boxSize, height: boxSize, borderColor: color }]}>
        <Text style={textStyle}>{score}</Text>
      </View>
    );
  }

  if (boxes === 2) {
    // Double square (double bogey)
    return (
      <View style={[styles.squareOuter, { width: midSize, height: midSize, borderColor: color }]}>
        <View style={[styles.squareOuter, { width: boxSize, height: boxSize, borderColor: color }]}>
          <Text style={textStyle}>{score}</Text>
        </View>
      </View>
    );
  }

  // Triple square (triple bogey or worse)
  return (
    <View style={[styles.squareOuter, { width: outerBoxSize, height: outerBoxSize, borderColor: color }]}>
      <View style={[styles.squareOuter, { width: midSize, height: midSize, borderColor: color }]}>
        <View style={[styles.squareOuter, { width: boxSize, height: boxSize, borderColor: color }]}>
          <Text style={textStyle}>{score}</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  circleOuter: {
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  squareOuter: {
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
