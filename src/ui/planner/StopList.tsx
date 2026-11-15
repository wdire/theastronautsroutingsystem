import { useEffect, useRef, useState } from 'react';
import { DndContext, KeyboardSensor, MeasuringStrategy, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Camera, ChevronDown, FlaskConical, GripVertical, Pencil, Plus, Ruler, ScanSearch, Trash2, X } from 'lucide-react';
import { fmtLatLon } from '@/lib/format';
import { toast } from 'sonner';
import type { Stop, Task, TaskKind } from '@/engines/types';
import { TASK_DEFAULT_MIN, TASK_NAME, useApp } from '@/store';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/ui/components/ui/dropdown-menu';
import { fmtDuration } from '@/lib/format';
import { stopLabel } from '@/planner/labels';
import { cn } from '@/lib/cn';

const TASK_ICON = { sample: FlaskConical, photo: Camera, measure: Ruler, survey: ScanSearch, custom: Pencil } as const;
const TASK_KINDS: readonly TaskKind[] = ['sample', 'photo', 'measure', 'survey', 'custom'];


function TaskRow({ stopId, task }: { stopId: string; task: Task }) {
  const updateTask = useApp((s) => s.updateTask);
  const removeTask = useApp((s) => s.removeTask);
  const Icon = TASK_ICON[task.kind];
  const name = task.label ?? TASK_NAME[task.kind];
  return (
    <li className="flex items-center gap-2 py-1">
      <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      {task.kind === 'custom' ? (
        <input
          aria-label="Task name"
          name="task-name"
          autoComplete="off"
          value={task.label ?? ''}
          placeholder="Name this task"
          maxLength={40}
          onChange={(e) => updateTask(stopId, task.id, { label: e.target.value })}
          className="h-7 min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 text-[13px] outline-none hover:border-input focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring"
        />
      ) : (
        <span className="min-w-0 flex-1 truncate text-[13px]">{name}</span>
      )}
      <label className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
        <input
          type="number"
          name="task-minutes"
          inputMode="numeric"
          autoComplete="off"
          aria-label={`Minutes for ${name}`}
          min={1}
          max={600}
          step={5}
          value={task.minutes}
          onChange={(e) => {
            const v = Math.round(Number(e.target.value));
            if (Number.isFinite(v)) updateTask(stopId, task.id, { minutes: Math.max(1, Math.min(600, v)) });
          }}
          className="figure h-7 w-12 rounded border border-input bg-transparent px-1 text-right text-[13px] text-foreground outline-none focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring"
        />
        min
      </label>
      <button
        type="button"
        aria-label={`Remove ${name}`}
        onClick={() => removeTask(stopId, task.id)}
        className="inline-flex size-7 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
      >
        <X className="size-3.5" aria-hidden />
      </button>
    </li>
  );
}

/**
 * The stop's name, being written: opened on a stop just added, or from its pencil. Enter or leaving the field
 * keeps it; an empty name shows the coordinates instead. Escape keeps the name it had.
 */
function StopNameField({ stop, onDone }: { stop: Stop; onDone: () => void }) {
  const updateStop = useApp((s) => s.updateStop);
  const [text, setText] = useState(stop.name ?? '');
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.select();
    el.scrollIntoView({ block: 'nearest' });
  }, []);
  const finish = (keep: boolean) => {
    if (done.current) return;
    done.current = true;
    if (keep) {
      const name = text.replace(/\s+/g, ' ').trim().slice(0, 48);
      if (name !== (stop.name ?? '')) updateStop(stop.id, { name: name || undefined });
    }
    onDone();
  };
  return (
    <input
      ref={ref}
      aria-label="Stop name"
      name="stop-name"
      autoComplete="off"
      value={text}
      maxLength={48}
      placeholder={`Name it, or leave ${fmtLatLon(stop.lat, stop.lon, 3)}`}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          finish(true);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          finish(false);
        }
      }}
      onBlur={() => finish(true)}
      className="h-8 min-w-0 flex-1 rounded border border-ring bg-transparent px-2 text-[13px] font-medium outline-none ring-1 ring-ring placeholder:font-normal placeholder:text-muted-foreground"
    />
  );
}

