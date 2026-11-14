import { Marker, type Map as MapLibreMap } from 'maplibre-gl';
import { useApp } from '@/store';
import { flyIn, JEZERO_VIEW } from './camera';

/** The label on the planet that says where the app goes. Shown only on the opening screen. */
export function addGlobeMarker(map: MapLibreMap): () => void {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'globe-marker';
  el.setAttribute('aria-label', 'Go to Jezero crater');
  el.innerHTML = '<span class="globe-marker-ring"></span><span class="globe-marker-label">Jezero crater</span>';
  el.addEventListener('click', (e) => {
    e.stopPropagation();
    flyIn(map);
  });
  const marker = new Marker({ element: el, anchor: 'left', offset: [-7, 0] }).setLngLat(JEZERO_VIEW.center).addTo(map);
  const sync = (mode: string) => el.classList.toggle('is-hidden', mode !== 'globe');
  sync(useApp.getState().mode);
  const unsubscribe = useApp.subscribe((s) => s.mode, sync);
  return () => {
    unsubscribe();
    marker.remove();
  };
}
