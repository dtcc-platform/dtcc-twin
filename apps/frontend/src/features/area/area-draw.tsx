import type { Map as MapLibreMap } from "maplibre-gl";
import { useContext, useEffect } from "react";
import { useMap } from "react-map-gl/maplibre";
import {
  TerraDraw,
  TerraDrawRectangleMode,
  TerraDrawSelectMode,
  type GeoJSONStoreFeatures,
  type TerraDrawEventListeners,
} from "terra-draw";
import { TerraDrawMapLibreGLAdapter } from "terra-draw-maplibre-gl-adapter";
import { areaSizeProblem, areaSquareMetres, type Area } from "./area";
import { AreaStoreContext, type AreaStore } from "./area-store";

const orange = "#e35a1d";
const white = "#ffffff";

/** Draws the area on the map and lets the user draw, move and resize it; renders nothing itself. */
export function AreaDraw() {
  const map = useMap().current?.getMap();
  const store = useContext(AreaStoreContext);

  // Terra Draw lives outside React.
  useEffect(() => {
    if (!map || !store) return;
    return syncAreaDrawing(map, store);
  }, [map, store]);

  return null;
}

function syncAreaDrawing(map: MapLibreMap, store: AreaStore): () => void {
  const draw = new TerraDraw({
    adapter: new TerraDrawMapLibreGLAdapter({ map }),
    modes: [
      new TerraDrawRectangleMode({
        drawInteraction: "click-move",
        // Esc is the workspace's, which also closes panels.
        keyEvents: null,
        // Checked on the second click only, so the preview keeps following the pointer while it's out of limits.
        validation: (feature, { updateType }) =>
          // eslint-disable-next-line @typescript-eslint/no-unsafe-enum-comparison -- Terra Draw doesn't export its UpdateTypes enum
          updateType === "finish" ? withinLimits(feature) : { valid: true },
        styles: { fillColor: orange, fillOpacity: 0.2, outlineColor: orange, outlineWidth: 2 },
      }),
      new TerraDrawSelectMode({
        keyEvents: null,
        // Always selected, so the box can be dragged without clicking it first.
        allowManualDeselection: false,
        flags: {
          rectangle: {
            feature: {
              draggable: true,
              validation: withinLimits,
              coordinates: { resizable: "opposite" },
            },
          },
        },
        styles: {
          selectedPolygonColor: orange,
          selectedPolygonFillOpacity: 0.2,
          selectedPolygonOutlineColor: orange,
          selectedPolygonOutlineWidth: 2,
          selectionPointColor: white,
          selectionPointWidth: 5,
          selectionPointOutlineColor: orange,
          selectionPointOutlineWidth: 2,
        },
      }),
    ],
  });
  // The area last put on the map, so the store echoing it back doesn't redraw it.
  let shown: Area | null = null;
  let started = false;

  function show(area: Area | null) {
    shown = area;
    draw.clear();
    draw.setMode("select");
    if (!area) return;
    const [result] = draw.addFeatures([toFeature(area)]);
    if (result?.valid && result.id !== undefined) draw.selectFeature(result.id);
  }

  const onChange: TerraDrawEventListeners["change"] = (ids, type, context) => {
    if (context && "origin" in context) return;
    const { placeFirstCorner, setPreview } = store.getState().actions;
    if (type === "create") placeFirstCorner();
    const feature = ids[0] === undefined ? undefined : draw.getSnapshotFeature(ids[0]);
    // Selecting and deselecting update properties too; only a changed geometry is a new preview.
    if (type === "update" && context?.target === "geometry" && feature?.geometry.type === "Polygon") {
      setPreview(toArea(feature));
    }
  };

  const onFinish: TerraDrawEventListeners["finish"] = (id, context) => {
    const feature = draw.getSnapshotFeature(id);
    if (feature?.geometry.type !== "Polygon") return;
    const area = toArea(feature);
    // trap: selecting a drawn box from its own finish event throws, so the subscription redraws it selected instead.
    if (context.mode !== "rectangle") shown = area;
    store.getState().actions.setArea(area);
  };

  function start() {
    draw.start();
    draw.on("change", onChange);
    draw.on("finish", onFinish);
    started = true;
    show(store.getState().area);
  }

  const unsubscribe = store.subscribe((state, previous) => {
    if (!started) return;
    if (state.drawing && !previous.drawing) {
      shown = null;
      draw.clear();
      draw.setMode("rectangle");
      return;
    }
    // A cancelled drawing leaves rectangle mode behind, so show even when there's still no area.
    if (state.area !== shown || (previous.drawing && !state.drawing)) show(state.area);
  });

  if (map.isStyleLoaded()) start();
  else map.once("load", start);

  return () => {
    unsubscribe();
    map.off("load", start);
    if (started) draw.stop();
  };
}

function withinLimits(feature: GeoJSONStoreFeatures) {
  return { valid: areaSizeProblem(areaSquareMetres(toArea(feature))) === undefined };
}

function toFeature({ west, south, east, north }: Area): GeoJSONStoreFeatures {
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
    properties: { mode: "rectangle" },
  };
}

function toArea(feature: GeoJSONStoreFeatures): Area {
  const ring = feature.geometry.type === "Polygon" ? (feature.geometry.coordinates[0] ?? []) : [];
  const longitudes = ring.map(([longitude]) => longitude ?? Number.NaN);
  const latitudes = ring.map(([, latitude]) => latitude ?? Number.NaN);
  return {
    west: round(Math.min(...longitudes)),
    south: round(Math.min(...latitudes)),
    east: round(Math.max(...longitudes)),
    north: round(Math.max(...latitudes)),
  };
}

function round(degrees: number): number {
  return Math.round(degrees * 1e6) / 1e6;
}
