import { useEffect, useState } from 'react';

/** The wall clock, refreshed every `everyMs`: enough for "in 2 h 10 min" without a render each second. */
export function useNow(everyMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), everyMs);
    return () => window.clearInterval(id);
  }, [everyMs]);
  return now;
}
