# Agent tools: where each one runs after the migration

> **Superseded for phase 1 (2026-11-07).** Phase 1 follows the [phase 1 design](phase-1-design.md) and [plan](phase-1-plan.md). The tool-server design below is deferred to phase 3 and kept for reference; parts of it may change when phase 3 is planned. Vasilis's review of it is on dtcc-twin#18.

Draft, revised 2026-11-03. The 22 tools of `dtcc-agent` (`dtcc_agent/server.py`, develop `11f20bb`)
and where each runs under [ADR-0002](../adr/0002-agent-tools-run-in-a-tool-server-from-the-engine-image.md).
"Tool server" is `dtcc-agent`'s server ported into `apps/engine`; its tools keep their code and
behaviour unless a row says otherwise.

| Tool                                                                                                    | Runs in                   | How                                                                                                                                                |
| ------------------------------------------------------------------------------------------------------- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `geocode`                                                                                               | Tool server               | As today                                                                                                                                           |
| `list_operations`, `describe_operation`                                                                 | Tool server               | As today: its own catalogue of Core operations, at Engine's Core pin                                                                               |
| `get_buildings`, `run_operation` on `datasets.*`                                                        | Tool server               | In process behind the disk cache, as today (D10). Buildings work this way; as Engine jobs they would wait for dtcc-core#160                        |
| `run_operation` on builders                                                                             | Tool server               | As today, including builders with several results                                                                                                  |
| `list_objects`, `delete_object`, `inspect_object`, `get_field_names`, `object_to_text`, `spatial_query` | Tool server               | As today, within the calling Session                                                                                                               |
| `export_object`, `render_object`                                                                        | Tool server               | As today; the backend copies the file into the Chat ([ADR-0003](../adr/0003-artifacts-are-made-in-the-tool-server.md))                             |
| `list_simulations`, `get_simulation_schema`                                                             | Backend                   | Engine discovery (`GET /api/v1/datasets`)                                                                                                          |
| `run_simulation`                                                                                        | Backend                   | The `jobs` service submits it as the user's job and returns at once; the UI shows its progress, and completion resumes the conversation (D11, D21) |
| `get_run_status` (new)                                                                                  | Backend                   | Reads the simulation's job through the `jobs` service                                                                                              |
| `get_run_summary`, `list_past_runs`                                                                     | Backend                   | Run records in Postgres (D17)                                                                                                                      |
| `compare_scenarios`                                                                                     | Backend                   | Starts both simulations and returns two Run references                                                                                             |
| `load_run_result` (new)                                                                                 | Backend, then tool server | Checks the Run is this Chat's and its job the user's own and completed, then calls the tool server's `load_job_package` with the job id (D9)       |
| `compare_runs` (new)                                                                                    | Backend, then tool server | Loads both Runs as above, then calls the tool server's `compare_objects`, which compares fields as `dtcc_agent/analysis.py` does today             |
| `load_geojson`, `query_geojson`, `summarize_geojson_property`                                           | **Dropped** (D29)         | They read the results folder shared with dtcc-sim, unused since simulations run on Engine                                                          |

The model sees 22 tools as one list: 13 from the tool server and 9 from the backend. The tool server's `load_job_package(job_id)` and `compare_objects(a, b)` are called only by the backend and are not in the model's list. Arguments that name a
Run are Run references from the Chat's records, which the backend turns into checked job ids; the
model never handles raw Engine job ids.

## Open

- **Downloads as Engine jobs** behind the tool server's disk cache, instead of in process (D10).
  Measured 2026-11-03 in the [decision log](decisions.md#facts-checked): a fresh download costs about
  the same either way; the cache is what matters. Needs no Engine change.
- **Core pin.** Engine pins `17c6efe` (2026-10-01), 11 commits behind the tool server's `a78df16`,
  which carries the `source_bounds` the crop relies on. Engine's pin moves to `a78df16` first (E0),
  and the two move together from then on.
