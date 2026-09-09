import time

import httpx
import numpy as np
import pytest
from rasterio.warp import transform_geom

from mapencroach.imagery.clear_view import CogInspector
from mapencroach.imagery.cog_reader import RangeReader, ReadBudget
from test_clear_view import GEOMETRY, candidate, raster


def transport(data, *, redirect=False, changed=False, oversized=False, html=False):
    def handle(request):
        content = data[request.url.path.rsplit("/", 1)[-1]]
        headers = {"etag": '"stable"', "content-length": str(len(content)),
                   "content-type": "image/tiff"}
        if redirect:
            return httpx.Response(302, headers={"location": "http://127.0.0.1/private"})
        if request.method == "HEAD":
            return httpx.Response(200, headers=headers)
        if html:
            headers["content-type"] = "text/html"
        start, end = map(int, request.headers["range"].removeprefix("bytes=").split("-"))
        headers["content-range"] = f"bytes {start}-{end}/{len(content)}"
        if changed:
            headers["etag"] = '"different"'
        chunk = content[start:end + 1] + (b"extra" if oversized else b"")
        headers["content-length"] = str(len(chunk))
        return httpx.Response(206, headers=headers, content=chunk)
    return httpx.MockTransport(handle)


def test_seekable_range_reads_are_cached_and_bounded():
    data = bytes(range(256)) * 600
    budget = ReadBudget()
    with httpx.Client(transport=transport({"SCL.tif": data})) as client:
        reader = RangeReader("https://example.test/SCL.tif", client, budget)
        assert reader.read(20) == data[:20]
        after = budget.remaining_requests
        reader.seek(5)
        assert reader.read(10) == data[5:15]
        assert budget.remaining_requests == after
        reader.seek(-20, 2)
        assert reader.read(100) == data[-20:]
        with pytest.raises(OSError):
            reader.read(9 * 1024 * 1024)


@pytest.mark.parametrize("failure", ["redirect", "changed", "oversized", "html"])
def test_redirect_and_changed_or_excessive_bytes_fail_closed(failure):
    with httpx.Client(transport=transport({"SCL.tif": b"some bytes"}, **{failure: True})) as client:
        with pytest.raises(OSError):
            RangeReader("https://example.test/SCL.tif", client, ReadBudget()).read(10)


def test_deadline_and_byte_budget_stop_reads():
    with httpx.Client(transport=transport({"SCL.tif": b"some bytes"})) as client:
        with pytest.raises(OSError):
            RangeReader("https://example.test/SCL.tif", client,
                        ReadBudget(deadline=time.monotonic() - 1))
        with pytest.raises(OSError):
            RangeReader("https://example.test/SCL.tif", client,
                        ReadBudget(remaining_bytes=1)).read(10)


def test_real_gdal_opener_checks_mask_then_renders_same_scene(monkeypatch):
    with raster(np.full((4, 4), 4, dtype="uint8")) as scl:
        scl_bytes = scl.read()
    with raster(np.full((3, 8, 8), 90, dtype="uint8"), 10) as rgb:
        rgb_bytes = rgb.read()
    client = httpx.Client(transport=transport({"SCL.tif": scl_bytes, "TCI.tif": rgb_bytes}))
    monkeypatch.setattr("mapencroach.imagery.clear_view.httpx.Client", lambda **kwargs: client)
    geometry = transform_geom("EPSG:32643", "EPSG:4326", GEOMETRY)
    result = CogInspector().inspect(candidate(), geometry, ReadBudget())
    assert result["clear"] is True
    assert result["sampled_pixels"] == 9
    assert result["image_base64"].startswith("iVBOR")
