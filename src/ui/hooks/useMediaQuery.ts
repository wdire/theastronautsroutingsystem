import { useSyncExternalStore } from 'react';

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia(query);
      mq.addEventListener('change', onChange);
      return () => mq.removeEventListener('change', onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** Phone layout: panels become bottom sheets. */
export function useIsPhone(): boolean {
  return useMediaQuery('(max-width: 767px)');
}

/** A finger is the main pointer: bigger targets, taps, no hover. */
export function useIsTouch(): boolean {
  return useMediaQuery('(pointer: coarse)');
}
