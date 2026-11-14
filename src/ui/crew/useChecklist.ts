import { useCallback, useState } from 'react';

const key = (missionId: string) => `areo.checklist.${missionId}`;

function read(missionId: string): Set<string> {
  try {
    const raw = localStorage.getItem(key(missionId));
    const ids: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

/** A crew member's own ticks on the pre-EVA checklist. They are nobody else's business, so they stay in this browser. */
export function useChecklist(missionId: string): [ReadonlySet<string>, (id: string) => void] {
  const [state, setState] = useState(() => ({ missionId, ticked: read(missionId) }));
  // A different mission starts from its own ticks.
  const current = state.missionId === missionId ? state : { missionId, ticked: read(missionId) };
  if (current !== state) setState(current);
  const toggle = useCallback(
    (id: string) =>
      setState((s) => {
        const ticked = new Set(s.ticked);
        if (ticked.has(id)) ticked.delete(id);
        else ticked.add(id);
        try {
          localStorage.setItem(key(s.missionId), JSON.stringify([...ticked]));
        } catch {
          // Blocked storage: the ticks hold for this visit.
        }
        return { missionId: s.missionId, ticked };
      }),
    [],
  );
  return [current.ticked, toggle];
}
