"""Concurrency stress tests for Store's audit chain and ID sequences.

app.py's mutating handlers are sync `def`s, so FastAPI runs them on a
threadpool sharing a single Store instance with no locking. Without a
lock, record_audit's non-atomic read-prev-hash-then-append can interleave
across threads and produce a chain where entry N+1's prev_hash doesn't
match entry N's row_hash -- verify_chain then (wrongly) reports tampering
for legitimate concurrent traffic. Similarly, next_alert_id/next_case_id's
non-atomic `+=` can hand out duplicate ids that silently overwrite each
other.

The race windows here are narrow enough that CPython's GIL scheduling can
hide them under default settings even with many threads/iterations (we
verified this empirically: 8x50 and even 32x200 at the default switch
interval passed every time pre-fix). To make these tests reliably catch a
regression rather than passing by luck, we shrink the GIL switch interval
for the duration of the module -- a standard technique for exercising
races in threading tests, not a change to production behavior.
"""

import sys
import threading
from concurrent.futures import ThreadPoolExecutor

import pytest

from mapencroach.api.store import Store
from mapencroach.audit.chain import verify_chain

N_THREADS = 32
ITERATIONS = 150


@pytest.fixture(autouse=True)
def _aggressive_gil_switching():
    original = sys.getswitchinterval()
    sys.setswitchinterval(1e-6)
    try:
        yield
    finally:
        sys.setswitchinterval(original)


def test_concurrent_record_audit_and_next_alert_id_stay_consistent():
    store = Store()
    barrier = threading.Barrier(N_THREADS)
    ids_lock = threading.Lock()
    alert_ids: list[str] = []

    def worker(thread_idx: int) -> None:
        barrier.wait()
        for i in range(ITERATIONS):
            store.record_audit(
                actor=f"worker-{thread_idx}",
                action="stress.test",
                object_type="thing",
                object_id=f"{thread_idx}-{i}",
            )
            alert_id = store.next_alert_id()
            with ids_lock:
                alert_ids.append(alert_id)

    with ThreadPoolExecutor(max_workers=N_THREADS) as pool:
        futures = [pool.submit(worker, i) for i in range(N_THREADS)]
        for f in futures:
            f.result()

    result = verify_chain(store.audit_chain)
    assert result.ok, f"audit chain broke at index {result.first_bad_index}"
    assert len(store.audit_chain) == N_THREADS * ITERATIONS

    assert len(alert_ids) == N_THREADS * ITERATIONS
    assert len(set(alert_ids)) == len(alert_ids), "duplicate alert ids were issued"


def test_concurrent_next_case_id_never_duplicates():
    store = Store()
    barrier = threading.Barrier(N_THREADS)
    ids_lock = threading.Lock()
    case_ids: list[str] = []

    def worker(_thread_idx: int) -> None:
        barrier.wait()
        for _ in range(ITERATIONS):
            case_id = store.next_case_id()
            with ids_lock:
                case_ids.append(case_id)

    with ThreadPoolExecutor(max_workers=N_THREADS) as pool:
        futures = [pool.submit(worker, i) for i in range(N_THREADS)]
        for f in futures:
            f.result()

    assert len(case_ids) == N_THREADS * ITERATIONS
    assert len(set(case_ids)) == len(case_ids), "duplicate case ids were issued"
