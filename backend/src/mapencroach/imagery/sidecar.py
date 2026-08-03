"""Cartosat sidecar metadata parsing — the original file is the evidence.

USAC delivers scene metadata as a sidecar .txt (key = value lines) or
.xml alongside each GeoTIFF. Courts scrutinize ephemeris, sensor angles
and timestamps, so the raw bytes are preserved verbatim and hashed;
parsing only produces a convenience view and never replaces the
original. An unparseable sidecar is therefore not an error — the raw
file still rides along, flagged as unparsed.
"""

import hashlib
import xml.etree.ElementTree as ET
from dataclasses import dataclass

from defusedxml.ElementTree import fromstring as safe_fromstring


@dataclass(frozen=True)
class SidecarRecord:
    raw: str
    sha256: str
    fields: dict[str, str]
    format: str  # "keyvalue" | "xml" | "unparsed"


def _parse_keyvalue(text: str) -> dict[str, str]:
    fields: dict[str, str] = {}
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        for separator in ("=", ":"):
            if separator in line:
                key, _, value = line.partition(separator)
                key, value = key.strip(), value.strip()
                if key:
                    fields[key] = value
                break
    return fields


def _flatten_xml(element: ET.Element, prefix: str, fields: dict[str, str]) -> None:
    children = list(element)
    tag = element.tag.split("}")[-1]  # drop namespace
    path = f"{prefix}.{tag}" if prefix else tag
    if not children:
        text = (element.text or "").strip()
        if text:
            fields[path] = text
        return
    for child in children:
        _flatten_xml(child, path, fields)


def _parse_xml(text: str) -> dict[str, str]:
    root = safe_fromstring(text)
    fields: dict[str, str] = {}
    for child in list(root) or [root]:
        _flatten_xml(child, "", fields)
    return fields


def parse_sidecar(raw: bytes) -> SidecarRecord:
    """Parse a sidecar file, always preserving the original bytes + hash."""
    sha256 = hashlib.sha256(raw).hexdigest()
    text = raw.decode("utf-8", errors="replace")
    stripped = text.lstrip()

    if stripped.startswith("<"):
        try:
            return SidecarRecord(
                raw=text, sha256=sha256, fields=_parse_xml(text), format="xml"
            )
        except Exception:  # noqa: BLE001 - malformed XML must not block evidence ingest
            return SidecarRecord(raw=text, sha256=sha256, fields={}, format="unparsed")

    fields = _parse_keyvalue(text)
    if fields:
        return SidecarRecord(raw=text, sha256=sha256, fields=fields, format="keyvalue")
    return SidecarRecord(raw=text, sha256=sha256, fields={}, format="unparsed")
