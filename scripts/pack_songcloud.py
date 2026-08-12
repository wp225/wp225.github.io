"""Pack the song-embedding viewer data into a web-sized payload.

Reads the existing export in ``results/visuals/clusters/song_embedding``
(``coords.npy`` + ``viewer_metadata.json``) and rewrites it as one small binary
blob plus a tiny JSON header, for use by the portfolio hero viewer.

The 17 MB pretty-printed metadata JSON carries nine fields per song, but the
viewer only ever reads bird identity and year, and derives colour from bird
identity alone. Storing those as typed arrays instead of JSON objects, and
quantising the PCA coordinates to int16, takes the payload from ~17.8 MB to
under 700 KB with no visible loss.

Points are written in bird-interleaved (round-robin) order so that any prefix of
the file is a representative sample of the population -- that makes
``--max-points`` a valid downsample rather than a biased crop.

Run from the project root::

    source .venv/bin/activate
    python results/visuals/portfolio_export/pack_songcloud.py
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np

ROOT = Path()
SRC_DIR = ROOT / "results" / "visuals" / "clusters" / "song_embedding"
OUT_DIR = ROOT / "results" / "visuals" / "portfolio_export"

COORDS_NPY = SRC_DIR / "coords.npy"
META_JSON = SRC_DIR / "viewer_metadata.json"

INT16_MAX = 32767
# Coordinates are clipped at this percentile of absolute value before scaling,
# so a handful of PCA outliers cannot squash the dense core of the cloud into a
# few quantisation levels.
CLIP_PERCENTILE = 99.8


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Pack song cloud for the web")
    p.add_argument(
        "--max-points",
        type=int,
        default=None,
        help="keep only the first N points after interleaving (representative sample)",
    )
    p.add_argument(
        "--out-dir",
        type=Path,
        default=OUT_DIR,
        help="directory to write songcloud.bin / songcloud.json into",
    )
    return p.parse_args()


def interleave_by_bird(fathers: list[str]) -> np.ndarray:
    """Return an index order that round-robins across birds.

    Any prefix of the result covers as many distinct birds as possible, so
    truncating the payload downsamples evenly instead of dropping whole birds.
    """
    buckets: dict[str, list[int]] = {}
    for i, f in enumerate(fathers):
        buckets.setdefault(f, []).append(i)

    order: list[int] = []
    lists = list(buckets.values())
    depth = 0
    remaining = sum(len(v) for v in lists)
    while remaining:
        for bucket in lists:
            if depth < len(bucket):
                order.append(bucket[depth])
                remaining -= 1
        depth += 1
    return np.asarray(order, dtype=np.int64)


def main() -> None:
    args = parse_args()
    out_dir: Path = args.out_dir
    out_dir.mkdir(parents=True, exist_ok=True)

    coords = np.load(COORDS_NPY).astype(np.float32)
    meta = json.loads(META_JSON.read_text())
    if len(coords) != len(meta):
        msg = f"coords/meta length mismatch: {len(coords)} vs {len(meta)}"
        raise SystemExit(msg)

    fathers_raw = [str(d["father"]) for d in meta]
    years_raw = [d["year"] for d in meta]

    order = interleave_by_bird(fathers_raw)
    if args.max_points is not None:
        order = order[: args.max_points]

    coords = coords[order]
    fathers_raw = [fathers_raw[i] for i in order]
    years_raw = [years_raw[i] for i in order]
    n = len(order)

    # Centre, then scale so the cloud fills roughly [-1, 1] on its widest axis.
    centre = coords.mean(axis=0)
    centred = coords - centre
    extent = float(np.percentile(np.abs(centred), CLIP_PERCENTILE))
    normalised = np.clip(centred / extent, -1.0, 1.0)
    quantised = np.rint(normalised * INT16_MAX).astype(np.int16)

    father_labels = sorted(set(fathers_raw))
    father_index = {f: i for i, f in enumerate(father_labels)}
    if len(father_labels) > 65535:
        msg = f"too many birds for uint16: {len(father_labels)}"
        raise SystemExit(msg)
    father_ids = np.asarray([father_index[f] for f in fathers_raw], dtype=np.uint16)

    year_labels = sorted({y for y in years_raw if y is not None})
    year_index = {y: i for i, y in enumerate(year_labels)}
    # 255 is the sentinel for "year unknown".
    year_ids = np.asarray(
        [year_index[y] if y is not None else 255 for y in years_raw],
        dtype=np.uint8,
    )

    bin_path = out_dir / "songcloud.bin"
    with bin_path.open("wb") as fh:
        fh.write(quantised.tobytes())
        fh.write(father_ids.tobytes())
        fh.write(year_ids.tobytes())

    header = {
        "n": int(n),
        "scale": extent,
        "centre": [float(v) for v in centre],
        "fathers": father_labels,
        "years": [int(y) for y in year_labels],
        "layout": [
            {"name": "coords", "type": "int16", "components": 3},
            {"name": "father", "type": "uint16", "components": 1},
            {"name": "year", "type": "uint8", "components": 1},
        ],
    }
    json_path = out_dir / "songcloud.json"
    json_path.write_text(json.dumps(header, separators=(",", ":")))

    print(f"points      : {n:,}")
    print(f"birds       : {len(father_labels)}")
    print(f"years       : {year_labels}")
    print(f"{bin_path.name:<12}: {bin_path.stat().st_size / 1024:,.0f} KB")
    print(f"{json_path.name:<12}: {json_path.stat().st_size / 1024:,.0f} KB")


if __name__ == "__main__":
    main()
