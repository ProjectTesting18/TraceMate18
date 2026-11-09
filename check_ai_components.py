
import json
import socket
import sys
import time
import urllib.error
import urllib.request
import uuid
import struct
import zlib
from pathlib import Path

BASE_URL = "http://127.0.0.1:8001"
BACKEND_HOST = "127.0.0.1"
BACKEND_PORT = 5000

results = []


def record(name, passed, details=""):
    status = "PASS" if passed else "FAIL"
    results.append((name, passed, details))
    print(f"[{status}] {name}" + (f" — {details}" if details else ""))


def get_json(path):
    request = urllib.request.Request(
        BASE_URL + path,
        headers={"Accept": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=90) as response:
        return json.loads(response.read().decode("utf-8"))


def post_json(path, payload):
    body = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        BASE_URL + path,
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=90) as response:
        return json.loads(response.read().decode("utf-8"))


def make_test_png(path, color):
    """Create a valid 128x128 PNG using only Python's standard library."""
    width = height = 128
    raw = b"".join(
        b"\x00" + bytes(color) * width
        for _ in range(height)
    )

    def chunk(kind, data):
        return (
            struct.pack(">I", len(data))
            + kind
            + data
            + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)
        )

    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw))
        + chunk(b"IEND", b"")
    )
    Path(path).write_bytes(png)


def post_multipart(path, fields, files):
    """Send multipart/form-data without requiring the requests package."""
    boundary = "----TraceMateCheck" + uuid.uuid4().hex
    body = bytearray()

    for name, value in fields.items():
        body.extend(f"--{boundary}\r\n".encode())
        body.extend(
            f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode()
        )
        body.extend(str(value).encode())
        body.extend(b"\r\n")

    for field_name, file_path in files.items():
        data = Path(file_path).read_bytes()
        body.extend(f"--{boundary}\r\n".encode())
        body.extend(
            (
                f'Content-Disposition: form-data; name="{field_name}"; '
                f'filename="{Path(file_path).name}"\r\n'
                "Content-Type: image/png\r\n\r\n"
            ).encode()
        )
        body.extend(data)
        body.extend(b"\r\n")

    body.extend(f"--{boundary}--\r\n".encode())

    request = urllib.request.Request(
        BASE_URL + path,
        data=bytes(body),
        headers={
            "Content-Type": f"multipart/form-data; boundary={boundary}",
            "Accept": "application/json",
        },
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=180) as response:
        return json.loads(response.read().decode("utf-8"))


def main():
    print("\n=== TraceMate AI Component Diagnostic ===\n")

    # 1. Check the Node.js backend port.
    try:
        with socket.create_connection(
            (BACKEND_HOST, BACKEND_PORT), timeout=3
        ):
            record("Node.js backend port 5000", True, "TCP connection works")
    except OSError as exc:
        record("Node.js backend port 5000", False, str(exc))

    # 2. Check FastAPI AI service.
    try:
        health = get_json("/health")
        record(
            "AI service /health",
            health.get("success") is True,
            f"status={health.get('status')}; service={health.get('service')}",
        )
        print("  Health response:")
        print(json.dumps(health, indent=2)[:3500])
    except Exception as exc:
        record("AI service /health", False, str(exc))
        print("\nAI service is not responding. Start it, then rerun this script.")
        finish()
        return

    # 3. Check computer-vision model status.
    try:
        cv = get_json("/cv/health")
        record(
            "Computer vision /cv/health",
            cv.get("success") is True,
            f"status={cv.get('status')}",
        )
        print("  CV model status:")
        print(json.dumps(cv, indent=2)[:3500])
    except Exception as exc:
        record("Computer vision /cv/health", False, str(exc))

    # 4. Exercise the text similarity model.
    try:
        data = post_json(
            "/nlp/text-similarity",
            {
                "text1": "Red OnePlus charging cable with white adapter",
                "text2": "One Plus red charger cable and white adaptor",
            },
        )
        record(
            "NLP / SBERT text similarity",
            data.get("success") is True,
            f"response={json.dumps(data)[:350]}",
        )
    except Exception as exc:
        record("NLP / SBERT text similarity", False, str(exc))

    # 5. Generate safe synthetic PNGs for upload tests.
    test_dir = Path(__file__).parent / ".ai_diagnostic"
    test_dir.mkdir(exist_ok=True)
    image1 = test_dir / "test_red.png"
    image2 = test_dir / "test_blue.png"

    try:
        make_test_png(image1, (220, 40, 40))
        make_test_png(image2, (40, 60, 220))
        record("Create synthetic test images", True, "PNG files created")
    except Exception as exc:
        record("Create synthetic test images", False, str(exc))
        finish()
        return

    # 6. Check MobileNetV2 / image embedding endpoint.
    try:
        data = post_multipart(
            "/cv/image-embedding",
            {},
            {"image": image1},
        )
        record(
            "Image embedding / MobileNetV2",
            data.get("success") is True,
            f"response={json.dumps(data)[:350]}",
        )
    except Exception as exc:
        record("Image embedding / MobileNetV2", False, str(exc))

    # 7. Check CLIP image-text comparison.
    try:
        data = post_multipart(
            "/cv/image-text-similarity",
            {"text": "a red charging cable"},
            {"image": image1},
        )
        record(
            "CLIP image-text similarity",
            data.get("success") is True,
            f"response={json.dumps(data)[:350]}",
        )
    except Exception as exc:
        record("CLIP image-text similarity", False, str(exc))

    # 8. Check image-to-image comparison.
    try:
        data = post_multipart(
            "/cv/image-similarity",
            {},
            {"image1": image1, "image2": image2},
        )
        record(
            "Image-to-image similarity",
            data.get("success") is True,
            f"response={json.dumps(data)[:350]}",
        )
    except Exception as exc:
        record("Image-to-image similarity", False, str(exc))

    finish()


def finish():
    print("\n=== SUMMARY ===")
    passed = sum(1 for _, ok, _ in results if ok)
    failed = len(results) - passed
    print(f"Passed: {passed}")
    print(f"Failed: {failed}")
    print("Overall:", "ALL CHECKS PASSED" if failed == 0 else "CHECK FAILURES ABOVE")
    if failed:
        print("\nA FAIL means that specific check needs investigation.")
        print("A port check alone does not prove that a model is working.")
    print("\nNote: synthetic images test the pipeline, not real-world recognition accuracy.")
    sys.exit(0 if failed == 0 else 1)


if __name__ == "__main__":
    main()
