"""Offline regression tests: only temporary copies of data are written."""
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from datetime import datetime, timedelta
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("manual_update", ROOT / "scripts/manual_update.py")
manual = importlib.util.module_from_spec(spec)
spec.loader.exec_module(manual)
NOW = datetime.fromisoformat("2026-10-13T17:30:00+09:00")


class ManualUpdateTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="sool-test-", dir=ROOT.parent)
        self.root = Path(self.temp.name)
        assert self.root.resolve().is_relative_to(ROOT.parent.resolve())
        self.addCleanup(self.temp.cleanup)
        (self.root / "data").mkdir()
        self.price = self.root / "data/prices.json"
        self.history = self.root / "data/history.json"
        shutil.copyfile(ROOT / "data/prices.json", self.price)
        shutil.copyfile(ROOT / "data/history.json", self.history)
        self.legacy = json.loads(self.history.read_text("utf-8"))
        prior = json.loads(self.price.read_text("utf-8"))
        # Fix dates in this temporary fixture so future real updates do not break tests.
        self.dates = {s: "2026-10-12" for s, _ in manual.SYMBOLS.values()}
        for symbol, close_day in self.dates.items():
            prior["markets"][symbol]["date"] = close_day
        prior["mode"] = "live"
        prior["locked"] = False
        self.price.write_text(json.dumps(prior), "utf-8")
        self.env = {"INPUT_TRADE_DATE": "2026-10-13"}
        for key, (symbol, _) in manual.SYMBOLS.items():
            self.env["INPUT_" + key] = str(prior["markets"][symbol]["price"])
        self.env["INPUT_PRICE_DATES"] = json.dumps(self.dates)
        self.paths = patch.multiple(manual, PRICE=self.price, HISTORY=self.history)
        self.paths.start()
        self.addCleanup(self.paths.stop)

    def run_update(self, **kwargs):
        with patch.dict(os.environ, self.env, clear=True), contextlib.redirect_stdout(io.StringIO()):
            return manual.main(now=NOW, **kwargs)

    def bytes(self):
        return self.price.read_bytes(), self.history.read_bytes()

    def assert_rejected_unchanged(self):
        before = self.bytes()
        with self.assertRaises((ValueError, KeyError, TypeError)):
            self.run_update()
        self.assertEqual(before, self.bytes())

    def changed_input(self):
        self.dates["034020.KS"] = "2026-10-13"
        self.env["INPUT_PRICE_DATES"] = json.dumps(self.dates)
        self.env["INPUT_KR_034020"] = "72,000"

    def test_distinct_dates_snapshot_and_frontend_compatibility(self):
        self.changed_input()
        self.assertTrue(self.run_update())
        price = json.loads(self.price.read_text("utf-8"))
        hist = json.loads(self.history.read_text("utf-8"))
        record = next(r for r in hist["history"] if r["day"] == "2026-10-13")
        self.assertEqual(price["updatedAt"], NOW.isoformat(timespec="seconds"))
        self.assertEqual(record["updatedAt"], price["updatedAt"])
        self.assertEqual(record["priceDates"], self.dates)
        self.assertEqual({s: q["date"] for s, q in price["markets"].items()}, self.dates)
        self.assertEqual(record["ranks"]["eunji"], record["ranks"]["dongmin"])
        self.assertEqual(len(record["returns"]), 9)
        self.assertEqual(len(record["losers"]), 3)
        old = [r for r in self.legacy["history"] if r.get("day") != "2026-10-13"]
        retained = [r for r in hist["history"] if r.get("day") != "2026-10-13"]
        self.assertEqual(old, retained)
        if not shutil.which("node"):
            self.skipTest("Node is required for the frontend compatibility check")
        result = subprocess.run(
            ["node", str(ROOT / "tests/manual_frontend.cjs"), str(ROOT), str(self.root)],
            capture_output=True, text=True, encoding="utf-8", check=True,
        )
        self.assertIn("ranking and weekly chart compatible", result.stdout)

    def test_noop_preserves_bytes_mtime_and_next_day_history(self):
        before = self.bytes()
        mtimes = self.price.stat().st_mtime_ns, self.history.stat().st_mtime_ns
        self.assertFalse(self.run_update())
        self.env["INPUT_TRADE_DATE"] = "2026-10-14"
        with patch.dict(os.environ, self.env, clear=True), contextlib.redirect_stdout(io.StringIO()):
            self.assertFalse(manual.main(now=NOW + timedelta(days=1)))
        self.assertEqual(before, self.bytes())
        self.assertEqual(mtimes, (self.price.stat().st_mtime_ns, self.history.stat().st_mtime_ns))

    def test_same_price_new_close_date_is_a_change(self):
        self.dates["034020.KS"] = "2026-10-13"
        self.env["INPUT_PRICE_DATES"] = json.dumps(self.dates)
        self.assertTrue(self.run_update())

    def test_readonly_check_never_writes(self):
        before = self.bytes()
        self.assertFalse(self.run_update(check=True))
        self.changed_input()
        self.assertTrue(self.run_update(check=True))
        self.assertEqual(before, self.bytes())

    def test_dates_required_and_all_exact_keys(self):
        del self.env["INPUT_PRICE_DATES"]
        self.assert_rejected_unchanged()
        for value in ({}, [], {**self.dates, "EXTRA": "2026-10-12"}, {k: v for k, v in self.dates.items() if k != "KRW-BTC"}):
            with self.subTest(value=value):
                self.env["INPUT_PRICE_DATES"] = json.dumps(value)
                self.assert_rejected_unchanged()

    def test_duplicate_date_key_is_rejected(self):
        self.env["INPUT_PRICE_DATES"] = json.dumps(self.dates)[:-1] + ',"NVDA":"2026-10-11"}'
        self.assert_rejected_unchanged()

    def test_invalid_dates_cannot_create_records(self):
        for value in (None, "", "20261012", "2026-02-30", "2025-12-31", "2027-01-01", "2026-10-14"):
            with self.subTest(value=value):
                self.env["INPUT_PRICE_DATES"] = json.dumps({**self.dates, "011200.KS": value})
                self.assert_rejected_unchanged()
        for value in ("", "20261013", "2026-10-14", "2027-01-01"):
            with self.subTest(snapshot=value):
                self.env["INPUT_PRICE_DATES"] = json.dumps(self.dates)
                self.env["INPUT_TRADE_DATE"] = value
                self.assert_rejected_unchanged()

    def test_partial_or_invalid_price_is_rejected_before_any_write(self):
        self.changed_input()
        del self.env["INPUT_KR_011200"]
        self.assert_rejected_unchanged()
        for value in ("", "0", "-1", "nan", "inf", "-inf", "not a price"):
            with self.subTest(value=value):
                self.env["INPUT_KR_011200"] = value
                self.assert_rejected_unchanged()

    def test_malformed_existing_files_are_not_silently_reset(self):
        self.changed_input()
        for path in (self.price, self.history):
            original = path.read_bytes()
            for invalid in ("{broken", "[]", '{"history":{}}' if path == self.history else '{"markets":[]}'):
                path.write_text(invalid, "utf-8")
                self.assert_rejected_unchanged()
            path.write_bytes(original)

    def test_locked_result_is_not_unlocked(self):
        self.changed_input()
        prior = json.loads(self.price.read_text("utf-8"))
        prior["locked"] = True
        self.price.write_text(json.dumps(prior), "utf-8")
        self.assert_rejected_unchanged()

    def test_same_snapshot_replaced_without_duplicate_and_metadata_preserved(self):
        self.changed_input()
        self.legacy["testMetadata"] = {"keep": True}
        self.history.write_text(json.dumps(self.legacy), "utf-8")
        self.assertTrue(self.run_update())
        self.env["INPUT_NVDA"] = "230"
        self.assertTrue(self.run_update())
        hist = json.loads(self.history.read_text("utf-8"))
        self.assertEqual(hist["testMetadata"], {"keep": True})
        self.assertEqual(sum(r["day"] == "2026-10-13" for r in hist["history"]), 1)

    def test_workflow_output_on_noop_cli(self):
        (self.root / "scripts").mkdir()
        shutil.copyfile(ROOT / "scripts/manual_update.py", self.root / "scripts/manual_update.py")
        output = self.root / "step_output"
        before = self.bytes()
        env = {**os.environ, **self.env, "GITHUB_OUTPUT": str(output), "PYTHONUTF8": "1"}
        result = subprocess.run([sys.executable, str(self.root / "scripts/manual_update.py")], env=env, capture_output=True)
        self.assertEqual(result.returncode, 0, result.stderr.decode("utf-8"))
        self.assertEqual(output.read_text("utf-8"), "changed=false\n")
        self.assertEqual(before, self.bytes())


if __name__ == "__main__":
    unittest.main()
