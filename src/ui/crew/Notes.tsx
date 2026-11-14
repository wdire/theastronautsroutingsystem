/** Private notes on a mission. Written during the run, each is stamped with mission time. Only the author reads them. */
import { useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { Pencil, Trash2 } from 'lucide-react';
import { api } from '../../../convex/_generated/api';
import type { Id } from '../../../convex/_generated/dataModel';
import { LIMITS } from '../../../convex/shared';
import { useApp } from '@/store';
import { auth, toastError } from '@/net/client';
import { fmtUtc } from '@/lib/format';
import { cn } from '@/lib/cn';
import { fmtMarsMoment } from './format';
import { ICON_BTN, PRIMARY_BTN, QUIET_BTN } from './parts';

const AREA = 'min-h-[4.5rem] w-full resize-y rounded-md border bg-transparent px-2.5 py-2 text-[13px] leading-relaxed outline-none placeholder:text-faint focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring';

export function Notes({ missionId, lon, readOnly = false }: { missionId: Id<'missions'>; lon?: number; readOnly?: boolean }) {
  const notes = useQuery(api.notes.list, { auth: auth(), missionId });
  const add = useMutation(api.notes.add);
  const update = useMutation(api.notes.update);
  const remove = useMutation(api.notes.remove);
  const [text, setText] = useState('');
  const [editing, setEditing] = useState<{ id: Id<'notes'>; text: string } | null>(null);
  const missionUtc = useApp((s) => (s.world?.run?.status === 'running' ? s.world.utcMs : null));
  const at = useApp((s) => lon ?? s.world?.run?.home[0] ?? s.plan.start?.lon ?? 77.45);

  return (
    <div>
      <p className="text-xs text-muted-foreground">Only you can read these.</p>
      {notes && notes.length > 0 ? (
        <ul className="mt-2 flex flex-col gap-2">
          {notes.map((n) => (
            <li key={n._id} className="rounded-md border p-2.5">
              {editing?.id === n._id ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    update({ auth: auth(), noteId: n._id, text: editing.text })
                      .then(() => setEditing(null))
                      .catch(toastError);
                  }}
                >
                  <textarea autoFocus value={editing.text} onChange={(e) => setEditing({ id: n._id, text: e.target.value })} aria-label="Edit the note" maxLength={LIMITS.noteText} className={AREA} />
                  <div className="mt-1.5 flex gap-1.5">
                    <button type="submit" className={PRIMARY_BTN} disabled={!editing.text.trim()}>
                      Save
                    </button>
                    <button type="button" className={QUIET_BTN} onClick={() => setEditing(null)}>
                      Cancel
                    </button>
                  </div>
                </form>
              ) : (
                <div className="flex items-start gap-1">
                  <div className="min-w-0 flex-1">
                    <p className="figure text-[11px] text-faint">{n.missionUtcMs !== null ? fmtMarsMoment(n.missionUtcMs, at) : fmtUtc(n.createdAt)}</p>
                    <p className="mt-0.5 text-[13px] leading-relaxed whitespace-pre-wrap">{n.text}</p>
                  </div>
                  {readOnly ? null : (
                    <span className="-mt-1 -mr-1 flex shrink-0">
                      <button type="button" className={ICON_BTN} aria-label="Edit the note" onClick={() => setEditing({ id: n._id, text: n.text })}>
                        <Pencil className="size-3.5" aria-hidden />
                      </button>
                      <button type="button" className={ICON_BTN} aria-label="Delete the note" onClick={() => remove({ auth: auth(), noteId: n._id }).catch(toastError)}>
                        <Trash2 className="size-3.5" aria-hidden />
                      </button>
                    </span>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      ) : notes ? (
        <p className="mt-1.5 text-[13px] text-faint">No notes yet.</p>
      ) : null}
      {readOnly ? null : (
        <form
          className="mt-2"
          onSubmit={(e) => {
            e.preventDefault();
            const line = text.trim();
            if (!line) return;
            add({ auth: auth(), missionId, text: line, ...(missionUtc !== null ? { missionUtcMs: missionUtc } : {}) })
              .then(() => setText(''))
              .catch(toastError);
          }}
        >
          <textarea value={text} onChange={(e) => setText(e.target.value)} aria-label="New note" placeholder={missionUtc !== null ? 'A note, stamped with mission time' : 'A note for yourself'} maxLength={LIMITS.noteText} className={AREA} />
          <button type="submit" className={cn(QUIET_BTN, 'mt-1.5')} disabled={!text.trim()}>
            Add the note
          </button>
        </form>
      )}
    </div>
  );
}
