import { StyleSheet, useColorScheme } from 'react-native';
import { colors, type Colors, type Scheme } from './tokens.ts';

type NamedStyles = Parameters<typeof StyleSheet.create>[0];

export function themed<S extends NamedStyles>(
  build: (colors: Colors) => S,
): Record<Scheme, Readonly<S>> {
  return {
    light: StyleSheet.create(build(colors.light)),
    dark: StyleSheet.create(build(colors.dark)),
  };
}

export function useScheme(): Scheme {
  return useColorScheme() === 'dark' ? 'dark' : 'light';
}

export function useColors(): Colors {
  return colors[useScheme()];
}
