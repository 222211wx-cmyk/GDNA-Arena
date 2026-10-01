"""Offline public-media extension; optional explicit hash-pinned download command."""
import argparse
import json
from pathlib import Path
from urllib.request import Request, urlopen

from benchmark import exclusive, noise, run, sha
from fold import CHUNK

SAMPLES = Path(__file__).resolve().parent / "public-samples"


def manifest():
    return json.loads((SAMPLES / "manifest.json").read_text(encoding="utf-8"))


def verified(data, item):
    if len(data) != item["bytes"] or sha(data) != item["sha256"]:
        raise ValueError(f"Size/hash mismatch for pinned public sample: {item['name']}")
    return data


def download(destination):
    """Never alter checked-in files; upstream replacements must fail their hashes."""
    destination.mkdir(parents=True, exist_ok=False)
    for item in manifest()["samples"]:
        request = Request(item["download_url"], headers={
            "User-Agent": "DigitalFoldResearch/1.0 (licensed compression corpus)"
        })
        with urlopen(request, timeout=60) as response:
            data = response.read(item["bytes"] + 1)
        exclusive(destination / item["name"], verified(data, item))


def repetition_controls():
    block = noise("digital-fold-repeat-v1", CHUNK)
    prefix = noise("digital-fold-offset-prefix-v1", 17)
    shifted = prefix + block * 4
    gapped = b"".join(block + noise(f"digital-fold-gap-{i}-v1", gap)
                      for i, gap in enumerate((1, 17, 257, 0)))
    period = block + noise("digital-fold-period-tail-v1", 13)
    cases = [
        ("shifted-repeat.bin", shifted,
         "17-byte SHAKE-256 prefix + four original 1 MiB blocks. Fixed shift is NOT "
         "a complete deduplication defeat: three interior shifted chunks still match (two references).",
         [17 + i * CHUNK for i in range(4)]),
        ("gapped-repeat.bin", gapped,
         "Four original 1 MiB blocks separated by 1, 17, 257 SHAKE-256 bytes; "
         "repeat starts modulo chunk size are 0, 1, 18, 275. No aligned chunk repeats.",
         [0, CHUNK + 1, 2 * CHUNK + 18, 3 * CHUNK + 275]),
        ("nonaligned-period.bin", period * 4,
         "Four identical (1 MiB + 13 byte) periods: original 1 MiB block + "
         "SHAKE-256(label=digital-fold-period-tail-v1, length=13). "
         "Repeat starts modulo chunk size are 0, 13, 26, 39; no aligned chunk repeats.",
         [i * (CHUNK + 13) for i in range(4)]),
    ]
    for name, data, description, starts in cases:
        chunks = [data[i:i + CHUNK] for i in range(0, len(data), CHUNK)]
        references = len(chunks) - len(set(chunks))
        expected = 2 if name == "shifted-repeat.bin" else 0
        if references != expected:
            raise ValueError(f"Control no longer has intended boundaries: {name}")
        yield name, "non-aligned repeated control", data, description, {
            "control": {
                "repeat_starts_bytes": starts,
                "repeat_starts_mod_chunk": [i % CHUNK for i in starts],
                "expected_fold_references": expected,
                "repeated_block_sha256": sha(block),
                "generator": "SHAKE-256; exact labels and lengths in public_benchmark.py",
            }
        }


def extra_corpus(originals):
    for item in manifest()["samples"]:
        data = verified((originals / item["name"]).read_bytes(), item)
        details = {key: value for key, value in item.items()
                   if key not in ("name", "category", "provenance", "bytes", "sha256")}
        details["retrieved_utc_date"] = manifest()["retrieved_utc_date"]
        yield item["name"], item["category"], data, item["provenance"], details
    yield from repetition_controls()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("root", type=Path, help="New run directory, or new download directory")
    parser.add_argument("report", type=Path, nargs="?")
    parser.add_argument("--repeats", type=int, default=3)
    parser.add_argument("--originals", type=Path, default=SAMPLES / "originals")
    parser.add_argument("--download", action="store_true", help="Explicit network fetch only; no benchmark")
    args = parser.parse_args()
    if args.download:
        if args.report:
            parser.error("--download takes only a new destination directory")
        download(args.root)
    else:
        if not args.report:
            parser.error("report path is required")
        if args.report.exists():
            parser.error("Public benchmark requires a new report path; previous files are preserved")
        # Verify every external input before creating a run or beginning timing.
        extras = list(extra_corpus(args.originals))
        result = run(args.root, args.report, args.repeats, extras, require_zstd=True)
        # Confirm the source collection also survives measurement unaltered.
        list(extra_corpus(args.originals))
        print(json.dumps(result, indent=2))