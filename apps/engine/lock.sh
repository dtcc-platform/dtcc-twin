#!/bin/sh
# Solves the Engine's conda environment for both Linux platforms; run it through `pnpm engine:lock`.
set -eu
conda create --yes --quiet --prefix /tmp/conda-lock conda-lock=4.0.2
lock=/tmp/conda-lock/bin/conda-lock
"$lock" lock --file environment.yml --file environment-build.yml --platform linux-64 --platform linux-aarch64 --lockfile conda-lock.yml
"$lock" render --kind explicit --filename-template "conda-{platform}.lock" conda-lock.yml
"$lock" render --kind explicit --extras build --filename-template "conda-build-{platform}.lock" conda-lock.yml
