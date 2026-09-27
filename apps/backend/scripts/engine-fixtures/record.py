"""Record the fake engine's fixtures from real dtcc-core and dtcc-sim output.

Writes to the directory given as the first argument:

- descriptors.json: describe() for every registered Core and Sim Dataset
- area.json: the demo area, in EPSG:4326 and in the EPSG:3006 bounds the Datasets take
- <dataset>.dtccpkg: a package for each Dataset in PACKAGES, exported with that entry's options
- <dataset>.progress.json: the progress events Core reported while building it
"""

import json
import sys
from pathlib import Path

from pyproj import Transformer

import dtcc_sim.datasets  # noqa: F401  Importing registers the Sim Datasets.
from dtcc_core.common.progress import set_progress_callback
from dtcc_core.datasets.registry import get_dataset, list_datasets

# Around the Chalmers Johanneberg campus, Gothenburg: min lon, min lat, max lon, max lat.
DEMO_AREA_WGS84 = (11.970, 57.686, 11.980, 57.692)

# Export options per Dataset, limited by what Core supports at the pinned revision.
PACKAGES = {
    # FootprintCollection has no canonical encoding yet: a legacy v2 package with GeoJSON.
    "building_footprints": {"format": "geojson"},
    # DeSO has a canonical encoding but no GeoJSON writer: a canonical v3 package with only the model.
    "deso": {"canonical": True},
}


def demo_bounds() -> list[float]:
    to_sweref = Transformer.from_crs("EPSG:4326", "EPSG:3006", always_xy=True)
    min_x, min_y = to_sweref.transform(DEMO_AREA_WGS84[0], DEMO_AREA_WGS84[1])
    max_x, max_y = to_sweref.transform(DEMO_AREA_WGS84[2], DEMO_AREA_WGS84[3])
    return [round(min_x), round(min_y), round(max_x), round(max_y)]


def write_json(path: Path, value) -> None:
    path.write_text(json.dumps(value, indent=2, default=str) + "\n", encoding="utf-8")


def main(out: Path) -> None:
    out.mkdir(parents=True, exist_ok=True)
    bounds = demo_bounds()

    descriptors = [dataset.describe() for _, dataset in sorted(list_datasets().items())]
    write_json(out / "descriptors.json", descriptors)
    write_json(out / "area.json", {"wgs84": list(DEMO_AREA_WGS84), "bounds": bounds, "crs": "EPSG:3006"})
    print(f"{len(descriptors)} descriptors, demo bounds {bounds}")

    for name, export_options in PACKAGES.items():
        progress_events = []
        set_progress_callback(progress_events.append)
        result = get_dataset(name)(bounds=bounds)
        set_progress_callback(None)
        write_json(out / f"{name}.progress.json", progress_events)

        package = result.export(out / f"{name}.dtccpkg", **export_options)
        print(f"{name}: {package.manifest.schema_version}, {[artifact.path for artifact in package.artifacts]}, "
              f"{len(progress_events)} progress events")


if __name__ == "__main__":
    main(Path(sys.argv[1]))
