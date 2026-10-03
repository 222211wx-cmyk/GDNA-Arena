# Longer and more varied public media

This research expands the pinned collection to **nine independent works**:
three JPEG images, three audio recordings and three videos. It does not touch
application code, APKs, builds, services or dependencies. No test suite was run.
The requested compression measurement includes byte-for-byte reconstruction
checks; those checks are part of the experiment, not application tests.

## Selection and preservation

The six additions were chosen before measurement for documented permissions,
manageable complete downloads and content/size/duration contrasts, not for
favorable compression results. There is no padding, concatenation, cropping,
trimming, transcoding, metadata stripping or generated substitute media.

| Original | Content | Resolution or duration (ffprobe) | Bytes | Fold chunks |
| --- | --- | --- | ---: | ---: |
| flower.jpg | Optimized flower composition | 500 × 477 | 36,287 | 1 |
| Fronalpstock_big.jpg | Stitched mountain panorama | 10,109 × 4,542 | 14,679,474 | 14 |
| Shaki_waterfall.jpg | Waterfall photograph | 1,280 × 959 | 377,828 | 1 |
| bansuri.ogg | Bansuri music, Vorbis mono | 53.879592 s, 22,050 Hz | 368,828 | 1 |
| Rain_thunder_and_birds.ogg | Nature recording, Vorbis mono | 134.295510 s, 44,100 Hz | 1,979,069 | 2 |
| George_W._Bush_Speech_-_September_11,_2001.ogg | Historical speech, Vorbis mono | 262.713469 s, 44,100 Hz | 1,004,622 | 1 |
| example.webm | Sign-language example, VP9/Opus | 3.527 s, 1280 × 720 | 229,792 | 1 |
| Piano_close-up.webm | Workshop activity, VP8/Vorbis | 19.523 s, 1920 × 1080 | 5,410,367 | 6 |
| Meet_the_Capacity_Exchange.webm | Project introduction, VP9/Opus | 92.104 s, 1920 × 1080 | 20,693,478 | 20 |

Four originals exceed the 1,048,576-byte Fold chunk, including at least one in
each category. The speech lasts longer than the rain but is smaller than one
chunk: duration alone does not establish multi-chunk behavior. Total media
input size is 44,779,745 bytes, not a weighted performance score.

All original files and SHA-256 pins are in `public-samples/`. The manifest
retains per-work author, license, source revision, download URL, permission
evidence, byte count, SHA-256, probe data and retrieval date. New permission
page snapshots are in `public-samples/evidence/`. Keep attribution and license
links with redistributed media; US public-domain and personality-rights
limitations are explicitly noted. "Original" means the complete Commons upload,
not necessarily a camera/sound-recorder master.

## Reproduction and accounting

The new run is `expanded-measurement-run/measurements.json` with standalone
`expanded-results.html`. Earlier reports and runs remain unchanged. The current
`public_benchmark.py` includes all nine media files plus the same seven
synthetic fixtures and three boundary controls: 19 inputs, four codecs, three
trials each. It imports the **same** `benchmark.run` accounting, Fold encoder,
DEFLATE level 9, XZ preset 6 and Zstandard CLI level 3; no codec algorithm or
timing implementation was changed for this expansion.

Recorded invocation:

```sh
PATH="/nix/store/ddap6dm3fjdm0zmw4m3rls73a0gml3xd-zstd-1.5.7-bin/bin:$PATH" \
python research/digital-fold/public_benchmark.py \
  research/digital-fold/expanded-measurement-run \
  research/digital-fold/expanded-results.html --repeats 3
```

For reproduction use **new** run/report paths; existing paths are refused.
The Nix path is environment-specific; use an already available `zstd` on PATH.
No package was installed. The manifest's first three entries keep their old
retrieval date; the six additions were retrieved on 2026-10-03. Network access
and ffprobe 7.1.1 inspection were outside measurement.

Each archive size includes its complete framing, dictionaries, metadata and
references. Decoder/runtime, filesystem allocation, report, attribution and
external subtitle documents are excluded. None of those documents is required
to reconstruct the measured file bytes. Attribution remains a distribution
obligation, not hidden compression state.

File-to-file wall time includes reading/writing, uses warm caches, no fsync,
no separate warmup and fixed codec order. Tables use medians of three; JSON
retains every sample and restored/archive hash. Fold's internal checks count
toward decoding time; independent byte comparisons are outside all timers.
Baselines buffer complete files in memory; Zstandard also reads in a child
process and includes process launch. Settings do not equalize codec effort.
No peak RAM, energy, disk-cold, network-transfer or phone timings were measured.

Run-local originals, archives and restored copies remain on disk but are
excluded from Git to avoid duplication; the canonical source originals and
raw measurements are retained. The offline harness checks source pins before
running and rechecks the collection afterward.

## Individual measured results

Run started at **2026-10-03T02:51:47.471719+00:00**, using Python 3.12.11 and
Zstandard 1.5.7. All **228** file/codec/trial reconstructions matched the exact
original bytes (108 on public media, 120 on fixtures/controls). All source
hashes also passed before and after the measurement.

Whole-file sizes in bytes; positive Fold saving means smaller than the original,
negative means expansion. No average across files is reported.

