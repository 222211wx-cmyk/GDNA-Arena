"""Offline, deterministic synthetic corpus and file-to-file compression measurement."""
import hashlib
import html
import json
import lzma
import platform
import shutil
import statistics
import struct
import subprocess
import time
import zlib
from datetime import datetime, timezone
from pathlib import Path

from fold import CHUNK, pack, unpack


def sha(data):
    return hashlib.sha256(data).hexdigest()


def noise(label, length):
    # SHAKE-256 is reproducible across Python versions; no OS randomness.
    return hashlib.shake_256(label.encode("ascii")).digest(length)


def png(width, height, pixels):
    def chunk(kind, data):
        return (struct.pack(">I", len(data)) + kind + data
                + struct.pack(">I", zlib.crc32(kind + data)))
    rows = b"".join(b"\0" + pixels[y * width * 3:(y + 1) * width * 3]
                    for y in range(height))
    return (b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(rows, 9)) + chunk(b"IEND", b""))


def corpus():
    block = noise("digital-fold-repeat-v1", CHUNK)
    yield "text.txt", "text", (
        "".join(f"Record {i:06d}: lossless storage preserves every byte. "
                f"الضغط دون فقدان البيانات. category={i % 17}\n"
                for i in range(9000)).encode("utf-8")
    ), "Original synthetic UTF-8 English/Arabic records, 9000 numbered rows."
    yield "structured.bin", "binary", b"".join(
        struct.pack("<Q", i) for i in range(131072)
    ), "131072 sequential unsigned little-endian 64-bit integers."
    yield "noise.bin", "binary", noise("digital-fold-noise-v1", CHUNK), (
        "SHAKE-256(label=digital-fold-noise-v1), 1 MiB; incompressible control."
    )
    yield "repeated.bin", "repeated", block * 4, (
        "Four aligned copies of SHAKE-256(label=digital-fold-repeat-v1), each 1 MiB."
    )
    yield "short-repeat.bin", "repeated", b"ABCD0123" * 131072, (
        "Eight-byte literal ABCD0123 repeated 131072 times; ordinary compression control."
    )
    yield "noise.png", "compressed media", png(
        512, 512, noise("digital-fold-png-v1", 512 * 512 * 3)
    ), "Synthetic 512x512 RGB noise PNG, filter 0, zlib level 9, SHAKE-256 label digital-fold-png-v1."
    yield "gradient.png", "compressed media", png(
        512, 512, bytes(v for y in range(512) for x in range(512)
                        for v in (x % 256, y % 256, (x + y) % 256))
    ), "Synthetic 512x512 RGB gradient PNG, filter 0, zlib level 9."


def exclusive(path, data):
    with path.open("xb") as stream:
        stream.write(data)


def baseline_encode(source, target, codec):
    data = source.read_bytes()
    if codec == "DEFLATE":
        output = zlib.compress(data, 9)
    elif codec == "LZMA":
        output = lzma.compress(data, format=lzma.FORMAT_XZ, preset=6)
    else:
        subprocess.run(["zstd", "-q", "-3", "--no-progress", str(source),
                        "-o", str(target)], check=True)
        return
    exclusive(target, output)


def baseline_decode(source, target, codec):
    if codec == "Zstandard":
        subprocess.run(["zstd", "-q", "-d", str(source), "-o", str(target)], check=True)
        return
    payload = source.read_bytes()
    output = zlib.decompress(payload) if codec == "DEFLATE" else lzma.decompress(payload)
    exclusive(target, output)


