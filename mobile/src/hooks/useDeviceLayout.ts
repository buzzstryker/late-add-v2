import { Platform, useWindowDimensions } from 'react-native';

export interface DeviceLayout {
  /** True on iPad (or large Android tablets with width > 600) */
  isTablet: boolean;
  /** True when screen width > height */
  isLandscape: boolean;
  /** Current screen width in dp */
  screenWidth: number;
  /** Current screen height in dp */
  screenHeight: number;
}

/**
 * Device-aware layout hook for responsive UI decisions.
 *
 * Uses Platform.isPad + useWindowDimensions for real-time
 * orientation tracking.  Re-renders automatically on rotation.
 */
export function useDeviceLayout(): DeviceLayout {
  const { width, height } = useWindowDimensions();
  const isTablet = Platform.isPad || (Platform.OS === 'android' && Math.min(width, height) > 600);
  const isLandscape = width > height;

  return {
    isTablet,
    isLandscape,
    screenWidth: width,
    screenHeight: height,
  };
}
