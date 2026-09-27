import type { Map as MapLibreMap } from "maplibre-gl";
import { useEffect } from "react";
import { useMap } from "react-map-gl/maplibre";
import {
  TerraDraw,
  TerraDrawRectangleMode,
  TerraDrawRenderMode,
  TerraDrawSelectMode,
  type GeoJSONStoreFeatures,
  type TerraDrawEventListeners,
} from "terra-draw";
import { TerraDrawMapLibreGLAdapter } from "terra-draw-maplibre-gl-adapter";
import { useAreaLayers } from "@/features/layers/use-area-layers";
import type { Area } from "./area";
import { selectedArea, useAreaStoreApi, useSelectedArea, type AreaStore } from "./area-store";

/** Prefix of the sources and layers Terra Draw adds to the map, which a basemap switch must carry over. */
export const areaDrawLayerPrefix = "area-draw";

/**
 * Draws the selected area on the map and lets the user draw a new one, or move and resize the selected one unless
 * it's locked; renders nothing itself.
 */
export function AreaDraw() {
  const map = useMap().current?.getMap();
  const store = useAreaStoreApi();
  const selected = useSelectedArea();
  // An area with layers keeps its bounds: the layers were computed for exactly those.
  const locked = useAreaLayers(selected?.area ?? null).length > 0;

  // Terra Draw is outside React: start it once the map's style is ready and keep it in step with the store.
  useEffect(() => {
    if (!map) return;
    return syncAreaDrawing(map, store, locked);
  }, [map, store, locked]);

  return null;
}

function syncAreaDrawing(map: MapLibreMap, store: AreaStore, locked: boolean): () => void {
  const draw = new TerraDraw({
    adapter: new TerraDrawMapLibreGLAdapter({ map, prefixId: areaDrawLayerPrefix }),
    modes: [
      new TerraDrawRectangleMode({ drawInteraction: "click-move" }),
      // No key events: Delete would remove the box behind the store's back.
      new TerraDrawSelectMode({
        keyEvents: null,
        flags: { rectangle: { feature: { draggable: true, coordinates: { resizable: "opposite" } } } },
      }),
      // Shows a locked area; select mode has no flags for it, so it can't be picked up.
      new TerraDrawRenderMode({
        modeName: "locked",
        styles: {
          polygonFillColor: "#3f97e0",
          polygonFillOpacity: 0.1,
          polygonOutlineColor: "#3f97e0",
          polygonOutlineWidth: 2,
        },
      }),
    ],
  });
  // The area last drawn on the map, so the store echoing it back doesn't redraw it.
  let shown: Area | null = null;
  let started = false;

  function show(area: Area | null) {
    shown = area;
    draw.clear();
    draw.setMode("select");
    if (!area) return;
    const [validation] = draw.addFeatures([toFeature(area, locked ? "locked" : "rectangle")]);
    if (!locked && validation?.id !== undefined) draw.selectFeature(validation.id);
  }

  const onFinish: TerraDrawEventListeners["finish"] = (id, context) => {
    const feature = draw.getSnapshotFeature(id);
    if (feature?.geometry.type !== "Polygon") return;
    shown = toArea(feature.geometry.coordinates[0] ?? []);
    const { addDrawnArea, updateSelectedArea } = store.getState().actions;
    if (context.mode === "rectangle") {
      draw.setMode("select");
      draw.selectFeature(id);
      addDrawnArea(shown);
    } else {
      updateSelectedArea(shown);
    }
  };

  function start() {
    draw.start();
    draw.on("finish", onFinish);
    started = true;
    show(selectedArea(store.getState())?.area ?? null);
  }

  const unsubscribe = store.subscribe((state, previous) => {
    if (!started) return;
    if (state.drawing && !previous.drawing) {
      shown = null;
      draw.clear();
      draw.setMode("rectangle");
      return;
    }
    const area = selectedArea(state)?.area ?? null;
    // A cancelled drawing leaves rectangle mode behind, so show even when there's still no area.
    if (area !== shown || (previous.drawing && !state.drawing)) show(area);
  });

  if (map.isStyleLoaded()) start();
  else map.once("load", start);

  return () => {
    unsubscribe();
    map.off("load", start);
    if (started) draw.stop();
  };
}

function toFeature({ west, south, east, north }: Area, mode: string): GeoJSONStoreFeatures {
  return {
    type: "Feature",
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [west, south],
          [east, south],
          [east, north],
          [west, north],
          [west, south],
        ],
      ],
    },
    properties: { mode },
  };
}

function toArea(ring: number[][]): Area {
  const longitudes = ring.map(([longitude]) => longitude ?? Number.NaN);
  const latitudes = ring.map(([, latitude]) => latitude ?? Number.NaN);
  return {
    west: round(Math.min(...longitudes)),
    south: round(Math.min(...latitudes)),
    east: round(Math.max(...longitudes)),
    north: round(Math.max(...latitudes)),
  };
}

// Six decimals is about 10 cm, and within Terra Draw's coordinate precision.
function round(degrees: number): number {
  return Math.round(degrees * 1e6) / 1e6;
}
