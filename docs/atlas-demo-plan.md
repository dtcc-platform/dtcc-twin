# Atlas demo plan

The demo flow from [atlas-feature-catalogue.md](atlas-feature-catalogue.md#proposed-demo), built against a fake engine. Each step is discussed before it's implemented.

## Decisions

- Map: MapLibre through `react-map-gl` on the OpenFreeMap basemap; area drawing with Terra Draw (rectangle and select modes).
- Start view: the map opens zoomed to the demo area; no place search in the demo.
- Layout: a resizable sidebar with an Areas card and, for the selected area, a Layers card; "Add data" opens a non-modal sheet over the map. Jobs show as layers while they run.
- Areas: every drawn area is saved; layers belong to the area whose bounds they ran on, and an area with layers can't change its bounds.
- Coordinates: bounds stay EPSG:3006 end to end; proj4 converts for display.
- Forms: our own renderer for `args_schema` on the shadcn kit. `bounds` comes from the area; `format` is hidden.
- Job updates: TanStack Query polling while any job is unfinished.
- Storage: jobs in Postgres; packages in `apps/backend/.data/packages/` behind a `PackageStorage` service, unzipped by the backend.
- Saved areas and layers: localStorage.
- Access: the map, catalogue and jobs are public (`@Public()`); login stays as it is. For the demo the job list is global.
- Look: the existing shadcn theme.
- Template pages (`items`, `/dev/*`) stay until the demo replaces them.

## Fake engine

- `EngineClient` interface in `apps/backend/src/modules/engine/`, with `FakeEngineClient` as the only implementation.
- Fixtures in `apps/backend/fixtures/engine/`, recorded once from real Core by a Python script run in a Docker container:
  - `descriptors.json`: `describe()` for every Core and Sim Dataset
  - `area.json`: the demo area (around Chalmers, Gothenburg)
  - `building_footprints.dtccpkg`: legacy v2 package with GeoJSON in EPSG:3006; the demo's map layer
  - `deso.dtccpkg`: canonical v3 package with only the protobuf model; a result with details but nothing to draw
- Job state is derived from time since submission (queued → running with phased progress → completed). A Dataset without a fixture package fails with a clear error.
- Results always cover the demo area, whatever area is submitted; the demo is run there.

## API (`/api`)

| Route                                   | Returns                                           |
| --------------------------------------- | ------------------------------------------------- |
| `GET /datasets`, `GET /datasets/:name`  | Dataset descriptors                               |
| `POST /jobs`                            | a new job, from `{ dataset, parameters }`         |
| `GET /jobs`, `GET /jobs/:id`            | jobs with state, progress and error               |
| `GET /jobs/:id/result`                  | the manifest: presentation, provenance, artifacts |
| `GET /jobs/:id/artifacts/:artifactPath` | one artifact file, e.g. the GeoJSON               |
| `GET /jobs/:id/package`                 | the `.dtccpkg` download                           |

Request and response schemas go in `packages/contracts`; the engine's own payload schemas stay in the backend's engine module.

## New dependencies

- Atlas: `maplibre-gl`, `react-map-gl`, `terra-draw` with its MapLibre adapter, `proj4`
- Backend: `fflate`
- Fixture recording: a Python image with uv, run through Docker; nothing installed locally

## Build order

1. Record the fixtures.
2. Backend: engine module and `/datasets`.
3. Backend: jobs table, lifecycle, result extraction, artifact and package routes.
4. Atlas: full-screen map page with basemap, opening on the demo area.
5. Atlas: draw, move and resize the area, bounds inspector, saved areas.
6. Atlas: catalogue grouped by `data_category`, and the generated form.
7. Atlas: jobs panel with progress and errors.
8. Atlas: result layers (show, hide, opacity, reorder, zoom, remove), result details, package download.
9. ~~Atlas: helper bar, keyboard shortcuts, DTCC links.~~ Dropped: not needed for the demo.

Backend steps start with failing e2e tests. In Atlas, the form, job submission and layer actions get tests first. `pnpm check` passes at the end of each step.
