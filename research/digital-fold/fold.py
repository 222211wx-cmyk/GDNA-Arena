"""Research archive: exact chunk deduplication + reversible byte shuffle + DEFLATE.

Not an APK format or a new physical storage technology. Python standard library.
Only decode archives produced by this prototype; not a hardened archive reader.
"""
import argparse
import collections
import hashlib
import json
import os
import time
import zipfile
import zlib
from pathlib import Path

CHUNK = 1024 * 1024


def shuffle(data):
    return b"".join(data[offset::8] for offset in range(8))


def unshuffle(data):
    result = bytearray(len(data))
    cursor = 0
    for offset in range(8):
        length = len(range(offset, len(data), 8))
        result[offset::8] = data[cursor:cursor + length]
        cursor += length
    return bytes(result)


def pack(source, target):
    started = time.monotonic()
    digest = hashlib.sha256()
    seen = {}
    sequence = []
    entries = []
    choices = collections.Counter()
    baseline = zlib.compressobj(9)
    baseline_bytes = 0
    source_bytes = 0
    # Exclusive creation: never overwrite an existing file.
    with open(source, "rb") as reader, zipfile.ZipFile(target, "x") as archive:
        while data := reader.read(CHUNK):
            digest.update(data)
            source_bytes += len(data)
            baseline_bytes += len(baseline.compress(data))
            key = hashlib.sha256(data).hexdigest()
            if key in seen:
                sequence.append(seen[key])
                choices["reference"] += 1
                continue
            options = [
                ("raw", data),
                ("deflate", zlib.compress(data, 9)),
                ("shuffle8-deflate", zlib.compress(shuffle(data), 9)),
            ]
            codec, payload = min(options, key=lambda item: len(item[1]))
            index = len(entries)
            seen[key] = index
            sequence.append(index)
            entries.append({"codec": codec, "length": len(data), "sha256": key})
            choices[codec] += 1
            archive.writestr(f"chunks/{index}", payload)
        baseline_bytes += len(baseline.flush())
        manifest = {
            "format": "digital-fold-research-1",
            "bytes": source_bytes,
            "sha256": digest.hexdigest(),
            "entries": entries,
            "sequence": sequence,
        }
        archive.writestr("manifest.json", json.dumps(manifest, separators=(",", ":")))
    return {
        "source_bytes": source_bytes,
        "archive_bytes": os.path.getsize(target),
        "baseline_stream_deflate_bytes": baseline_bytes,
        "source_sha256": digest.hexdigest(),
        "choices": dict(choices),
        "seconds": round(time.monotonic() - started, 2),
        "includes_dictionary_and_metadata": True,
    }


def unpack(source, target):
    digest = hashlib.sha256()
    written = 0
    created = False
    try:
        with zipfile.ZipFile(source) as archive:
            manifest = json.loads(archive.read("manifest.json"))
            if manifest["format"] != "digital-fold-research-1":
                raise ValueError("Unsupported format")
            with open(target, "xb") as writer:
                created = True
                for index in manifest["sequence"]:
                    entry = manifest["entries"][index]
                    codec = entry["codec"]
                    payload = archive.read(f"chunks/{index}")
                    if codec == "raw":
                        data = payload
                    elif codec in ("deflate", "shuffle8-deflate"):
                        decoder = zlib.decompressobj()
                        data = decoder.decompress(payload, CHUNK + 1)
                        if not decoder.eof or decoder.unused_data or len(data) > CHUNK:
                            raise ValueError("Invalid compressed chunk")
                        if codec == "shuffle8-deflate":
                            data = unshuffle(data)
                    else:
                        raise ValueError("Unknown codec")
                    if len(data) != entry["length"] or hashlib.sha256(data).hexdigest() != entry["sha256"]:
                        raise ValueError("Chunk integrity mismatch")
                    writer.write(data)
                    digest.update(data)
                    written += len(data)
                if written != manifest["bytes"] or digest.hexdigest() != manifest["sha256"]:
                    raise ValueError("File integrity mismatch")
    except Exception:
        if created:
            Path(target).unlink(missing_ok=True)
        raise
    return {"restored_bytes": written, "sha256": digest.hexdigest(), "integrity": "matched"}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["pack", "unpack"])
    parser.add_argument("source")
    parser.add_argument("target")
    args = parser.parse_args()
    operation = pack if args.action == "pack" else unpack
    print(json.dumps(operation(args.source, args.target), indent=2))