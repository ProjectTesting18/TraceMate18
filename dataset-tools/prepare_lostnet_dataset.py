#!/usr/bin/env python3
"""Prepare the uploaded LostNet image archive for TraceMate experiments.

Input: a ZIP containing class folders of images.
Output:
  training-data/
    raw/          source metadata only (the original ZIP is not copied)
    processed/    unique images after exact-duplicate removal
    train/        stratified training split
    validation/   stratified validation split
    test/         stratified final test split
  reports/
    dataset_report.json
    manifest.csv
    duplicates.csv

No image augmentation is performed here.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import random
import shutil
import zipfile
from collections import Counter, defaultdict
from pathlib import Path

from PIL import Image, UnidentifiedImageError

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}


def md5_bytes(data: bytes) -> str:
    return hashlib.md5(data).hexdigest()


def safe_name(name: str) -> str:
    return "_".join(part for part in name.replace("\\", "/").split("/") if part)


def extract_and_scan(zip_path: Path, work_dir: Path):
    extract_dir = work_dir / "_extracted"
    if extract_dir.exists():
        shutil.rmtree(extract_dir)
    extract_dir.mkdir(parents=True, exist_ok=True)

    records = []
    invalid = []
    with zipfile.ZipFile(zip_path, "r") as zf:
        members = [m for m in zf.infolist() if not m.is_dir()]
        for m in members:
            rel = Path(m.filename)
            if rel.suffix.lower() not in IMAGE_EXTS:
                continue
            parts = rel.parts
            if len(parts) < 2:
                invalid.append({"file": m.filename, "reason": "missing category folder"})
                continue
            category = parts[0]
            out = extract_dir / rel
            out.parent.mkdir(parents=True, exist_ok=True)
            with zf.open(m) as src, open(out, "wb") as dst:
                data = src.read()
                dst.write(data)
            try:
                with Image.open(out) as im:
                    width, height = im.size
                    fmt = im.format or "unknown"
                    im.verify()
                digest = md5_bytes(data)
                records.append({
                    "source_file": m.filename,
                    "category": category,
                    "path": str(out),
                    "md5": digest,
                    "width": width,
                    "height": height,
                    "format": fmt,
                    "bytes": len(data),
                    "valid": True,
                })
            except (UnidentifiedImageError, OSError, ValueError) as exc:
                invalid.append({"file": m.filename, "reason": str(exc)})
                try:
                    out.unlink()
                except OSError:
                    pass

    return extract_dir, records, invalid


def deduplicate(records):
    by_hash = defaultdict(list)
    for r in records:
        by_hash[r["md5"]].append(r)

    unique = []
    duplicates = []
    for digest, group in by_hash.items():
        group.sort(key=lambda r: r["source_file"])
        keep = group[0]
        unique.append(keep)
        for dup in group[1:]:
            duplicates.append({
                "duplicate_file": dup["source_file"],
                "kept_file": keep["source_file"],
                "md5": digest,
                "category_duplicate": dup["category"] == keep["category"],
            })
    unique.sort(key=lambda r: (r["category"], r["source_file"]))
    return unique, duplicates


def stratified_split(records, seed=42, train_ratio=0.70, val_ratio=0.15):
    rng = random.Random(seed)
    by_class = defaultdict(list)
    for r in records:
        by_class[r["category"]].append(r)

    splits = {"train": [], "validation": [], "test": []}
    for category, items in sorted(by_class.items()):
        rng.shuffle(items)
        n = len(items)
        n_train = int(n * train_ratio)
        n_val = int(n * val_ratio)
        if n_train < 1:
            n_train = 1
        if n_train + n_val >= n:
            n_val = max(1, n - n_train - 1)
        splits["train"].extend(items[:n_train])
        splits["validation"].extend(items[n_train:n_train + n_val])
        splits["test"].extend(items[n_train + n_val:])

    return splits


def copy_split(splits, processed_dir: Path, output_root: Path):
    for split_name, items in splits.items():
        split_dir = output_root / split_name
        split_dir.mkdir(parents=True, exist_ok=True)
        for r in items:
            category_dir = split_dir / r["category"]
            category_dir.mkdir(parents=True, exist_ok=True)
            src = Path(r["path"])
            # Give every processed file a deterministic collision-safe name.
            dst_name = f"{src.stem}__{r['md5'][:10]}{src.suffix.lower()}"
            dst = category_dir / dst_name
            shutil.copy2(src, dst)
            r["split"] = split_name
            r["output_file"] = str(dst)


def write_csv(path: Path, rows, fieldnames):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        w.writerows(rows)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--zip", required=True, help="Path to LostNet ZIP")
    ap.add_argument("--output", default="training-data", help="Output dataset directory")
    ap.add_argument("--seed", type=int, default=42)
    args = ap.parse_args()

    zip_path = Path(args.zip).resolve()
    output_root = Path(args.output).resolve()
    work_dir = output_root / "_work"
    reports_dir = output_root / "reports"
    raw_dir = output_root / "raw"
    processed_dir = output_root / "processed"

    if not zip_path.exists():
        raise SystemExit(f"ZIP not found: {zip_path}")

    output_root.mkdir(parents=True, exist_ok=True)
    reports_dir.mkdir(exist_ok=True)
    raw_dir.mkdir(exist_ok=True)
    processed_dir.mkdir(exist_ok=True)

    (raw_dir / "SOURCE.txt").write_text(
        f"Source ZIP: {zip_path}\n"
        "The original ZIP is intentionally not copied into this dataset output.\n",
        encoding="utf-8",
    )

    extract_dir, records, invalid = extract_and_scan(zip_path, work_dir)
    unique, duplicates = deduplicate(records)

    # Copy unique images into processed/category for a clean source pool.
    for r in unique:
        src = Path(r["path"])
        dst = processed_dir / r["category"] / src.name
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)
        r["processed_file"] = str(dst)

    splits = stratified_split(unique, seed=args.seed)
    copy_split(splits, processed_dir, output_root)

    # Manifest with relative paths.
    manifest_rows = []
    for r in unique:
        row = dict(r)
        row.pop("path", None)
        row["processed_file"] = str(Path(row["processed_file"]).relative_to(output_root))
        if "output_file" in row:
            row["output_file"] = str(Path(row["output_file"]).relative_to(output_root))
        manifest_rows.append(row)

    write_csv(
        reports_dir / "manifest.csv",
        manifest_rows,
        ["source_file", "category", "md5", "width", "height", "format", "bytes", "valid", "processed_file", "split", "output_file"],
    )
    write_csv(reports_dir / "duplicates.csv", duplicates, ["duplicate_file", "kept_file", "md5", "category_duplicate"])

    class_counts = {}
    for split_name, items in splits.items():
        class_counts[split_name] = dict(sorted(Counter(r["category"] for r in items).items()))

    report = {
        "source_zip": str(zip_path),
        "source_image_count": len(records),
        "invalid_image_count": len(invalid),
        "exact_duplicate_count_removed": len(duplicates),
        "unique_image_count": len(unique),
        "category_count": len(set(r["category"] for r in unique)),
        "categories": sorted(set(r["category"] for r in unique)),
        "split_ratios_requested": {"train": 0.70, "validation": 0.15, "test": 0.15},
        "seed": args.seed,
        "split_counts": {k: len(v) for k, v in splits.items()},
        "class_counts": class_counts,
        "invalid_images": invalid,
        "note": "Exact duplicates were removed before splitting to reduce data leakage. No augmentation or model training is performed by this script.",
    }
    (reports_dir / "dataset_report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")

    # Remove temporary extraction after all outputs are copied.
    shutil.rmtree(extract_dir, ignore_errors=True)
    shutil.rmtree(work_dir, ignore_errors=True)

    print(json.dumps(report, indent=2))
    print(f"\nPrepared dataset: {output_root}")


if __name__ == "__main__":
    main()
