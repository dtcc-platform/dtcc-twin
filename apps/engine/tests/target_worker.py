"""The worker service's Celery app with a test Dataset, for workers that tests start in processes of their own.

The Dataset, `engine_held_probe`, holds its job until the Redis key it names exists.
"""

import os
import time

import numpy as np
import redis
from dtcc_core.datasets import DatasetBaseArgs, DatasetDescriptor
from dtcc_core.model import Mesh

from dtcc_engine.worker import celery_app  # noqa: F401  The app that Celery's command line finds.


class HeldProbeArgs(DatasetBaseArgs):
    release_key: str


class HeldProbeDataset(DatasetDescriptor):
    name = "engine_held_probe"
    description = "Dataset defined by an Engine test that runs until a test releases it"
    ArgsModel = HeldProbeArgs

    def build(self, args):
        client = redis.Redis.from_url(os.environ["ENGINE_REDIS_URL"])
        while not client.exists(args.release_key):
            time.sleep(0.1)
        return Mesh(vertices=np.array([[0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0]]), faces=np.array([[0, 1, 2]]))
