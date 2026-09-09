"""Bounded public COG reads through HTTPX, never GDAL's redirecting URL reader."""
import io
import re
import time
from dataclasses import dataclass, field

import httpx

TIFF_TYPES = {"image/tiff", "image/geotiff", "application/octet-stream", "binary/octet-stream"}


def is_tiff_response(response):
    return response.headers.get("content-type", "").split(";", 1)[0].lower() in TIFF_TYPES


@dataclass
class ReadBudget:
    deadline: float = field(default_factory=lambda: time.monotonic() + 35)
    remaining_bytes: int = 64 * 1024 * 1024
    remaining_requests: int = 160

    def check(self):
        if time.monotonic() >= self.deadline or self.remaining_requests <= 0:
            raise OSError("Imagery search limit reached")

    def request(self):
        self.check()
        self.remaining_requests -= 1


class RangeReader(io.RawIOBase):
    """Seekable, fixed-object range reader with no redirects or credentials.

    Only the caller's validated server-owned asset URL reaches this class.
    Content is pinned with If-Match for the lifetime of this reader.
    """

    def __init__(self, url: str, client: httpx.Client, budget: ReadBudget):
        self.url, self.client, self.budget = url, client, budget
        self.position = 0
        self.cache: dict[int, bytes] = {}
        budget.request()
        response = client.head(url, follow_redirects=False)
        if response.status_code != 200 or not is_tiff_response(response):
            raise OSError("COG metadata unavailable")
        self.length = int(response.headers.get("content-length", "0"))
        self.etag = response.headers.get("etag")
        if not 0 < self.length <= 1024 * 1024 * 1024 or not self.etag:
            raise OSError("COG size or identity unavailable")

    def readable(self):
        return True

    def seekable(self):
        return True

    def tell(self):
        return self.position

    def seek(self, offset, whence=io.SEEK_SET):
        position = offset + (self.position if whence == io.SEEK_CUR else
                             self.length if whence == io.SEEK_END else 0)
        if position < 0:
            raise OSError("Invalid COG offset")
        self.position = position
        return position

    def read(self, size=-1):
        self.budget.check()
        size = self.length - self.position if size < 0 else size
        if size > 8 * 1024 * 1024:
            raise OSError("COG read too large")
        stop = min(self.position + size, self.length)
        parts = []
        while self.position < stop:
            block = self.position // 65536
            if block not in self.cache:
                start = block * 65536
                end = min(start + 65535, self.length - 1)
                expected = end - start + 1
                self.budget.request()
                with self.client.stream("GET", self.url, follow_redirects=False, headers={
                    "Range": f"bytes={start}-{end}", "If-Match": self.etag,
                    "Accept-Encoding": "identity",
                }) as response:
                    content_range = response.headers.get("content-range", "")
                    match = re.fullmatch(r"bytes (\d+)-(\d+)/(\d+)", content_range)
                    if (response.status_code != 206 or not match or not is_tiff_response(response)
                            or tuple(map(int, match.groups())) != (start, end, self.length)
                            or response.headers.get("etag") != self.etag):
                        raise OSError("COG range or identity changed")
                    data = bytearray()
                    for chunk in response.iter_bytes(chunk_size=65536):
                        self.budget.check()
                        self.budget.remaining_bytes -= len(chunk)
                        data.extend(chunk)
                        if len(data) > expected or self.budget.remaining_bytes < 0:
                            raise OSError("COG byte limit reached")
                    if len(data) != expected:
                        raise OSError("Incomplete COG range")
                    self.cache[block] = bytes(data)
            offset = self.position % 65536
            piece = self.cache[block][offset:offset + stop - self.position]
            parts.append(piece)
            self.position += len(piece)
        return b"".join(parts)

    def close(self):
        self.cache.clear()
        super().close()
