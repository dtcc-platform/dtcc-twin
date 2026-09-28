# Local development image for DTCC Engine, not a deployment artifact; see DESIGN.md.
# It bundles AGPL-3.0 TetGen through dtcc-tetgen-wrapper: review licensing before publishing it.
# To change a pinned version, edit its default here; `pnpm engine:check` always builds with these defaults.
FROM condaforge/miniforge3:26.7.2-0

# Packages linking GDAL, PROJ or HDF5 come from conda-forge so one copy of each library is shared;
# their pip wheels bundle their own. h5py matches Core's exact pin. binutils provides the unprefixed
# `ar` that CMake looks for, which `compilers` does not.
RUN mamba create -y -n engine -c conda-forge \
        python=3.12 \
        fenics-dolfinx=0.11.0 \
        petsc4py=3.25.5 \
        mpich=5.0.1 \
        fiona \
        rasterio \
        pyproj \
        pyogrio \
        h5py=3.16.0 \
        compilers \
        binutils \
        cmake \
        ninja \
        git \
    && mamba clean -afy

# Activation sets the conda compiler and data-path variables that native builds and GDAL need.
SHELL ["conda", "run", "--no-capture-output", "-n", "engine", "/bin/bash", "-c"]

ARG TETGEN_WRAPPER_COMMIT=22ab9ff2ee1dd03f82ce24dd0f378f00da7e487c
RUN pip install --no-cache-dir \
    "dtcc-tetgen-wrapper @ git+https://github.com/dtcc-platform/dtcc-tetgen-wrapper.git@${TETGEN_WRAPPER_COMMIT}"

# Sim pins the Core commit it is tested with, so Core is not pinned separately.
ARG DTCC_SIM_COMMIT=2422bbafac6ef07466ca1bcd6905bbd99a8c2ecf
RUN pip install --no-cache-dir \
    "dtcc-sim @ git+https://github.com/dtcc-platform/dtcc-sim.git@${DTCC_SIM_COMMIT}"

ENV PYTHONUNBUFFERED=1
WORKDIR /app
COPY smoke_check.py .

# `conda run` does not forward SIGTERM to its child, so activate and exec under the base image's tini.
ENTRYPOINT ["tini", "--", "/bin/bash", "-c", "source /opt/conda/etc/profile.d/conda.sh && conda activate engine && exec \"$@\"", "engine"]
CMD ["python", "smoke_check.py"]
