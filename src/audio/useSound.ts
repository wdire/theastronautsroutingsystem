import { useSyncExternalStore } from 'react';
import { onSoundChange, setSoundOn, soundOn } from './engine';

/** Whether sound effects are on, and the switch. */
export function useSound(): [boolean, (on: boolean) => void] {
  const on = useSyncExternalStore(onSoundChange, soundOn, soundOn);
  return [on, setSoundOn];
}
