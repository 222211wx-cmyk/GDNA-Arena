import colors from '@/constants/colors';

/**
 * Returns GDNA Arena design tokens.
 * GDNA Arena is always dark — the dark palette is used unconditionally.
 */
export function useColors() {
  return { ...colors.dark, radius: colors.radius };
}
