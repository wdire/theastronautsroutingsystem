import { useEffect, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { nasaImages, type NasaImage } from '@/data/nasaImages';

/** More pictures of a named place, live from NASA's image library. Hidden when the library has none. */
export function NasaImages({ name }: { name: string }) {
  // Kept with the name it answers, so a card switched to another place shows no stale pictures.
  const [got, setGot] = useState<{ name: string; images: NasaImage[] } | null>(null);
  const images = got?.name === name ? got.images : null;
  useEffect(() => {
    let live = true;
    void nasaImages(name).then((list) => {
      if (live) setGot({ name, images: list });
    });
    return () => {
      live = false;
    };
  }, [name]);
  if (images !== null && images.length === 0) return null;
  return (
    <section className="px-4 pt-4" aria-labelledby="nasa-images">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h3 id="nasa-images" className="text-xs font-medium text-muted-foreground">
          From NASA’s image library
        </h3>
        <a href={`https://images.nasa.gov/search?q=${encodeURIComponent(`${name} Mars`)}&media=image`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          More
          <ExternalLink className="size-3" aria-hidden />
        </a>
      </div>
      {images === null ? (
        <div className="grid grid-cols-3 gap-1.5" aria-hidden>
          {[0, 1, 2].map((i) => (
            <div key={i} className="aspect-square animate-pulse rounded-md bg-secondary" />
          ))}
        </div>
      ) : (
        <ul className="grid grid-cols-3 gap-1.5">
          {images.map((img) => (
            <li key={img.id}>
              <a href={img.page} target="_blank" rel="noreferrer" title={`${img.title}${img.date ? `, ${img.date}` : ''}`} className="group relative block aspect-square overflow-hidden rounded-md bg-secondary">
                <img src={img.thumb} alt={img.title} loading="lazy" decoding="async" referrerPolicy="no-referrer" className="size-full object-cover transition-transform duration-300 group-hover:scale-105" />
                {img.illustration ? <span className="absolute bottom-1 left-1 rounded bg-black/70 px-1 py-px text-[10px] font-semibold text-white">Illustration</span> : null}
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
