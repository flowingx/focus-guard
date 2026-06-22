#!/usr/bin/env python3
"""Optional local screenshot redactor for Focus Guard.

Reads {"image_base64": "..."} from stdin and writes
{"ok": true, "image_base64": "..."} to stdout.
"""

from __future__ import annotations

import argparse
import base64
import io
import json
import os
import re
import sys
import tempfile
from pathlib import Path


SENSITIVE_PATTERNS = [
    re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}"),
    re.compile(r"(?<!\d)(?:\+?86[- ]?)?1[3-9]\d{9}(?!\d)"),
    re.compile(r"(?<![A-Za-z0-9])\d{17}[\dXx](?![A-Za-z0-9])"),
    re.compile(r"(?<!\d)(?:\d[ -]?){13,19}(?!\d)"),
    re.compile(r"(?i)(sk|rk|ak|api[_-]?key|token|secret|bearer)[A-Za-z0-9_\-:.=]{8,}"),
    re.compile(r"\b\d{4,8}\b"),
]


def fail(message: str) -> int:
    sys.stdout.write(json.dumps({"ok": False, "error": message}, ensure_ascii=False))
    return 0


def bbox_from_points(points):
    xs = [float(point[0]) for point in points]
    ys = [float(point[1]) for point in points]
    return int(min(xs)), int(min(ys)), int(max(xs)), int(max(ys))


def project_root() -> Path:
    return Path(__file__).resolve().parents[1]


def default_cnocr_model_dir() -> Path:
    return project_root() / "models" / "doc-densenet_lite_136-gru"


def cnocr_items(image_path: Path, model_dir: str | None = None):
    try:
        from cnocr import CnOcr
    except Exception as exc:  # pragma: no cover - optional dependency
        raise RuntimeError(f"cnocr unavailable: {exc}") from exc

    model_path = Path(model_dir or os.environ.get("FOCUS_GUARD_CNOCR_MODEL_DIR") or default_cnocr_model_dir())
    candidates = []
    if model_path.exists():
        candidates.append(
            {
                "rec_model_name": "densenet_lite_136-gru",
                "rec_root": str(model_path.parent),
            }
        )
        candidates.append(
            {
                "rec_model_name": model_path.name,
                "rec_root": str(model_path.parent),
            }
        )
    candidates.append({})

    last_error = None
    for kwargs in candidates:
        try:
            ocr = CnOcr(**kwargs)
            break
        except Exception as exc:  # pragma: no cover - depends on local model layout
            last_error = exc
    else:
        raise RuntimeError(f"cnocr init failed: {last_error}")
    rows = ocr.ocr(str(image_path))
    items = []
    for row in rows:
        text = str(row.get("text", "") if isinstance(row, dict) else "")
        points = row.get("position") if isinstance(row, dict) else None
        if text and points is not None:
            items.append((text, bbox_from_points(points)))
    return items


def easyocr_items(image_path: Path):
    try:
        import easyocr
    except Exception as exc:  # pragma: no cover - optional dependency
        raise RuntimeError(f"easyocr unavailable: {exc}") from exc

    reader = easyocr.Reader(["ch_sim", "en"], gpu=False)
    rows = reader.readtext(str(image_path))
    return [(str(text), bbox_from_points(points)) for points, text, _confidence in rows]


def should_redact(text: str) -> bool:
    compact = text.strip()
    if not compact:
        return False
    return any(pattern.search(compact) for pattern in SENSITIVE_PATTERNS)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--backend", choices=["cnocr", "easyocr", "presidio"], required=True)
    parser.add_argument("--cnocr-model-dir", default=None)
    parser.add_argument("--redact-all-text", action="store_true")
    args = parser.parse_args()

    try:
        payload = json.load(sys.stdin)
        image_bytes = base64.b64decode(payload["image_base64"])
        from PIL import Image, ImageDraw
    except Exception as exc:
        return fail(f"invalid input or missing pillow: {exc}")

    image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tmp:
        image.save(tmp.name)
        image_path = Path(tmp.name)

    try:
        if args.backend == "cnocr":
            items = cnocr_items(image_path, args.cnocr_model_dir)
        elif args.backend == "easyocr":
            items = easyocr_items(image_path)
        else:
            return fail("presidio backend is not bundled yet")
    except Exception as exc:
        return fail(str(exc))
    finally:
        try:
            image_path.unlink()
        except OSError:
            pass

    draw = ImageDraw.Draw(image)
    redacted_count = 0
    for text, (left, top, right, bottom) in items:
        if args.redact_all_text or should_redact(text):
            padding = 4
            draw.rectangle(
                (
                    max(0, left - padding),
                    max(0, top - padding),
                    min(image.width, right + padding),
                    min(image.height, bottom + padding),
                ),
                fill=(18, 18, 18),
            )
            redacted_count += 1

    out = io.BytesIO()
    image.save(out, format="PNG", optimize=True)
    sys.stdout.write(
        json.dumps(
            {
                "ok": True,
                "image_base64": base64.b64encode(out.getvalue()).decode("ascii"),
                "redacted_count": redacted_count,
                "backend": args.backend,
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
