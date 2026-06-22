#!/usr/bin/env python3
"""Minimal Focus Guard CnOCR redactor smoke test.

It generates a tiny local image, runs tools/privacy_redactor.py through the same
stdin/stdout sidecar contract as the Rust backend, and writes only the redacted
preview to logs/cnocr_redactor_verify.png.
"""

from __future__ import annotations

import argparse
import base64
import io
import json
import os
import subprocess
import sys
from pathlib import Path


def project_root() -> Path:
    return Path(__file__).resolve().parents[1]


def make_test_image_b64() -> str:
    from PIL import Image, ImageDraw

    image = Image.new("RGB", (760, 220), (248, 250, 252))
    draw = ImageDraw.Draw(image)
    draw.text((28, 28), "Focus Guard CnOCR verify", fill=(15, 23, 42))
    draw.text((28, 82), "email: test@example.com", fill=(15, 23, 42))
    draw.text((28, 136), "phone: 13800138000", fill=(15, 23, 42))
    out = io.BytesIO()
    image.save(out, format="PNG")
    return base64.b64encode(out.getvalue()).decode("ascii")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--python", default=os.environ.get("FOCUS_GUARD_REDACTOR_PYTHON") or sys.executable)
    parser.add_argument(
        "--cnocr-model-dir",
        default=os.environ.get("FOCUS_GUARD_CNOCR_MODEL_DIR")
        or str(project_root() / "models" / "doc-densenet_lite_136-gru"),
    )
    args = parser.parse_args()

    root = project_root()
    script = root / "tools" / "privacy_redactor.py"
    output_path = root / "logs" / "cnocr_redactor_verify.png"
    output_path.parent.mkdir(exist_ok=True)

    payload = json.dumps({"image_base64": make_test_image_b64()})
    command = [
        args.python,
        str(script),
        "--backend",
        "cnocr",
        "--cnocr-model-dir",
        args.cnocr_model_dir,
        "--redact-all-text",
    ]
    result = subprocess.run(
        command,
        input=payload,
        capture_output=True,
        text=True,
        cwd=root,
        timeout=120,
        check=False,
    )

    report = {
        "ok": False,
        "python": args.python,
        "model_dir": args.cnocr_model_dir,
        "model_dir_exists": Path(args.cnocr_model_dir).exists(),
        "output": str(output_path),
    }
    if result.returncode != 0:
        report["error"] = (result.stderr or result.stdout).strip()
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return 1

    try:
        data = json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        report["error"] = f"invalid redactor JSON: {exc}"
        report["stdout"] = result.stdout[:1000]
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return 1

    report["redactor_ok"] = data.get("ok") is True
    report["redacted_count"] = data.get("redacted_count", 0)
    if data.get("ok") is not True:
        report["error"] = data.get("error", "redactor failed")
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return 1

    image_bytes = base64.b64decode(data["image_base64"])
    output_path.write_bytes(image_bytes)
    report["ok"] = True
    report["output_bytes"] = len(image_bytes)
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