| File | Original | Fold | DEFLATE | XZ | Zstandard | Fold saving |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| flower.jpg | 36,287 | 36,610 | 36,130 | 36,348 | 36,301 | −0.89013% |
| Fronalpstock_big.jpg | 14,679,474 | 14,666,079 | 14,666,245 | 14,638,152 | 14,672,185 | +0.09125% |
| Shaki_waterfall.jpg | 377,828 | 378,306 | 377,906 | 377,908 | 377,850 | −0.12651% |
| bansuri.ogg | 368,828 | 367,149 | 366,667 | 367,608 | 368,850 | +0.45523% |
| Rain_thunder_and_birds.ogg | 1,979,069 | 1,977,198 | 1,976,521 | 1,978,072 | 1,979,130 | +0.09454% |
| George_W._Bush_Speech_-_September_11,_2001.ogg | 1,004,622 | 996,139 | 995,655 | 995,860 | 1,004,659 | +0.84440% |
| example.webm | 229,792 | 229,399 | 228,917 | 229,756 | 229,811 | +0.17102% |
| Piano_close-up.webm | 5,410,367 | 5,392,557 | 5,391,150 | 5,403,340 | 5,410,507 | +0.32918% |
| Meet_the_Capacity_Exchange.webm | 20,693,478 | 20,696,627 | 20,696,473 | 20,694,564 | 20,693,966 | −0.01522% |

Median **encode / decode milliseconds**, same complete files and three trials
per cell; individual samples are retained in JSON:

| File | Fold | DEFLATE | XZ | Zstandard |
| --- | ---: | ---: | ---: | ---: |
| flower.jpg | 3.319 / 0.731 | 0.982 / 0.347 | 6.634 / 0.181 | 5.817 / 5.233 |
| Fronalpstock_big.jpg | 836.311 / 70.595 | 426.079 / 53.267 | 5715.873 / 129.891 | 51.169 / 18.233 |
| Shaki_waterfall.jpg | 20.665 / 1.507 | 10.138 / 0.722 | 57.536 / 0.532 | 8.545 / 6.326 |
| bansuri.ogg | 26.946 / 3.268 | 11.638 / 2.448 | 54.581 / 8.439 | 7.591 / 5.886 |
| Rain_thunder_and_birds.ogg | 113.614 / 15.976 | 55.983 / 11.612 | 411.366 / 6.350 | 17.024 / 9.562 |
| George_W._Bush_Speech_-_September_11,_2001.ogg | 62.763 / 8.767 | 31.342 / 6.913 | 197.843 / 33.201 | 14.536 / 8.171 |
| example.webm | 13.682 / 2.126 | 6.657 / 1.355 | 36.666 / 2.350 | 6.650 / 5.503 |
| Piano_close-up.webm | 334.100 / 38.180 | 163.070 / 28.559 | 1453.786 / 40.938 | 39.703 / 19.248 |
| Meet_the_Capacity_Exchange.webm | 1086.667 / 59.617 | 568.531 / 64.053 | 7315.779 / 48.697 | 38.224 / 22.379 |

### What changed when the media became larger?

- **JPEG:** the flower expanded with Fold; the waterfall also expanded and
  stored its only chunk raw. The 14-chunk panorama saved only 13,395 bytes
  (0.09125%), with 11 raw and three DEFLATE chunks. Fold beat plain DEFLATE
  by just 166 bytes there; XZ was smaller than both. Larger JPEG size did not
  establish a consistent Fold advantage.
- **Audio:** all three Vorbis recordings shrank slightly under Fold, but the
  two-chunk rain recording saved only 1,871 bytes (0.09454%), less proportionally
  than either smaller recording. The longest speech saved 8,483 bytes
  (0.84440%) but still fits one chunk. DEFLATE was smaller on all three.
- **Video:** the six-chunk workshop clip saved 17,810 bytes (0.32918%), whereas
  the 20-chunk, 92-second introduction **expanded** by 3,149 bytes (0.01522%),
  using 17 raw and three DEFLATE chunks. Every measured codec expanded that
  introduction; Zstandard had the least overhead (488 bytes).
- **No media file produced any Fold reference or shuffle chunk.** These inputs
  do not exhibit the aligned exact repetition that favors Fold in synthetic
  controls. Media size/duration alone does not imply repeated compressed chunks.
- Fold was not the smallest archive for any media input: DEFLATE was smallest
  for six, XZ for the panorama, and Zstandard for the waterfall and introduction.
  For the latter two, retaining the uncompressed original is smaller still.
- Zstandard expanded eight media files and slightly shrank the panorama. Its
  encoding medians were lower than Fold on all but the tiny flower in this
  run, but that is a harness/host-specific observation, not a universal speed
  ranking. XZ's panorama size advantage came with a much longer encoding time.

The three previously pinned small media inputs reproduce their prior archive
sizes exactly across all four codecs. Timings are fresh observations, not
expected constants. The broader collection supports a **limited** conclusion:
these already-compressed files offer small, inconsistent additional savings,
including losses. It does not show a universal media compression improvement.

## Limits of the expanded collection

- Three works per category is still a small convenience sample from one
  repository, not a random or representative population.
- JPEG content remains photographic and landscape-heavy. It does not cover
  all encoder qualities, scans, screenshots or camera pipelines.
- All audio is lossy mono Vorbis. There is content and bitrate/duration variety,
  but no audio-only Opus, AAC, MP3, FLAC or PCM comparison.
- Video covers VP8/Vorbis and VP9/Opus in WebM, not H.264/H.265/AV1, MP4/MOV,
  4K, feature-length footage or a broad range of motion/encoder settings.
- The largest media file is about 19.73 MiB and the longest video is 92.104 s.
  Crossing 1 MiB establishes real multi-chunk measurements, not arbitrarily
  large-file or hour-long-stream performance.
- Whole-file savings can arise from headers, metadata or container structure;
  this experiment does not localize savings to the compressed media payload.
- Three timing repeats on a shared host are not independent corpus samples,
  confidence intervals or evidence of stable throughput across machines.
- Synthetic repeated controls are intentionally artificial. Their behavior
  must not be presented as media savings, nor used to infer an APK, application
  startup, installed-size or physical storage-density improvement.