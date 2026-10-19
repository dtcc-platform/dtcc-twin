#!/bin/sh
# Builds the Engine's dev target and checks two hosts of it in their own Compose project, so a running
# `pnpm dev:engine` is left alone. Each phase in host_checks runs on its own; between phases this script stops and
# starts one host's services. Both hosts run on this machine, so its timings are not those of hosts on separate
# machines; on Apple silicon, the image also runs under emulation.
set -eu
cd "$(dirname "$0")"
compose() { docker compose --project-name dtcc-twin-engine-hosts --file host_checks/compose.yaml "$@"; }
phase() { compose run --rm -T checks python -m pytest -p no:cacheprovider -rs --rootdir /checks "/checks/$1"; }
trap 'compose down --volumes --rmi local --remove-orphans' EXIT

compose build
ENGINE_IMAGE_DIGEST=$(docker image inspect --format '{{.Id}}' dtcc-twin-engine-hosts-entry)
export ENGINE_IMAGE_DIGEST
compose up --detach --wait redis entry entry-worker remote remote-worker
phase test_1_hosts_up.py
# Phase 1 holds the measurements, and later phases replace the remote worker, so the peaks are read now.
machine=$(docker info --format '{{.NCPU}} CPUs, {{.MemTotal}} bytes of memory, {{.OperatingSystem}}')
echo "Measured on one machine: $machine, host $(uname -sm)"
for service in entry entry-worker remote remote-worker; do
    echo "$service: peak memory through phase 1 $(compose exec -T "$service" cat /sys/fs/cgroup/memory.peak) bytes"
done
compose stop remote-worker
phase test_2_remote_worker_stopped.py
# Not set on the command line of `compose`, a function, after which a POSIX shell keeps the assignment.
export REMOTE_WORKER_DIGEST="sha256:$(printf '%064d' 0)"
compose up --detach remote-worker
phase test_3_remote_worker_of_another_image.py
unset REMOTE_WORKER_DIGEST
compose up --detach remote-worker
compose stop remote
phase test_4_remote_api_stopped.py
compose up --detach --wait remote
phase test_5_jobs_held_on_both_hosts.py
compose kill remote-worker
compose start remote-worker
phase test_6_remote_worker_lost.py

for host in entry remote; do
    echo "$host: packages $(compose exec -T "$host" du -sb /var/lib/dtcc-engine/packages)"
done
compose run --rm -T checks python -m json.tool /state/measurements.json