def run(root, report, repeats):
    if repeats < 1:
        raise ValueError("repeats must be positive")
    # A fresh directory is mandatory; previous corpus, archives and reconstructions survive.
    root.mkdir(parents=True, exist_ok=False)
    originals = root / "originals"
    originals.mkdir()
    codecs = ["Fold", "DEFLATE", "LZMA"]
    zstd = shutil.which("zstd")
    if zstd:
        codecs.append("Zstandard")
    metadata = {
        "generated_utc": datetime.now(timezone.utc).isoformat(),
        "python": platform.python_version(), "platform": platform.platform(),
        "zlib": zlib.ZLIB_RUNTIME_VERSION,
        "zstandard": subprocess.check_output(["zstd", "--version"], text=True).strip()
        if zstd else "Unavailable: zstd executable not found; not measured.",
        "repeats": repeats, "chunk_bytes": CHUNK,
        "parameters": {"Fold": "1 MiB chunks, raw/zlib9/shuffle8-zlib9; baseline disabled",
                       "DEFLATE": "zlib wrapper, level 9",
                       "LZMA": "XZ container, preset 6",
                       "Zstandard": "CLI level 3, default frame, if installed"},
        "timing": "Median file-to-file wall time; no fsync; warm cache; validation outside timing. "
                  "All individual samples retained. No warmup. Fixed codec order.",
        "provenance": "All inputs generated locally by benchmark.py; no downloads, personal data or app files.",
        "corpus": [], "rows": [],
    }
    for name, category, data, description in corpus():
        source = originals / name
        exclusive(source, data)
        item = {"name": name, "category": category, "bytes": len(data),
                "sha256": sha(data), "provenance": description}
        metadata["corpus"].append(item)
        for codec in codecs:
            folder = root / name / codec
            folder.mkdir(parents=True)
            encode_times, decode_times, sizes = [], [], []
            for trial in range(repeats):
                archive = folder / f"{trial}.archive"
                restored = folder / f"{trial}.restored"
                start = time.perf_counter()
                if codec == "Fold":
                    pack(source, archive, measure_baseline=False)
                else:
                    baseline_encode(source, archive, codec)
                encode_times.append(time.perf_counter() - start)
                start = time.perf_counter()
                if codec == "Fold":
                    unpack(archive, restored)
                else:
                    baseline_decode(archive, restored, codec)
                decode_times.append(time.perf_counter() - start)
                if restored.read_bytes() != data:
                    raise ValueError(f"Reconstruction mismatch: {name}/{codec}/{trial}")
                sizes.append(archive.stat().st_size)
            if len(set(sizes)) != 1:
                raise ValueError("Archive size changed across repetitions")
            metadata["rows"].append({
                "file": name, "codec": codec, "source_bytes": len(data),
                "archive_bytes": sizes[0], "ratio": len(data) / sizes[0],
                "encode_seconds": statistics.median(encode_times),
                "decode_seconds": statistics.median(decode_times),
                "encode_samples": encode_times, "decode_samples": decode_times,
                "exact_match": True, "restored_sha256": sha(data),
            })
        if source.read_bytes() != data:
            raise ValueError(f"Original changed: {name}")
    exclusive(root / "measurements.json",
              (json.dumps(metadata, indent=2, ensure_ascii=False) + "\n").encode())
    report.parent.mkdir(parents=True, exist_ok=True)
    report.write_text(render(metadata), encoding="utf-8")
    return {"report": str(report), "measurements": str(root / "measurements.json"),
            "files": len(metadata["corpus"]), "codecs": codecs, "exact_matches": True}


