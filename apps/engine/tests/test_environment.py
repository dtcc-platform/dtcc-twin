"""Environment tests for the DTCC Engine development image.

They check that Core, Sim, FEniCSx, PETSc, HDF5, and the TetGen wrapper are installed
and work together. They run in the development image through `pnpm engine:check`
and in the production image through `pnpm engine:check:prod`; passing them does not verify a deployment.
"""

from importlib.metadata import distribution
from pathlib import Path

import basix.ufl
import dtcc_sim
import dtcc_tetgen_wrapper
import h5py
import numpy as np
import pytest
import ufl
from dolfinx import fem, io, mesh
from dolfinx.fem.petsc import LinearProblem
from dtcc_core.builder import build_city_volume_mesh
from dtcc_core.builder.meshing.tetgen import is_tetgen_available
from dtcc_core.model import Bounds, Building, City, GeometryType, Raster, Surface, Terrain
from mpi4py import MPI
from shapely.geometry import box

UNIT_CUBE_VERTICES = np.array(
    [
        [0.0, 0.0, 0.0],
        [1.0, 0.0, 0.0],
        [1.0, 1.0, 0.0],
        [0.0, 1.0, 0.0],
        [0.0, 0.0, 1.0],
        [1.0, 0.0, 1.0],
        [1.0, 1.0, 1.0],
        [0.0, 1.0, 1.0],
    ]
)
UNIT_CUBE_SIDES = [
    [0, 3, 2, 1],
    [4, 5, 6, 7],
    [0, 1, 5, 4],
    [2, 3, 7, 6],
    [0, 4, 7, 3],
    [1, 2, 6, 5],
]
# A pip wheel of any of these bundles its own GDAL, PROJ or HDF5 next to conda's copy.
NATIVE_LIBRARY_PACKAGES = ("fiona", "rasterio", "pyproj", "pyogrio", "h5py")


@pytest.fixture(scope="module")
def unit_cube_tetrahedra() -> tuple[np.ndarray, np.ndarray]:
    """TetGen's points, shape (N, 3), and tetrahedra, shape (M, 4), for a unit cube."""
    no_triangles = np.empty((0, 3), dtype=np.int64)
    result = dtcc_tetgen_wrapper.tetrahedralize(UNIT_CUBE_VERTICES, no_triangles, UNIT_CUBE_SIDES)
    return np.asarray(result.points), np.asarray(result.tets)


@pytest.fixture(scope="module")
def unit_cube_domain(unit_cube_tetrahedra: tuple[np.ndarray, np.ndarray]) -> mesh.Mesh:
    """A first-order tetrahedral FEniCSx mesh of the unit cube."""
    points, tetrahedra = unit_cube_tetrahedra
    coordinate_element = ufl.Mesh(basix.ufl.element("Lagrange", "tetrahedron", 1, shape=(3,)))
    return mesh.create_mesh(MPI.COMM_WORLD, tetrahedra.astype(np.int64), coordinate_element, points)


def flat_city(buildings: list[tuple[tuple[float, float, float, float], float]]) -> City:
    """A city on flat 80 m by 80 m terrain with LOD0 buildings, given as (footprint box, height) pairs."""
    raster = Raster()
    raster.data = np.zeros((8, 8))
    raster.set_bounds(Bounds(0.0, 0.0, 80.0, 80.0))
    terrain = Terrain()
    terrain.add_geometry(raster, GeometryType.RASTER)
    city = City()
    city.add_terrain(terrain)
    city_buildings = []
    for footprint, height in buildings:
        surface = Surface()
        surface.from_polygon(box(*footprint), height)
        building = Building()
        building.add_geometry(surface, GeometryType.LOD0)
        building.attributes["estimated_height"] = height
        building.attributes["ground_height"] = 0.0
        city_buildings.append(building)
    city.add_buildings(city_buildings)
    return city


def test_dtcc_sim_is_installed() -> None:
    assert dtcc_sim.__version__


def test_core_uses_the_tetgen_wrapper() -> None:
    assert is_tetgen_available()


def test_native_library_packages_come_from_conda() -> None:
    installers = {name: (distribution(name).read_text("INSTALLER") or "").strip() for name in NATIVE_LIBRARY_PACKAGES}
    assert installers == {name: "conda" for name in NATIVE_LIBRARY_PACKAGES}


def test_tetgen_tetrahedralizes_the_unit_cube(unit_cube_tetrahedra: tuple[np.ndarray, np.ndarray]) -> None:
    _, tetrahedra = unit_cube_tetrahedra
    assert tetrahedra.ndim == 2 and tetrahedra.shape[1] == 4 and len(tetrahedra) > 0


def test_core_builds_a_volume_mesh_of_a_small_city(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    # TetGen writes its failure dumps to the working directory, which is the mounted source tree in the dev image.
    monkeypatch.chdir(tmp_path)
    # Core's own smoke case. On Linux arm64, GCC's floating-point contraction makes TetGen reject its surface.
    city = flat_city([((10, 10, 18, 18), 10.0), ((24, 10, 32, 18), 12.0)])
    volume_mesh = build_city_volume_mesh(
        city,
        lod=GeometryType.LOD0,
        domain_height=40.0,
        max_mesh_size=8.0,
        min_mesh_angle=20.0,
        merge_buildings=True,
        min_building_detail=0.0,
        min_building_area=1.0,
        merge_tolerance=0.0,
        smoothing=0,
        boundary_face_markers=False,
        report_mesh_quality=False,
    )
    assert volume_mesh.cells.shape[0] > 0


def test_fenicsx_assembles_the_unit_cube_volume(unit_cube_domain: mesh.Mesh) -> None:
    one = fem.Constant(unit_cube_domain, 1.0)
    volume = fem.assemble_scalar(fem.form(one * ufl.dx(domain=unit_cube_domain)))
    assert volume == pytest.approx(1.0, abs=1e-10)


def test_petsc_solves_a_problem_with_a_known_solution(unit_cube_domain: mesh.Mesh) -> None:
    # u - div(grad(u)) = 1 with natural boundary conditions has the exact solution u = 1.
    function_space = fem.functionspace(unit_cube_domain, ("Lagrange", 1))
    trial = ufl.TrialFunction(function_space)
    test = ufl.TestFunction(function_space)
    bilinear_form = (trial * test + ufl.inner(ufl.grad(trial), ufl.grad(test))) * ufl.dx
    linear_form = fem.Constant(unit_cube_domain, 1.0) * test * ufl.dx
    problem = LinearProblem(
        bilinear_form,
        linear_form,
        petsc_options_prefix="environment_test_",
        petsc_options={"ksp_type": "preonly", "pc_type": "lu"},
    )
    solution = problem.solve()
    assert np.max(np.abs(solution.x.array - 1.0)) < 1e-10


def test_mesh_round_trips_through_hdf5(
    unit_cube_domain: mesh.Mesh, unit_cube_tetrahedra: tuple[np.ndarray, np.ndarray], tmp_path: Path
) -> None:
    xdmf_path = tmp_path / "cube.xdmf"
    with io.XDMFFile(unit_cube_domain.comm, str(xdmf_path), "w") as xdmf_file:
        xdmf_file.write_mesh(unit_cube_domain)
    with h5py.File(xdmf_path.with_suffix(".h5"), "r") as hdf5_file:
        cells_read = hdf5_file[f"Mesh/{unit_cube_domain.name}/topology"].shape[0]
    assert cells_read == len(unit_cube_tetrahedra[1])
