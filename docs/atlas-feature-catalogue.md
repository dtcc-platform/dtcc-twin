# Old Atlas: feature catalogue and triage

What the original `dtcc-atlas` (`.temp/dtcc-atlas`, `develop` at `b201ff8`) does today, and what each feature becomes in the new Atlas, judged against [DESIGN.md](DESIGN.md).

**Verdicts:**

- **Keep:** port it with the same behavior.
- **Reshape:** keep the user need, change the design to fit DESIGN.
- **Defer:** out of scope until a later phase or until the engine supports it.
- **Drop:** conflicts with DESIGN or has no successor.

**Demo** marks what we propose for the first demo.

## What it is

- **Frontend:** a Svelte 5 single page. MapLibre GL 4 draws a raster Carto Voyager basemap. proj4 converts between EPSG:3006 and WGS84, and marked + DOMPurify render the chat's Markdown.
- **Backend:** a FastAPI server that imports dtcc-core in-process. It also talks to a remote dtcc-sim service and an optional dtcc-agent service.
- **What it never does is draw generated data.** A finished job can be downloaded, and "Add to layers" adds the Dataset's _name_ to the layers list, but nothing is rendered on the map. The only geometry on the map is the selected area.
- **The "3D" toggle** only tilts the camera and adds a sky.

## Catalogue

### Map and area selection

