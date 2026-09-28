"""Smoke check for the DTCC Engine development image.

Verifies that Core, Sim, FEniCSx, and the TetGen wrapper are installed and work
together: TetGen tetrahedralizes a unit cube, FEniCSx assembles its volume and
solves a small problem through PETSc, and the mesh round-trips through an
XDMF/HDF5 file that h5py reads back. Sim is only imported. Exits with a non-zero
status if any step fails. Remove this script once Engine code provides its own
verification.
"""

import platform
import tempfile
from importlib.metadata import distribution, version
from pathlib import Path

import basix.ufl
import dolfinx
import dtcc_sim
import dtcc_tetgen_wrapper
import h5py
import numpy as np
import ufl
from dolfinx import fem, io, mesh
from dolfinx.fem.petsc import LinearProblem
from dtcc_core.builder.meshing.tetgen import is_tetgen_available
from mpi4py import MPI

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


def packages_not_from_conda() -> list[str]:
    """Return the names in NATIVE_LIBRARY_PACKAGES whose installed distribution was not installed by conda."""
    return [
        name
        for name in NATIVE_LIBRARY_PACKAGES
        if (distribution(name).read_text("INSTALLER") or "").strip() != "conda"
    ]


def tetrahedralize_unit_cube() -> tuple[np.ndarray, np.ndarray]:
    """Return the points, shape (N, 3), and tetrahedra, shape (M, 4), that TetGen generates for a unit cube."""
    no_triangles = np.empty((0, 3), dtype=np.int64)
    result = dtcc_tetgen_wrapper.tetrahedralize(UNIT_CUBE_VERTICES, no_triangles, UNIT_CUBE_SIDES)
    return np.asarray(result.points), np.asarray(result.tets)


def create_domain(points: np.ndarray, tetrahedra: np.ndarray) -> mesh.Mesh:
    """Create a first-order tetrahedral FEniCSx mesh from TetGen's points and tetrahedra."""
    coordinate_element = ufl.Mesh(basix.ufl.element("Lagrange", "tetrahedron", 1, shape=(3,)))
    return mesh.create_mesh(MPI.COMM_WORLD, tetrahedra.astype(np.int64), coordinate_element, points)


def mesh_volume(domain: mesh.Mesh) -> float:
    """Assemble the volume of a mesh with FEniCSx, in cubed coordinate units."""
    one = fem.Constant(domain, 1.0)
    return float(fem.assemble_scalar(fem.form(one * ufl.dx(domain=domain))))


def solve_with_petsc(domain: mesh.Mesh) -> float:
    """Solve u - div(grad(u)) = 1 with natural boundary conditions using a PETSc LU solver.

    The exact solution is u = 1, which first-order elements represent exactly.
    Returns the largest absolute deviation of the computed solution from 1.
    """
    function_space = fem.functionspace(domain, ("Lagrange", 1))
    trial = ufl.TrialFunction(function_space)
    test = ufl.TestFunction(function_space)
    bilinear_form = (trial * test + ufl.inner(ufl.grad(trial), ufl.grad(test))) * ufl.dx
    linear_form = fem.Constant(domain, 1.0) * test * ufl.dx
    problem = LinearProblem(
        bilinear_form,
        linear_form,
        petsc_options_prefix="smoke_check_",
        petsc_options={"ksp_type": "preonly", "pc_type": "lu"},
    )
    solution = problem.solve()
    return float(np.max(np.abs(solution.x.array - 1.0)))


def cells_written_to_hdf5(domain: mesh.Mesh, directory: Path) -> int:
    """Write the mesh to an XDMF/HDF5 file with FEniCSx and return the cell count h5py reads back."""
    xdmf_path = directory / "cube.xdmf"
    with io.XDMFFile(domain.comm, str(xdmf_path), "w") as xdmf_file:
        xdmf_file.write_mesh(domain)
    with h5py.File(xdmf_path.with_suffix(".h5"), "r") as hdf5_file:
        return hdf5_file[f"Mesh/{domain.name}/topology"].shape[0]


def main() -> None:
    """Print installed versions, then fail unless every numerical check succeeds."""
    print(f"architecture: {platform.machine()}")
    print(f"dolfinx: {dolfinx.__version__}")
    print(f"dtcc-core: {version('dtcc-core')}")
    print(f"dtcc-sim: {dtcc_sim.__version__}")
    print(f"dtcc-tetgen-wrapper: {version('dtcc-tetgen-wrapper')}")

    if not is_tetgen_available():
        raise SystemExit("Core cannot import the TetGen wrapper")

    duplicated = packages_not_from_conda()
    if duplicated:
        raise SystemExit(f"Installed by pip, bundling a second native library: {', '.join(duplicated)}")

    points, tetrahedra = tetrahedralize_unit_cube()
    if len(tetrahedra) == 0:
        raise SystemExit("TetGen returned no tetrahedra")

    domain = create_domain(points, tetrahedra)
    volume = mesh_volume(domain)
    if abs(volume - 1.0) > 1e-10:
        raise SystemExit(f"Expected a unit cube volume of 1.0, got {volume}")

    deviation = solve_with_petsc(domain)
    if deviation > 1e-10:
        raise SystemExit(f"PETSc solution deviates from the exact value 1.0 by {deviation}")

    with tempfile.TemporaryDirectory() as directory:
        cells_read = cells_written_to_hdf5(domain, Path(directory))
    if cells_read != len(tetrahedra):
        raise SystemExit(f"Expected {len(tetrahedra)} cells in the HDF5 file, read {cells_read}")

    print(f"TetGen tetrahedra: {len(tetrahedra)}; FEniCSx volume: {volume}")
    print(f"PETSc deviation from exact solution: {deviation:.1e}; HDF5 cells read back: {cells_read}")
    print("Smoke check passed")


if __name__ == "__main__":
    main()
