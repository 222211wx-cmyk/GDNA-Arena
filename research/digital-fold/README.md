# Digital folding: research prototype

This explores the user's folded-paper / same-size memory-card analogy as a
software experiment. It does not change physical bit density, invent a proven
new compression method, or guarantee a 10:1 ratio.

The encoder splits a file into 1 MiB chunks, references exact repeated chunks by
SHA-256, and chooses the smallest of raw, DEFLATE, or reversible eight-lane byte
shuffle followed by DEFLATE. The dictionary, ordering, checksums and metadata are
all inside the measured archive. No external server or hidden dictionary is
needed. Decoder code and Python runtime are not included in the archive size.

Run with Python 3.8+ and only the standard library:

    python research/digital-fold/fold.py pack input.apk /tmp/output.fold
    python research/digital-fold/fold.py unpack /tmp/output.fold /tmp/restored.apk

Both commands refuse to overwrite existing outputs. The original is read-only.
The decoder checks each chunk and the complete restored file. This prototype is
for locally generated archives, not untrusted archive ingestion.

An Android package installer cannot install `.fold`. It must first be decoded
back to the original signed APK. This can reduce transfer/storage size, not
necessarily installation disk space or runtime memory. No app functionality is
removed, and this does not fix application startup exceptions.

The command reports a plain streaming-DEFLATE baseline on the exact same input.
This is important: chunking and metadata can make the proposed method worse.
All outcomes, including regressions, must be reported rather than claimed as
breakthroughs. A single APK cannot establish performance across file types or
operating systems. Future experiments may explore content-defined boundaries
and similarity deltas; those are not implemented here.

## Controlled corpus measurement

No application test suites, app builds, APK edits or network access are involved.
The corpus consists of seven original synthetic fixtures: numbered bilingual
text, structured 64-bit integers, deterministic noise, aligned repeated chunks,
a short repeated literal, and noise/gradient PNG images. See
`measurement-run/measurements.json` for exact provenance, sizes, SHA-256 digests,
environment, codec settings, and every timing sample. The checked-in originals
are in `measurement-run/originals/`. `results.html` is the standalone report;
the earlier, separate APK experiment is preserved in `previous-apk-results.html`.

Reproduce from the workspace root (use a new corpus directory each time):

```sh
python research/digital-fold/fold.py benchmark /tmp/digital-fold-corpus-v1 /tmp/digital-fold-results.html --repeats 3
```

The committed report was generated with:

```sh
python research/digital-fold/fold.py benchmark research/digital-fold/measurement-run research/digital-fold/results.html --repeats 3
```

That exact command will refuse to overwrite the existing corpus. The report
destination is intentionally replaceable; choose a new report path to preserve
an earlier report. All original inputs, encoded archives and decoded outputs
remain in the run directory. Per-trial archives and decoded duplicates are
ignored by git; original fixtures and raw measurements are retained in git.
Any mismatch raises an error instead of emitting a successful report.

DEFLATE uses the zlib wrapper at level 9, LZMA uses XZ preset 6, and Zstandard
uses `zstd` CLI level 3 if the executable is on PATH. No dependency is downloaded
automatically. Zstandard was unavailable in the recorded environment, so its
absence is reported explicitly, not estimated or replaced by another codec.
To include it in a future run, provide `zstd` on PATH and run the same command.

Sizes count the complete output file, including codec/container framing and all
fold metadata, not decoder code/runtime, filesystem allocation, or the report.
Timings are median file-to-file wall times with warm filesystem caches, no
fsync and no separate warmup; all three samples are recorded. The fold encoder's
extra legacy baseline computation is disabled during comparative measurement.
Its internal integrity checks remain part of decoding time; independent
byte-for-byte validation is outside every codec's timer. Baselines buffer files
in memory; the fold implementation processes chunks. Zstandard timings, when
available, include process launch. These settings do not equalize effort
between codecs and no peak-memory or device-performance claim is made.

This is a deliberately small, biased synthetic corpus, not representative of
all real files. Repeated aligned noise is a favorable deduplication example;
noise and previously compressed PNGs expose expansion and metadata penalties.
PNG results do not establish behavior for JPEG, audio, video or APK files.