| Feature          | What it does                                                                                                                                                       | Verdict                                                                                                                                                            | Demo |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---- |
| Map              | Full-screen MapLibre map on a Carto raster basemap, centred on Sweden, with zoom/rotate controls                                                                   | **Keep.** DESIGN starts Atlas from "a distinctive geographic overview". Pick a basemap whose terms fit (Carto's free tier has usage limits).                       | ✓    |
| Draw area        | Click two corners to draw a bbox. Move it, or resize from corner handles. A live area tooltip enforces 25 m² to 25 km² (`MAX_BBOX_AREA_KM2`). Stored in EPSG:3006. | **Keep.** This is "select a two-dimensional region". Take the size limit from Dataset coverage or config instead of a hard-coded constant later.                   | ✓    |
| Bounds inspector | Type or paste N/S/E/W in WGS84 degrees, preview live on the map, commit or cancel                                                                                  | **Keep**                                                                                                                                                           | ✓    |
| Location search  | Ctrl+K palette querying Nominatim (OpenStreetMap geocoding), keyboard navigation, fly to the result                                                                | **Keep.** Nominatim's usage policy (at most 1 request/s, identify the app) suggests calling it through the backend. Not in the demo, which opens on the demo area. |      |
| 2D/3D toggle     | Tilts the camera to 60° and adds a sky; no 3D data                                                                                                                 | **Drop.** Replaced by the real 3D view (three.js) later.                                                                                                           |      |

### Datasets and simulations

| Feature              | What it does                                                                                                                                                               | Verdict                                                                                                                                                                               | Demo |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| Dataset catalogue    | Opens after drawing an area. Lists Core Datasets grouped as "DTCC Core" and "User Uploads", with descriptions from a hard-coded `DATASET_META` table keyed by Dataset name | **Reshape.** Build it entirely from descriptors (title, description, `data_category`, `result_kind`). DESIGN forbids metadata keyed by Dataset name ("Generality through discovery"). | ✓    |
| Simulations panel    | Sim Datasets in their own panel                                                                                                                                            | **Reshape** into the same catalogue, grouped by `data_category`                                                                                                                       | ✓    |
| Parameter form       | Built from each Dataset's JSON Schema (custom parser for unions, enums and numbers), validated in the browser, submitted with the area as `bounds`                         | **Reshape.** Generate the form from `args_schema`; the approach and library are a step-3 decision.                                                                                    | ✓    |
| Coverage warning     | Warns when the area misses a Dataset's known bounds                                                                                                                        | **Keep,** driven by descriptor coverage                                                                                                                                               |      |
| Synchronous download | `POST /datasets/download` returns the file directly                                                                                                                        | **Drop.** Replaced by jobs.                                                                                                                                                           |      |

### Jobs and results

| Feature           | What it does                                                                                                       | Verdict                                                                                                                                      | Demo |
| ----------------- | ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| Jobs              | Submit, then updates over server-sent events: queued → processing → complete/failed. The list is kept per session. | **Keep.** The engine only supports polling, so the backend polls it; how Atlas hears about updates is our choice.                            | ✓    |
| Progress          | Percent bar and ETA when measured, indeterminate bar otherwise, error message on failure                           | **Keep.** It already matches the spec: no invented percentages.                                                                              | ✓    |
| Downloads panel   | Jobs listed with Download, "Add to layers", remove, retry                                                          | **Reshape.** Results go into the workspace as layers first; download becomes an explicit action on a result ("Composition before download"). | ✓    |
| Cancel            | Cancel a running job                                                                                               | **Reshape.** Engine v1 can only cancel queued jobs.                                                                                          |      |
| Server status dot | Green/amber/red from the event-stream connection                                                                   | **Keep,** from backend health                                                                                                                |      |

### Layers and scenarios

| Feature                   | What it does                                                                                   | Verdict                                                                                                          | Demo |
| ------------------------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ---- |
| Layers panel              | Show/hide, opacity, drag to reorder, zoom to extent, remove. Only worked for uploaded GeoJSON. | **Keep,** with results actually rendered as layers. DESIGN: "inspect, reorder, show, hide, style".               | ✓    |
| Result details            | None                                                                                           | **New.** Provenance, license, warnings and limitations from the manifest. DESIGN requires them for every result. | ✓    |
| Versions ("Scenario bar") | Several named layer sets: add, duplicate, rename, delete; switch with Alt+←/→                  | **Defer.** Revisit with comparison ("compare results while retaining their identities").                         |      |

### Saving and sharing

| Feature   | What it does                                                                                                                                                | Verdict                                                                                                                                                                                 | Demo |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| Bookmarks | Save the current area by name. Stored in localStorage and synced to the session, with a save prompt after drawing.                                          | **Reshape** into saved areas per user (we have accounts)                                                                                                                                | ✓    |
| Sessions  | Anonymous server-side session at `/s/{code}` holding open panel, camera and bookmarks. Code editable (6–12 characters), share link copied from the top bar. | **Reshape** into Twin Workspaces owned by a user. DESIGN: saving keeps the _complete_ workspace, an opaque URL is not authorization, and sharing means publishing a read-only revision. |      |

### Uploads, admin and chat

| Feature                   | What it does                                                                                                                                                                                                                   | Verdict                                                                                                                           | Demo |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- | ---- |
| Upload wizard             | Batch upload (Shapefile, GeoPackage, GeoJSON, LAS/LAZ, GeoTIFF, CityJSON…), format and CRS detection, per-candidate review, deterministic checks plus an AI quality gate (Claude), then ingest into a "User Uploads" catalogue | **Defer.** Engine v1 has no uploads. DESIGN routes imports through Core's admission as an import Dataset, not an app-side ingest. |      |
| Admin page                | Separate `admin.html`: download Lantmäteriet Geotorget orders, publish them as vector datasets, delete published datasets                                                                                                      | **Drop** the data acquisition, which belongs in Core. Publication management returns later with our Package Catalog.              |      |
| Published vector datasets | `publisher/` CLI turns GeoPackage orders into GeoJSON datasets that the server queries by bbox                                                                                                                                 | **Drop.** Processing and acquisition belong in Core (DESIGN: Twin "must not become a second implementation of data processing").  |      |
| Lurkie chat               | Chat panel over WebSocket to dtcc-agent (Claude via the Agent SDK): geocoding, generating data, simulations, analysing uploaded GeoJSON, returning rendered images                                                             | **Defer.** DESIGN doesn't cover it, and it depends on a separate service.                                                         |      |

### Shell

| Feature                    | What it does                                                              | Verdict                                                       | Demo |
| -------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------- | ---- |
| Layout                     | Glass-style floating panels, a left toolbar, a top bar                    | **Reshape** onto our shadcn kit, keeping the map-first layout | ✓    |
| Helper bar and empty state | Bottom hint that changes with the active tool ("Click to draw a region…") | **Keep**                                                      | ✓    |
| Keyboard shortcuts         | Esc closes panels and cancels drawing; Ctrl+K search comes with search    | **Keep**                                                      | ✓    |
| Side navigation            | Links to the DTCC website, projects, GitHub                               | **Keep** (cheap)                                              |      |

## Proposed demo

The flow:

1. The map opens on the demo area around Chalmers.
2. Draw or type an area.
3. Pick a Dataset from the catalogue, which is generated from descriptors.
4. Fill in its generated form and submit.
5. Watch the job's progress.
6. The result appears **on the map as a layer**, with its provenance, warnings and limitations; the package can be downloaded.
7. Save the area.

It runs against the fake engine. It uses `building_footprints`, the one Dataset whose package has a GeoJSON artifact, so step 6 works with 2D rendering alone.

Everything in it existed in the old Atlas except step 6. Drawing a generated result on the map, which the old Atlas never did, is the part that shows the new architecture.
