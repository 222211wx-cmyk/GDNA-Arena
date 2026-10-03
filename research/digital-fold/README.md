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

## Original controlled corpus measurement

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

## Licensed public-media extension

**Historical run:** this section describes the original three-media collection
recorded on 2026-10-01. The current manifest is now expanded; invoking
`public_benchmark.py` today measures the nine media originals described in
[EXPANDED-RESULTS.md](EXPANDED-RESULTS.md). The historical JSON, HTML and original
bytes have not been replaced. Its three media records remain the first three
manifest entries, with their original hashes and retrieval date.

`public-results.html` and `public-measurement-run/measurements.json` record a
**separate** run over the original seven fixtures, three public media originals,
and three non-aligned repetition controls. The previous `measurement-run/`,
`results.html`, and `previous-apk-results.html` remain unchanged.

### Sources, permissions and originals

See `public-samples/manifest.json` for source/download URLs, source-page revision
links, authors, selected licenses, permission evidence, SHA-256 and byte counts.
The files in `public-samples/originals/` are complete, unmodified downloads:

| Local file | Public work / attribution | Reuse terms |
| --- | --- | --- |
| `flower.jpg` | [JPEG example flower.jpg](https://commons.wikimedia.org/wiki/File:JPEG_example_flower.jpg), David Crawshaw; optimized by Gnash; uploaded to Commons by Maximaximax | [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) selected from dual licensing |
| `bansuri.ogg` | [Sample2.ogg](https://commons.wikimedia.org/wiki/File:Sample2.ogg), Prithoo (metadata: Prithwin), bansuri music | [Public domain by copyright holder](https://commons.wikimedia.org/wiki/File:Sample2.ogg#Licensing), PD-self; unrestricted fallback permission where dedication is not possible |
| `example.webm` | [Exemple.webm](https://commons.wikimedia.org/wiki/File:Exemple.webm), Jauvert Laura, edited by Edouard-lopez | [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) |

No media edits were made here, including resizing, transcoding, trimming or
metadata removal. Local filenames differ from Commons names. Reversible archive
representations preserve all original bytes and the original media licenses;
this experiment does not imply endorsement by their creators. Keep the
attributions and license links with redistributed media.

`ffprobe` 7.1.1 confirmed JPEG 500×477, Ogg Vorbis mono 22050 Hz / 53.879592 s,
and WebM VP9 1280×720 with stereo Opus / 3.527 s. Probe details are in the
manifest. Probing was outside compression timings. The JPEG is an already
optimized composition; the video is the complete Commons clip, not a new
excerpt. One small sample of each format is not representative of that format.

### Reproduce offline with available Zstandard

The new entry point **requires** `zstd` on PATH, fails if it is absent, validates
all source hashes before measurement, and refuses existing run/report paths.
No dependency installs, application imports, application tests, workflows,
builds, APK changes or automatic network requests occur.

```sh
python research/digital-fold/public_benchmark.py \
  /tmp/digital-fold-public-v1 /tmp/digital-fold-public.html --repeats 3
```

In the recorded environment, Zstandard 1.5.7 was available as a transitive system
dependency, but not on the default PATH. The exact recorded invocation was:

```sh
PATH="/nix/store/ddap6dm3fjdm0zmw4m3rls73a0gml3xd-zstd-1.5.7-bin/bin:$PATH" \
python research/digital-fold/public_benchmark.py \
  research/digital-fold/public-measurement-run \
  research/digital-fold/public-results.html --repeats 3
```

That Nix path is environment-specific; on other systems use an available `zstd`
executable on PATH. No project dependency or application environment was changed.
Zstandard used CLI level 3 with its default framing/window settings and no
external dictionary or long-distance override. Compression parameters and all
individual timings, whole archive sizes and SHA-256 hashes are recorded in JSON.
All codecs measured **the same complete bytes**, not media payloads alone.
Original and restored hashes match for all 13 × 4 × 3 = **156 round trips**.
Archives and restored files remain on disk but are excluded from git; the
originals and raw measurements are checked in.

The timing caveats from the first run still apply: warm filesystem caches,
median of three trials, fixed codec order, no fsync, independent comparison
outside timing, Fold's internal checks inside decoding time, process startup
included for Zstandard. The shared harness reads each baseline input into
memory; Zstandard additionally reads the file in its subprocess. These are
end-to-end harness timings, not isolated codec throughput, equally tuned effort,
or phone benchmarks. Sizes exclude decoder/runtime, attribution documents and
reports; they include **all bytes necessary to reconstruct** the measured input.

Optional explicit re-fetch to a **new** directory (not needed to reproduce):

```sh
python research/digital-fold/public_benchmark.py /tmp/public-media-refetch --download
python research/digital-fold/public_benchmark.py \
  /tmp/public-refetch-run /tmp/public-refetch-report.html \
  --originals /tmp/public-media-refetch --repeats 3
```

Downloads have a byte cap, timeout and mandatory expected size/SHA-256 check.
An upstream replacement fails rather than silently changing the corpus.
Network transfer is never included in benchmark time.

Research-only guard checks (not application tests):

```sh
python -m unittest discover -s research/digital-fold -p 'test_public_corpus.py' -v
```

### Results and boundary sensitivity

Whole-file byte counts from this run (smaller is better):

| File | Original | Fold | DEFLATE | LZMA/XZ | Zstandard |
| --- | ---: | ---: | ---: | ---: | ---: |
| JPEG | 36,287 | 36,610 | 36,130 | 36,348 | 36,301 |
| Vorbis audio | 368,828 | 367,149 | 366,667 | 367,608 | 368,850 |
| WebM video | 229,792 | 229,399 | 228,917 | 229,756 | 229,811 |
| Aligned repeat | 4,194,304 | 1,049,062 | 4,195,590 | 1,049,464 | 1,051,625 |
| Fixed 17-byte prefix | 4,194,321 | 2,098,054 | 4,195,607 | 1,049,480 | 1,051,762 |
| Unequal gaps | 4,194,579 | 4,195,867 | 4,195,865 | 1,049,760 | 1,052,020 |
| Period of 1 MiB + 13 bytes | 4,194,356 | 4,195,643 | 4,195,642 | 1,049,476 | 1,051,703 |

The report includes compression/decompression median milliseconds for **every**
file/codec and JSON retains every sample, including unfavorable results.

- On this JPEG, Fold expanded by **0.890%**; on this audio and video it saved
  only **0.455%** and **0.171%**. Plain DEFLATE was smaller on all three.
  Zstandard expanded slightly on each of these particular media originals.
  This is not evidence of a practical media compression breakthrough.
- The aligned control repeats a deterministic 1 MiB noise block four times.
  It intentionally favors Fold; three chunks become references.
- A **fixed** 17-byte prefix leaves three identical interior chunks, so Fold
  still gets two references and about **50%** reduction. Simply shifting the
  entire repeated stream is not sufficient to remove aligned internal matches.
- Unequal gaps of 1, 17 and 257 bytes move starts modulo 1 MiB to
  **0, 1, 18, 275**. The other control repeats a **1 MiB + 13-byte** period;
  starts modulo 1 MiB are **0, 13, 26, 39**. Identical repeated content remains,
  but neither control has repeated full Fold chunks. The harness asserts these
  properties and checks actual Fold reference counts.
- For both moving-boundary controls Fold slightly expands, while XZ and
  Zstandard retain about **75%** savings. Zstandard level 3 also encoded these
  controls faster than Fold in this run; process/harness differences and shared
  host noise prevent a general speed claim.

These synthetic controls expose **fixed-boundary sensitivity**, not real media
performance. No content-defined chunker was introduced, no corpus-wide weighted
score implies a winner, and no universal, APK, app-startup or hardware-density
claim follows from this small experiment.