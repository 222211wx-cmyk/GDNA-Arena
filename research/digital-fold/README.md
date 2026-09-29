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