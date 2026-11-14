import { Marker, type Map as MapLibreMap } from 'maplibre-gl';
import { loadNames, loadPlaces, loadSamples } from '@/data/datasets';
import { useApp } from '@/store';

interface Label {
  marker: Marker;
  el: HTMLElement;
  group: 'names' | 'rover';
  minZoom: number;
  maxZoom: number;
}

function labelElement(text: string, kind: 'feature' | 'place' | 'sample', key: string): HTMLButtonElement {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = `map-label map-label-${kind}`;
  el.textContent = text;
  el.addEventListener('click', (e) => {
    const s = useApp.getState();
    // While the planner or Rover View waits for a point, a click on a label is a click on the map.
    if (s.mode !== 'map' || s.picking) return;
    e.stopPropagation();
    s.openPlace(key);
  });
  return el;
}

/**
 * Names on the map. Landforms are set in italics, as on printed maps; places the rover studied are upright
 * with a dot. They are map markers, so they move with the map in the same frame and never trail it.
 */
export function addLabels(map: MapLibreMap): () => void {
  const labels: Label[] = [];
  let disposed = false;

  // Labels are added in priority order: when two overlap, the later one gives way.
  const declutter = () => {
    const kept: DOMRect[] = [];
    for (const l of labels) {
      if (l.el.dataset.on !== '1') continue;
      const r = l.el.getBoundingClientRect();
      // A name cut by the edge of the screen reads as a stray syllable: show it whole or not at all.
      if (r.left < 2 || r.right > window.innerWidth - 2) {
        l.el.classList.add('is-hidden');
        continue;
      }
      const clash = kept.some((k) => r.left < k.right + 4 && r.right > k.left - 4 && r.top < k.bottom + 1 && r.bottom > k.top - 1);
      l.el.classList.toggle('is-hidden', clash);
      if (!clash) kept.push(r);
    }
  };

  const sync = () => {
    const s = useApp.getState();
    const zoom = map.getZoom();
    const on = s.mode === 'map';
    for (const l of labels) {
      const visible = on && s.layers[l.group] && zoom >= l.minZoom && zoom < l.maxZoom;
      l.el.dataset.on = visible ? '1' : '0';
      if (!visible) l.el.classList.add('is-hidden');
    }
    declutter();
  };

  const add = (el: HTMLElement, lon: number, lat: number, group: Label['group'], minZoom: number, maxZoom: number, anchor: 'center' | 'left') => {
    if (disposed) return;
    const marker = new Marker({ element: el, anchor, ...(anchor === 'left' ? { offset: [-5, 0] as [number, number] } : {}) }).setLngLat([lon, lat]).addTo(map);
    labels.push({ marker, el, group, minZoom, maxZoom });
  };

  void loadNames()
    .then((names) => {
      for (const n of names) {
        // A feature's name fades out once the feature is much larger than the screen.
        const maxZoom = n.diameterKm > 0 ? Math.min(17.1, 16.5 - Math.log2(Math.max(0.5, n.diameterKm) / 6)) : 17.1;
        add(labelElement(n.name, 'feature', `feature:${n.id}`), n.lon, n.lat, 'names', Math.max(5.5, n.minZoom), maxZoom, 'center');
      }
      sync();
    })
    .catch(() => undefined);
  void loadPlaces()
    .then((places) => {
      for (const p of places) if (p.kind !== 'sample') add(labelElement(p.name, 'place', `place:${p.id}`), p.lon, p.lat, 'rover', 11.5, 17.1, 'left');
      sync();
    })
    .catch(() => undefined);
  void loadSamples()
    .then((samples) => {
      for (const s of samples) add(labelElement(s.name, 'sample', `sample:${s.id}`), s.lon, s.lat, 'rover', 14, 17.1, 'left');
      sync();
    })
    .catch(() => undefined);

  map.on('zoom', sync);
  map.on('moveend', declutter);
  const offLayers = useApp.subscribe((s) => s.layers, sync);
  const offMode = useApp.subscribe((s) => s.mode, sync);
  return () => {
    disposed = true;
    map.off('zoom', sync);
    map.off('moveend', declutter);
    offLayers();
    offMode();
    for (const l of labels) l.marker.remove();
  };
}