function StopRow({ stop, index, open, onToggle }: { stop: Stop; index: number; open: boolean; onToggle: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: stop.id });
  const addTask = useApp((s) => s.addTask);
  const naming = useApp((s) => s.namingStopId === stop.id);
  const setNaming = useApp((s) => s.setNamingStop);
  const work = stop.tasks.reduce((sum, t) => sum + t.minutes, 0);

  const remove = () => {
    const before = useApp.getState().plan;
    useApp.getState().removeStop(stop.id);
    toast(`Removed stop ${index + 1}`, {
      description: stopLabel(stop),
      action: { label: 'Undo', onClick: () => useApp.getState().setPlan(before) },
    });
  };

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn('rounded-md border bg-background', isDragging && 'relative z-10 shadow-panel')}
    >
      <div className="flex items-center gap-1 py-1 pr-1 pl-0.5">
        <button
          type="button"
          aria-label={`Move stop ${index + 1}: ${stopLabel(stop)}`}
          className="inline-flex h-9 w-6 shrink-0 cursor-grab touch-none items-center justify-center rounded text-faint transition-colors hover:text-foreground active:cursor-grabbing"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="size-4" aria-hidden />
        </button>
        <span className="figure grid size-6 shrink-0 place-items-center rounded-full bg-primary text-xs font-bold text-primary-foreground">{index + 1}</span>
        {naming ? (
          <StopNameField stop={stop} onDone={() => setNaming(null)} />
        ) : (
          <button type="button" aria-expanded={open} onClick={onToggle} className="flex min-w-0 flex-1 items-center gap-2 rounded px-1.5 py-1 text-left transition-colors hover:bg-muted">
            <span className="min-w-0 flex-1">
              <span className={cn('block truncate text-[13px] font-medium', !stop.name && 'figure')}>{stopLabel(stop)}</span>
              <span className="block truncate text-xs text-muted-foreground">
                {stop.tasks.length === 0 ? 'No tasks yet' : `${stop.tasks.length} ${stop.tasks.length === 1 ? 'task' : 'tasks'}, ${fmtDuration(work * 60)}`}
              </span>
            </span>
            <ChevronDown className={cn('size-4 shrink-0 text-muted-foreground transition-transform duration-200', open && 'rotate-180')} aria-hidden />
          </button>
        )}
        {naming ? null : (
          <button
            type="button"
            aria-label={`Rename stop ${index + 1}`}
            title="Rename"
            onClick={() => setNaming(stop.id)}
            className="inline-flex size-8 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <Pencil className="size-3.5" aria-hidden />
          </button>
        )}
        <button
          type="button"
          aria-label={`Remove stop ${index + 1}`}
          onClick={remove}
          className="inline-flex size-8 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          <Trash2 className="size-3.5" aria-hidden />
        </button>
      </div>
      {open ? (
        <div className="border-t px-3 pt-1 pb-2">
          {stop.tasks.length > 0 ? (
            <ul>
              {stop.tasks.map((task) => (
                <TaskRow key={task.id} stopId={stop.id} task={task} />
              ))}
            </ul>
          ) : null}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="mt-1 inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-[13px] font-medium text-primary transition-colors hover:bg-secondary data-[state=open]:bg-secondary"
              >
                <Plus className="size-3.5" aria-hidden />
                Add a task
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              {TASK_KINDS.map((kind) => {
                const Icon = TASK_ICON[kind];
                return (
                  <DropdownMenuItem key={kind} onSelect={() => addTask(stop.id, kind)}>
                    <Icon aria-hidden />
                    <span className="flex-1">{kind === 'custom' ? 'Something else' : TASK_NAME[kind]}</span>
                    <span className="figure text-xs text-muted-foreground">{TASK_DEFAULT_MIN[kind]} min</span>
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ) : null}
    </li>
  );
}

/** The stops of the plan: drag to reorder, open one to edit its tasks. */
export function StopList() {
  const stops = useApp((s) => s.plan.stops);
  const moveStop = useApp((s) => s.moveStop);
  const [openId, setOpenId] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  // A stop that has just been added opens, so its tasks can be chosen straight away.
  const lastId = stops[stops.length - 1]?.id ?? null;
  const [seenLast, setSeenLast] = useState(lastId);
  if (lastId !== seenLast) {
    setSeenLast(lastId);
    if (lastId && stops.length > 0) setOpenId(lastId);
  }

  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const to = stops.findIndex((s) => s.id === e.over?.id);
    if (to >= 0) moveStop(String(e.active.id), to);
  };

  if (stops.length === 0) return null;
  return (
    // A stop closes while it is carried, and the list is measured again, so an open stop full of
    // tasks moves as easily as a closed one, by pointer or by keyboard.
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
      onDragStart={() => setOpenId(null)}
      onDragEnd={onDragEnd}
    >
      <SortableContext items={stops.map((s) => s.id)} strategy={verticalListSortingStrategy}>
        <ol className="flex flex-col gap-1.5" aria-label="Stops">
          {stops.map((stop, i) => (
            <StopRow key={stop.id} stop={stop} index={i} open={openId === stop.id} onToggle={() => setOpenId(openId === stop.id ? null : stop.id)} />
          ))}
        </ol>
      </SortableContext>
    </DndContext>
  );
}
