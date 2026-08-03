"""Optional Prefect orchestration for the monthly detection run.

The CLI + cron (detection/cli.py) is the pilot's scheduler; Prefect is
for deployments that want retries, observability, and a run UI. It is
deliberately an optional extra (mapencroach[orchestration]) so the core
platform never depends on an orchestrator: `build_monthly_flow()`
returns a Prefect flow when prefect is installed and raises a clear
error when it is not.
"""

from datetime import UTC, datetime
from typing import Any


def build_monthly_flow():
    """Construct the monthly ingest+screen Prefect flow.

    Returns a `@flow`-decorated callable taking the same arguments as
    the CLI's `run` subcommand (db_url, current scene id, AOI, live).
    """
    try:
        from prefect import flow, task
    except ImportError as exc:
        raise RuntimeError(
            "Prefect orchestration requires the optional extra: "
            "pip install 'mapencroach[orchestration]'. The cron-able CLI "
            "(python -m mapencroach.detection.cli) needs no extras."
        ) from exc

    from mapencroach.db.store import create_database_store
    from mapencroach.detection.run import run_detection

    @task(retries=2, retry_delay_seconds=300)
    def screen(db_url: str, current_scene_id: str, aoi: str, live: bool) -> dict[str, Any]:
        store = create_database_store(db_url)
        summary = run_detection(
            store,
            current_scene_id=current_scene_id,
            aoi_jurisdiction_id=aoi,
            live=live,
            actor="prefect-monthly",
        )
        return {
            "run_id": summary.run_id,
            "parcels_screened": summary.parcels_screened,
            "candidates": summary.candidates,
            "alerts_created": summary.alerts_created,
            "finished_at": datetime.now(UTC).isoformat(),
        }

    @flow(name="mapencroach-monthly-detection")
    def monthly_detection(
        db_url: str, current_scene_id: str, aoi: str, live: bool = False
    ) -> dict[str, Any]:
        return screen(db_url, current_scene_id, aoi, live)

    return monthly_detection
