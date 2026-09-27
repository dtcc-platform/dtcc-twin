# Records the fake engine's fixtures from real dtcc-core and dtcc-sim; see record.py.
FROM ghcr.io/astral-sh/uv:0.9.30-python3.12-bookworm-slim

# Core compiles C++ extensions, and dtcc-mesher installs from Git.
RUN apt-get update \
  && apt-get install -y --no-install-recommends build-essential git \
  && rm -rf /var/lib/apt/lists/*

ARG DTCC_CORE_REV=9b4e9b937bf4ae906832626bc63e5831e0bb151c
ARG DTCC_SIM_REV=2422bbafac6ef07466ca1bcd6905bbd99a8c2ecf

WORKDIR /src
RUN git clone https://github.com/dtcc-platform/dtcc-core.git \
  && git -C dtcc-core checkout "$DTCC_CORE_REV" \
  && git clone https://github.com/dtcc-platform/dtcc-sim.git \
  && git -C dtcc-sim checkout "$DTCC_SIM_REV"

WORKDIR /src/dtcc-core
RUN uv sync --frozen --no-dev
# Sim pins an older Core revision; install it without dependencies so it registers against this Core.
RUN uv pip install --no-deps /src/dtcc-sim

COPY record.py /src/record.py
CMD ["uv", "run", "--frozen", "--no-dev", "python", "/src/record.py", "/out"]
