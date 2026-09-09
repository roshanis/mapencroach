from copy import deepcopy
from threading import Event, Thread

from fastapi.testclient import TestClient

from mapencroach.api.app import create_app
from mapencroach.api.auth import Role
from mapencroach.api.store import Store
from test_api_scenes import auth_headers, token_for


class ClearSearch:
    def __init__(self, callback=None):
        self.calls = 0
        self.callback = callback

    def search(self, geometry, *, end):
        self.calls += 1
        if self.callback:
            self.callback()
        return {"status": "no_clear", "checked_scenes": 0}


def client_and_headers(store, search):
    app = create_app(store, clear_view_service=search)
    headers = auth_headers(token_for("reader", Role.VIEWER, store.district_a_id))
    return TestClient(app), headers


def test_authorized_read_does_not_mutate_watchlist_or_registry():
    store = Store.seed_demo()
    before = deepcopy(store.watchlist)
    search = ClearSearch()
    client, headers = client_and_headers(store, search)
    response = client.get("/parcels/parcel-9/clear-imagery", headers=headers)
    assert response.status_code == 200
    assert response.headers["cache-control"] == "private, no-store"
    assert response.json()["parcel_id"] == "parcel-9"
    assert store.watchlist == before
    assert search.calls == 1


def test_unauthorized_and_missing_parcels_do_not_call_provider():
    store = Store.seed_demo()
    search = ClearSearch()
    client, headers = client_and_headers(store, search)
    assert client.get("/parcels/parcel-9/clear-imagery").status_code == 401
    assert client.get("/parcels/missing/clear-imagery", headers=headers).status_code == 404
    store.parcels["parcel-9"]["jurisdiction_id"] = "another-authority"
    assert client.get("/parcels/parcel-9/clear-imagery", headers=headers).status_code == 404
    assert search.calls == 0


def test_transfer_during_search_withholds_response():
    store = Store.seed_demo()
    def transfer():
        store.parcels["parcel-9"]["jurisdiction_id"] = "another-authority"
    client, headers = client_and_headers(store, ClearSearch(transfer))
    assert client.get("/parcels/parcel-9/clear-imagery", headers=headers).status_code == 404


def test_geometry_change_during_search_withholds_stale_crop():
    store = Store.seed_demo()
    def edit():
        store.parcels["parcel-9"]["geometry"]["coordinates"][0][0][0] += 0.01
    client, headers = client_and_headers(store, ClearSearch(edit))
    assert client.get("/parcels/parcel-9/clear-imagery", headers=headers).status_code == 409


def test_concurrent_searches_are_bounded_and_slots_are_released():
    store = Store.seed_demo()
    release = Event()
    first_started, second_started = Event(), Event()

    class BlockingSearch:
        calls = 0

        def search(self, geometry, *, end):
            self.calls += 1
            (first_started if self.calls == 1 else second_started).set()
            assert release.wait(5)
            return {"status": "no_clear"}

    client, first_headers = client_and_headers(store, BlockingSearch())
    second_headers = auth_headers(token_for("second", Role.VIEWER, store.district_a_id))
    third_headers = auth_headers(token_for("third", Role.VIEWER, store.district_a_id))
    responses = []
    def run(headers):
        responses.append(client.get("/parcels/parcel-9/clear-imagery", headers=headers))
    first = Thread(target=run, args=(first_headers,))
    second = Thread(target=run, args=(second_headers,))
    first.start()
    try:
        assert first_started.wait(3)
        duplicate = client.get("/parcels/parcel-9/clear-imagery", headers=first_headers)
        assert duplicate.status_code == 429
        second.start()
        assert second_started.wait(3)
        saturated = client.get("/parcels/parcel-9/clear-imagery", headers=third_headers)
        assert saturated.status_code == 429
    finally:
        release.set()
        first.join(5)
        if second.ident is not None:
            second.join(5)
    assert [r.status_code for r in responses] == [200, 200]
    assert client.get("/parcels/parcel-9/clear-imagery", headers=third_headers).status_code == 200
