/**
 * Lines on the map say what they are. Hovering one thickens it and shows a short label by the pointer;
 * clicking one opens what it belongs to (Perseverance's drive opens Discover, another route is chosen,
 * a range ring explains itself). Thin lines get a few pixels of slack so they are easy to hit.
 */
import type { MapGeoJSONFeature, Map as MapLibreMap, MapMouseEvent } from 'maplibre-gl';
import { useApp } from '@/store';

interface Kind {
  layer: string;
  /** The label by the pointer. */
  text: (f: MapGeoJSONFeature) => string;
  /** What a click does; return true when it handled the click. */
  click?: (f: MapGeoJSONFeature) => boolean;
  /** Line width while hovered. */
  width?: number;
}

const KINDS: readonly Kind[] = [
  {
    layer: 'mission-hazard-fill',
    text: () => 'Dust devil zone: grit and gusts. Routes around it avoid it.',
  },
  { layer: 'mission-proposed', text: () => 'Proposed new route. Take it or keep the old one in the mission panel.', width: 6 },
  { layer: 'mission-path', text: () => 'The crew’s route. Its progress is in the mission panel.', width: 6 },
  {
    layer: 'route-alt',
    text: (f) => `Another way${f.properties?.label ? `: ${String(f.properties.label)}` : ''}. Click to choose it.`,
    click: (f) => {
      const id = f.properties?.id;
      if (typeof id !== 'string') return false;
      useApp.getState().selectRoute(id);
      return true;
    },
    width: 5,
  },
  { layer: 'route-line', text: () => 'Your planned route. Click to add a stop here.', width: 7 },
  {
    layer: 'traverse-stops',
    text: (f) => `Perseverance stopped here on sol ${String(f.properties?.sol ?? '?')}. Click to follow its drive.`,
    click: () => openDiscover(),
  },
  {
    layer: 'traverse-line',
    text: () => 'Perseverance’s drive since February 2021. Click to follow it sol by sol.',
    click: () => openDiscover(),
    width: 3,
  },
  {
    layer: 'range-rings',
    text: (f) => `${String(f.properties?.label ?? 'Range')}: how far a suited crew gets from the base over this ground.`,
    width: 2.4,
  },
];

function openDiscover(): boolean {
  const s = useApp.getState();
  s.openPlace(null);
  s.openDock('discover');
  return true;
}

export function addHoverInfo(map: MapLibreMap): () => void {
  const tip = document.createElement('div');
  tip.className = 'map-tip';
  tip.setAttribute('role', 'tooltip');
  tip.hidden = true;
  map.getContainer().appendChild(tip);

  let hovered: { kind: Kind; base: unknown } | null = null;
  const unhover = () => {
    if (hovered?.kind.width && map.getLayer(hovered.kind.layer)) map.setPaintProperty(hovered.kind.layer, 'line-width', hovered.base as number);
    hovered = null;
    tip.hidden = true;
    map.getCanvas().style.removeProperty('cursor');
  };

  const hit = (e: MapMouseEvent): { kind: Kind; feature: MapGeoJSONFeature } | null => {
    const layers = KINDS.map((k) => k.layer).filter((id) => map.getLayer(id) && map.getLayoutProperty(id, 'visibility') !== 'none');
    if (layers.length === 0) return null;
    const pad = 5;
    const found = map.queryRenderedFeatures(
      [
        [e.point.x - pad, e.point.y - pad],
        [e.point.x + pad, e.point.y + pad],
      ],
      { layers },
    );
    // The most specific layer wins, in the order KINDS lists them.
    for (const kind of KINDS) {
      const feature = found.find((f) => f.layer.id === kind.layer);
      if (feature) return { kind, feature };
    }
    return null;
  };

  const onMove = (e: MapMouseEvent) => {
    const s = useApp.getState();
    if (s.picking || s.flyover || s.mode !== 'map') return unhover();
    const h = hit(e);
    if (!h) return unhover();
    if (hovered?.kind !== h.kind) {
      unhover();
      // Only line layers have a width: asking a circle layer (the traverse's stops) for one throws.
      const base = map.getLayer(h.kind.layer)?.type === 'line' ? map.getPaintProperty(h.kind.layer, 'line-width') : undefined;
      hovered = { kind: h.kind, base };
      if (h.kind.width && typeof base === 'number') map.setPaintProperty(h.kind.layer, 'line-width', h.kind.width);
    }
    tip.textContent = h.kind.text(h.feature);
    tip.hidden = false;
    // Beside the pointer, flipped to the left near the right edge so it stays on screen.
    const w = map.getContainer().clientWidth;
    const left = e.point.x + 14 + 300 > w ? e.point.x - 14 - Math.min(300, tip.offsetWidth) : e.point.x + 14;
    tip.style.transform = `translate(${Math.round(left)}px, ${Math.round(e.point.y + 14)}px)`;
    map.getCanvas().style.cursor = h.kind.click || h.kind.layer === 'route-line' ? 'pointer' : 'help';
  };

  const onClick = (e: MapMouseEvent) => {
    const s = useApp.getState();
    if (s.picking || s.flyover || e.defaultPrevented) return;
    const h = hit(e);
    if (h?.kind.click?.(h.feature)) {
      e.preventDefault();
      unhover();
    }
  };

  map.on('mousemove', onMove);
  map.on('mouseout', unhover);
  map.on('click', onClick);
  return () => {
    map.off('mousemove', onMove);
    map.off('mouseout', unhover);
    map.off('click', onClick);
    tip.remove();
  };
}
