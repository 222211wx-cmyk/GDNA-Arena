"""Research-only guards. No application imports, network or app test runners."""
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from benchmark import exclusive, run
from public_benchmark import SAMPLES, extra_corpus, repetition_controls, verified, manifest


class PublicCorpusTests(unittest.TestCase):
    def test_pinned_originals_and_complete_media_set(self):
        samples = list(extra_corpus(SAMPLES / "originals"))
        self.assertEqual(len(samples), len(manifest()["samples"]) + 3)
        from fold import CHUNK
        for category in ("public JPEG", "public audio", "public video"):
            members = [s for s in samples if s[1] == category]
            self.assertGreaterEqual(len(members), 3)
            self.assertTrue(any(len(s[2]) > CHUNK for s in members))
            self.assertEqual(len({s[4]["source_page"] for s in members}), len(members))
        for item in manifest()["samples"]:
            for key in ("creator", "license", "license_url", "source_revision", "download_url"):
                self.assertTrue(item[key])

    def test_non_aligned_controls_keep_repeat_but_change_boundaries(self):
        controls = list(repetition_controls())
        self.assertEqual([c[4]["control"]["expected_fold_references"] for c in controls],
                         [2, 0, 0])
        for _, _, data, _, details in controls:
            starts = details["control"]["repeat_starts_bytes"]
            from fold import CHUNK
            self.assertTrue(any(start % CHUNK for start in starts))
            self.assertEqual(len({data[start:start + CHUNK] for start in starts}), 1)

    def test_replaced_and_truncated_samples_fail(self):
        item = manifest()["samples"][0]
        data = (SAMPLES / "originals" / item["name"]).read_bytes()
        for invalid in (data[:-1], bytes([data[0] ^ 1]) + data[1:]):
            with self.assertRaises(ValueError):
                verified(invalid, item)

    def test_exclusive_writes_and_missing_zstd_fail_closed(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            original = root / "original"
            exclusive(original, b"original bytes")
            with self.assertRaises(FileExistsError):
                exclusive(original, b"replacement")
            self.assertEqual(original.read_bytes(), b"original bytes")
            with patch("benchmark.shutil.which", return_value=None):
                with self.assertRaisesRegex(RuntimeError, "requires zstd"):
                    run(root / "run", root / "report.html", 3, require_zstd=True)
            self.assertFalse((root / "run").exists())

    def test_existing_run_and_nested_report_refused(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            with self.assertRaises(FileExistsError):
                run(root, root.parent / "unused.html", 1)
            with self.assertRaisesRegex(ValueError, "outside"):
                run(root / "new", root / "new" / "report.html", 1)
            self.assertFalse((root / "new").exists())


if __name__ == "__main__":
    unittest.main()