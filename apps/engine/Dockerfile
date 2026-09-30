# DTCC Engine image: the `dev` target for local development and tests, `prod` for deployment; see DESIGN.md.
# It bundles AGPL-3.0 TetGen through dtcc-tetgen-wrapper: review licensing before publishing it.
# Conda packages are pinned by environment*.yml through `pnpm engine:lock`, Git dependencies by the build arguments below.
FROM condaforge/miniforge3:26.7.2-0 AS builder

ARG TARGETARCH
COPY conda-*.lock /locks/
# The build lock is the runtime lock plus the build-only tools, from one solve.
RUN case "$TARGETARCH" in amd64) platform=linux-64 ;; arm64) platform=linux-aarch64 ;; esac \
    && conda create --yes --name engine --file "/locks/conda-build-$platform.lock"

# Activation sets the conda compiler and data-path variables that native builds and GDAL need.
SHELL ["conda", "run", "--no-capture-output", "-n", "engine", "/bin/bash", "-c"]

ARG TETGEN_WRAPPER_COMMIT=22ab9ff2ee1dd03f82ce24dd0f378f00da7e487c
RUN pip install --no-cache-dir \
    "dtcc-tetgen-wrapper @ git+https://github.com/dtcc-platform/dtcc-tetgen-wrapper.git@${TETGEN_WRAPPER_COMMIT}"

# Sim pins the Core commit it is tested with, so Core is not pinned separately.
ARG DTCC_SIM_COMMIT=2422bbafac6ef07466ca1bcd6905bbd99a8c2ecf
RUN pip install --no-cache-dir \
    "dtcc-sim @ git+https://github.com/dtcc-platform/dtcc-sim.git@${DTCC_SIM_COMMIT}"

# Resolving Sim's dependencies fetches Core from Git again, so the Engine's dependencies are installed while Git is
# present; later stages install the Engine with --no-deps.
COPY pyproject.toml /engine/
RUN python -c "import tomllib; print(*tomllib.load(open('/engine/pyproject.toml', 'rb'))['project']['dependencies'], sep='\n')" \
        > /engine/requirements.txt \
    && pip install --no-cache-dir -r /engine/requirements.txt

# Removes the packages that only the build lock has; no runtime package depends on them.
SHELL ["/bin/bash", "-c"]
RUN case "$TARGETARCH" in amd64) platform=linux-64 ;; arm64) platform=linux-aarch64 ;; esac \
    && comm -23 <(grep '^https' "/locks/conda-build-$platform.lock" | sed 's/#.*//' | sort) \
        <(grep '^https' "/locks/conda-$platform.lock" | sed 's/#.*//' | sort) \
    | sed -E 's#.*/##; s/\.(conda|tar\.bz2)$//; s/-[^-]+-[^-]+$//' \
    | xargs conda remove --yes --name engine --force --offline

FROM condaforge/miniforge3:26.7.2-0 AS runtime
# Same base image and path as the builder: a conda environment contains absolute paths.
COPY --from=builder /opt/conda/envs/engine /opt/conda/envs/engine
ENV PYTHONUNBUFFERED=1
SHELL ["conda", "run", "--no-capture-output", "-n", "engine", "/bin/bash", "-c"]
# `conda run` does not forward SIGTERM to its child, so activate and exec under the base image's tini.
ENTRYPOINT ["tini", "--", "/bin/bash", "-c", "source /opt/conda/etc/profile.d/conda.sh && conda activate engine && exec \"$@\"", "engine"]
EXPOSE 8000
CMD ["uvicorn", "dtcc_engine.api:create_app_from_environment", "--factory", "--host", "0.0.0.0", "--port", "8000"]

FROM runtime AS dev
WORKDIR /app
COPY pyproject.toml ./
COPY dtcc_engine ./dtcc_engine
RUN pip install --no-cache-dir --no-deps -e . \
    && python -c "import tomllib; print(*tomllib.load(open('pyproject.toml', 'rb'))['project']['optional-dependencies']['test'], sep='\n')" \
        > /tmp/test-requirements.txt \
    && pip install --no-cache-dir -r /tmp/test-requirements.txt \
    && rm /tmp/test-requirements.txt
COPY tests ./tests

FROM runtime AS prod
# setuptools writes build files into the source tree; the writable mount discards them.
RUN --mount=type=bind,target=/src,rw pip install --no-cache-dir --no-deps /src \
    && useradd --create-home --uid 10001 engine
USER engine
WORKDIR /home/engine
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --start-interval=5s \
    CMD ["/opt/conda/envs/engine/bin/python", "-c", "import urllib.request; urllib.request.urlopen('http://localhost:8000/api/v1/health')"]