def render(m):
    esc = html.escape
    rows = []
    comparisons = []
    for item in m["corpus"]:
        results = [r for r in m["rows"] if r["file"] == item["name"]]
        fold = results[0]
        for other in results[1:]:
            delta = (fold["archive_bytes"] / other["archive_bytes"] - 1) * 100
            comparisons.append(f"<li><code>{esc(item['name'])}</code> مقابل {other['codec']}: "
                               f"حجم الطي {'أكبر' if delta > 0 else 'أصغر'} بـ {abs(delta):.2f}%.</li>")
        for r in results:
            rows.append(f"<tr><td>{esc(r['file'])}</td><td>{r['codec']}</td>"
                        f"<td>{r['source_bytes']:,}</td><td>{r['archive_bytes']:,}</td>"
                        f"<td>{r['ratio']:.3f}:1</td>"
                        f"<td>{r['encode_seconds'] * 1000:.3f}</td>"
                        f"<td>{r['decode_seconds'] * 1000:.3f}</td><td>مطابق</td></tr>")
    provenance = "".join(f"<li><code>{esc(c['name'])}</code> ({esc(c['category'])}): "
                         f"{esc(c['provenance'])}<br>SHA-256: <code>{c['sha256']}</code></li>"
                         for c in m["corpus"])
    return f"""<!doctype html>
<html lang="ar" dir="rtl"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>قياس الطي الرقمي على مجموعة مضبوطة</title>
<style>body{{font-family:system-ui;max-width:1200px;margin:32px auto;padding:20px;line-height:1.8}}
table{{border-collapse:collapse;width:100%}}td,th{{border:1px solid #bbb;padding:8px;text-align:right}}
code,pre{{direction:ltr;unicode-bidi:embed;overflow-wrap:anywhere}}.scroll{{overflow:auto}}</style>
<h1>الطي الرقمي: قياس على مجموعة اصطناعية مضبوطة</h1>
<p>هذه مقارنة لتقنيات معروفة، وليست اختراعاً مثبتاً أو وعداً بضغط شامل 10:1.
النتائج تخص هذه العينات فقط. الملفات الأصلية محفوظة؛ لم نغيّر التطبيق أو بناء الهاتف أو نشغّل اختبارات التطبيق.</p>
<h2>المنهج والبيئة</h2>
<p>وقت القياس UTC: <code>{esc(m['generated_utc'])}</code>.
Python {esc(m['python'])}؛ zlib {esc(m['zlib'])}. <code>{esc(m['platform'])}</code></p>
<p>Zstandard: <span dir="ltr">{esc(m['zstandard'])}</span></p>
<p>لكل ملف وطريقة {m['repeats']} محاولات؛ الزمن بالميلي ثانية هو الوسيط، ويشمل القراءة والكتابة
دون fsync. ذاكرة الملفات المؤقتة دافئة، دون جولة إحماء منفصلة، وبترتيب طرق ثابت.
التحقق المباشر بايتاً ببايت خارج الزمن. فحوص الطي الداخلية جزء من زمنه.
القياس ليس معياراً لأداء الهاتف، وقد تتذبذب الأزمنة في البيئة المشتركة.
الطرق المرجعية تحمل الملف في الذاكرة؛ الطي يعالج قطعاً. لم نقس ذروة الذاكرة.
عند توفر Zstandard يشمل زمنه إطلاق العملية.</p>
<p>الطي: قطع 1 MiB مع إزالة التكرار واختيار الخام أو zlib-9 أو shuffle8 ثم zlib-9.
أوقفنا حساب خط الأساس الإضافي داخل الطي أثناء قياسه.
DEFLATE: مستوى 9 بغلاف zlib؛ LZMA: حاوية XZ وإعداد 6؛ Zstandard عند توفره: مستوى 3.
هذه إعدادات محددة وليست مقارنة بمستويات متساوية أو بحثاً عن أفضل إعداد لكل طريقة.</p>
<h2>الحجم الكامل والزمن والتطابق</h2>
<p>الأحجام تشمل الحاويات والقواميس والمراجع والبصمات والبيانات الوصفية اللازمة للفك.
لا قاموس خارجي. لا تشمل شيفرة المفكك أو بيئة تشغيله أو ملف التقرير
أو أسماء ملفات نظام التشغيل وكتل القرص. النسبة = الأصل ÷ الأرشيف؛ أقل من 1 تعني زيادة الحجم.</p>
<div class="scroll"><table><thead><tr><th>الملف</th><th>الطريقة</th><th>الأصل / بايت</th>
<th>الأرشيف الكامل / بايت</th><th>النسبة</th><th>الترميز / ms</th><th>الفك / ms</th>
<th>الاسترجاع لكل المحاولات</th></tr></thead><tbody>{''.join(rows)}</tbody></table></div>
<h2>التحسينات والتراجعات</h2><ul>{''.join(comparisons)}</ul>
<p>التكرار المطابق والمحاذي لحدود القطع يمنح الطي حالة ملائمة عمداً؛ لا يمثل ملفات عشوائية عامة.
الضوضاء والوسائط المضغوطة تقيّدان الفائدة، وقد تزيد كلفة البيانات الوصفية الحجم.
العينتان الإعلاميتان PNG فقط: لا تعمم النتيجة على JPEG أو الصوت أو الفيديو أو APK.
لا نحذف الحالات الأسوأ، ولا نستنتج تفوقاً عاماً من مجموع أحجام عينات اختيرت اصطناعياً.</p>
<h2>متطلبات الاسترجاع والحدود</h2>
<p>الطي يحتاج fold.py وPython 3.8+ مع zipfile وzlib وhashlib.
DEFLATE يحتاج مفككاً يقبل غلاف zlib؛ LZMA يحتاج دعم XZ؛ Zstandard يحتاج مفكك Zstandard.
جميع مراجع الطي داخل الأرشيف. المفكك التجريبي مخصص لأرشيفات محلية موثوقة، وليس محصناً لمدخلات عدائية.
يلزم مكان للأرشيف والملف المسترجع؛ حجم النقل لا يساوي حجم التثبيت أو RAM.
ملف .fold لا يُثبّت كـAPK؛ يجب استرجاع APK الأصلي أولاً. هذه التجربة لا تصلح أخطاء تشغيل التطبيقات.</p>
<h2>مصادر المجموعة</h2><p>كل البيانات مولدة محلياً بشيفرة benchmark.py، دون تنزيلات أو ملفات شخصية.
SHAKE-256 ثابت الوسم، وليس مولداً عشوائياً يتغير بين التشغيلات.
قد تتغير بايتات PNG عند تغيير إصدار zlib؛ البصمات هنا توثّق المجموعة المقاسة.</p><ul>{provenance}</ul>
<h2>إعادة الإنتاج</h2>
<pre dir="ltr">python research/digital-fold/fold.py benchmark /tmp/digital-fold-corpus-v1 /tmp/digital-fold-results.html --repeats 3</pre>
<p>اختر مسار مجموعة غير موجود: يرفض البرنامج الكتابة فوق مجموعة سابقة.
يحتوي originals على الأصول وmeasurements.json على البيئة والبصمات وجميع عينات الزمن،
وتحفظ الأرشيفات والنسخ المسترجعة لكل محاولة. يمكن تحديث نسخة التقرير الرئيسية بعد القياس.
النتيجة السابقة لملف APK محفوظة في previous-apk-results.html كمرجع تاريخي، ولم نعد قياسها أو نخلطها بهذه المجموعة.</p>
</html>"""