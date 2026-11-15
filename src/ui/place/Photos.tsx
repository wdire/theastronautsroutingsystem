import { useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { PlacePhoto } from '@/data/datasets';
import { cn } from '@/lib/cn';

/** The rover’s own photos of a place: what the crew will see when they get there. */
export function Photos({ photos, name, hero = false }: { photos: PlacePhoto[]; name: string; hero?: boolean }) {
  const strip = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  if (photos.length === 0) return null;
  const current = photos[Math.min(index, photos.length - 1)];

  const go = (to: number) => {
    const el = strip.current;
    if (!el) return;
    const next = Math.max(0, Math.min(photos.length - 1, to));
    el.scrollTo({ left: next * el.clientWidth, behavior: 'smooth' });
  };

  return (
    <figure className="group relative bg-sunken">
      <div
        ref={strip}
        onScroll={(e) => {
          const el = e.currentTarget;
          setIndex(Math.round(el.scrollLeft / Math.max(1, el.clientWidth)));
        }}
        className="flex snap-x snap-mandatory overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {photos.map((photo, i) => (
          <img
            key={photo.src}
            src={photo.src}
            alt={photo.caption || `${name}, photo ${i + 1}`}
            loading={i === 0 ? 'eager' : 'lazy'}
            decoding="async"
            width={1200}
            height={750}
            fetchPriority={i === 0 ? 'high' : 'auto'}
            className={cn('w-full shrink-0 snap-center object-cover', hero ? 'aspect-[2/1]' : 'aspect-[16/10]')}
          />
        ))}
      </div>
      {photos.length > 1 ? (
        <>
          <button
            type="button"
            aria-label="Previous photo"
            disabled={index === 0}
            onClick={() => go(index - 1)}
            className="absolute top-1/2 left-2 inline-flex size-8 -translate-y-1/2 items-center justify-center rounded-full bg-black/55 text-white opacity-0 transition-opacity duration-150 group-hover:opacity-100 focus-visible:opacity-100 disabled:hidden pointer-coarse:opacity-100"
          >
            <ChevronLeft className="size-4" aria-hidden />
          </button>
          <button
            type="button"
            aria-label="Next photo"
            disabled={index === photos.length - 1}
            onClick={() => go(index + 1)}
            className="absolute top-1/2 right-2 inline-flex size-8 -translate-y-1/2 items-center justify-center rounded-full bg-black/55 text-white opacity-0 transition-opacity duration-150 group-hover:opacity-100 focus-visible:opacity-100 disabled:hidden pointer-coarse:opacity-100"
          >
            <ChevronRight className="size-4" aria-hidden />
          </button>
          {hero ? null : (
            <div className="pointer-events-none absolute top-2 right-2 rounded-full bg-black/55 px-2 py-0.5 text-[11px] font-medium text-white">
              <span className="figure">
                {index + 1} / {photos.length}
              </span>
            </div>
          )}
        </>
      ) : null}
      {hero ? (
        <span className="pointer-events-none absolute bottom-2.5 left-2.5 rounded-full bg-black/60 px-2.5 py-1 text-[11.5px] font-medium text-white backdrop-blur-sm">
          {photos.length > 1 ? `${index + 1} of ${photos.length} photos` : 'Photo'} by {current?.credit?.includes('Curiosity') ? 'Curiosity' : 'Perseverance'}
        </span>
      ) : null}
      {current && hero ? (
        <figcaption className="truncate px-4 pt-1.5 text-[11px] text-faint" title={`${current.caption ? `${current.caption} ` : ''}${current.camera}, sol ${current.sol}. ${current.credit}`}>
          {current.camera}, sol {current.sol}. {current.credit}
        </figcaption>
      ) : null}
      {current && !hero ? (
        <figcaption className={cn('px-4 py-2 text-xs leading-snug text-muted-foreground')}>
          {current.caption ? `${current.caption} ` : ''}
          <span className="text-faint">
            {current.camera}, sol {current.sol}. {current.credit}
          </span>
        </figcaption>
      ) : null}
    </figure>
  );
}
