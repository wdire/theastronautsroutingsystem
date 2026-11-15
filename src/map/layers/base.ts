import type { Map as MapLibreMap } from 'maplibre-gl';
import { Marker } from 'maplibre-gl';
import { useApp } from '@/store';

/** The visitor's base on the map: a house badge with its name, always shown, under the route's own pins. */
export function addBaseMarker(map: MapLibreMap): () => void {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'base-pin';
  const icon = document.createElement('span');
  icon.className = 'base-pin-icon';
  icon.setAttribute('aria-hidden', 'true');
  const name = document.createElement('span');
  name.className = 'base-pin-name';
  el.append(icon, name);
  // A click shows the base the way any place is shown: its card, and the map closer in on it.
  el.addEventListener('click', (e) => {
    e.stopPropagation();
    const { base, openPlace } = useApp.getState();
    openPlace('base');
    map.flyTo({ center: [base.lon, base.lat], zoom: Math.max(map.getZoom(), 14.5), duration: 1200 });
  });
  const marker = new Marker({ element: el, anchor: 'left', offset: [-14, 0], opacityWhenCovered: '0' });
  const sync = () => {
    const { base } = useApp.getState();
    name.textContent = base.name;
    el.setAttribute('aria-label', `${base.name}, your base`);
    marker.setLngLat([base.lon, base.lat]).addTo(map);
  };
  // From the globe the base is a speck: the badge comes in with the region, its name a little closer.
  const fit = () => {
    const z = map.getZoom();
    el.style.display = z < 6 ? 'none' : '';
    name.style.display = z < 9.5 ? 'none' : '';
  };
  sync();
  fit();
  map.on('zoom', fit);
  const off = useApp.subscribe((s) => s.base, sync);
  return () => {
    off();
    map.off('zoom', fit);
    marker.remove();
  };
}
