"""Input-file validation; all payloads and writes stay in disposable fixtures."""
import contextlib
import copy
import hashlib
import io
import json
import os
from pathlib import Path
import unittest
from unittest.mock import patch

import test_manual_update as legacy
NOW, ROOT, manual = legacy.NOW, legacy.ROOT, legacy.manual


class FileInputTests(unittest.TestCase):
    setUp = legacy.ManualUpdateTests.setUp
    bytes = legacy.ManualUpdateTests.bytes

    def make_payload(self):
        markets = {}
        for key, (symbol, _) in manual.SYMBOLS.items():
            if symbol == "KRW-BTC":
                currency = "KRW"
                source = {"name": "Upbit", "url": "https://api.upbit.com/v1/candles/days?market=KRW-BTC&count=1"}
            elif symbol.endswith(".KS"):
                currency = "KRW"
                source = {"name": "네이버 증권", "url": "https://finance.naver.com/item/sise_day.naver?code=" + symbol[:6]}
            else:
                currency = "USD"
                source = {"name": "Yahoo Finance", "url": "https://finance.yahoo.com/quote/" + symbol + "/history/"}
            markets[symbol] = {"price": float(self.env["INPUT_" + key]), "date": self.dates[symbol], "currency": currency, "source": source}
        return {"schema_version": 1, "trade_date": "2026-10-13", "verified_at": "2026-10-13T17:29:00+09:00", "markets": markets}

    def run_file(self, payload, check=False):
        path = self.root / "closing-prices.json"
        path.write_text(json.dumps(payload, ensure_ascii=False), "utf-8")
        with patch.dict(os.environ, {"INPUT_COMMIT": "a" * 40}, clear=True), contextlib.redirect_stdout(io.StringIO()):
            return manual.main(now=NOW, input_file=path, check=check)

    def assert_invalid(self, payload):
        before = self.bytes()
        with self.assertRaises((ValueError, TypeError, KeyError)):
            self.run_file(payload)
        self.assertEqual(before, self.bytes())

    def test_file_success_keeps_source_currency_dates_and_blob_sha(self):
        payload = self.make_payload()
        payload["markets"]["034020.KS"].update(price=72000, date="2026-10-13")
        self.assertTrue(self.run_file(payload))
        price = json.loads(self.price.read_text("utf-8"))
        hist = json.loads(self.history.read_text("utf-8"))
        raw = (self.root / "closing-prices.json").read_bytes()
        sha = hashlib.sha1(b"blob " + str(len(raw)).encode("ascii") + b"\0" + raw).hexdigest()
        self.assertEqual(price["manualInput"], {"path": manual.INPUT_PATH, "sha": sha, "commit": "a" * 40, "verifiedAt": payload["verified_at"]})
        record = next(r for r in hist["history"] if r["day"] == payload["trade_date"])
        self.assertEqual(record["manualInput"], price["manualInput"])
        for symbol, quote in payload["markets"].items():
            actual = price["markets"][symbol]
            self.assertEqual(actual["date"], quote["date"])
            self.assertEqual(actual["currency"], quote["currency"])
            self.assertEqual(actual["sourceUrl"], quote["source"]["url"])
        self.assertEqual([r for r in hist["history"] if r["day"] != payload["trade_date"]], [r for r in self.legacy["history"] if r["day"] != payload["trade_date"]])

    def test_repeated_or_new_verification_with_same_prices_never_writes(self):
        payload = self.make_payload()
        before = self.bytes()
        self.assertFalse(self.run_file(payload))
        payload["verified_at"] = "2026-10-13T17:30:00+09:00"
        self.assertFalse(self.run_file(payload))
        self.assertEqual(before, self.bytes())

    def test_readonly_file_check_does_not_change_data(self):
        payload = self.make_payload()
        payload["markets"]["NVDA"]["price"] += 1
        before = self.bytes()
        self.assertTrue(self.run_file(payload, check=True))
        self.assertEqual(before, self.bytes())

    def test_schema_rejects_partial_unknown_keys_and_boolean_prices(self):
        base = self.make_payload()
        cases = []
        for field in base:
            p = copy.deepcopy(base)
            del p[field]
            cases.append(p)
        p = copy.deepcopy(base)
        del p["markets"]["KRW-BTC"]
        cases.append(p)
        p = copy.deepcopy(base)
        p["unexpected"] = True
        cases.append(p)
        for value in (True, "226.32", 0, -1, None, float("nan"), float("inf")):
            p = copy.deepcopy(base)
            p["markets"]["NVDA"]["price"] = value
            cases.append(p)
        for version in (True, 2, "1"):
            p = copy.deepcopy(base)
            p["schema_version"] = version
            cases.append(p)
        for p in cases:
            with self.subTest(payload=p):
                self.assert_invalid(p)

    def test_currency_and_source_must_match_asset(self):
        base = self.make_payload()
        cases = [
            ("NVDA", "currency", "KRW"), ("KRW-BTC", "currency", "USD"),
            ("NVDA", "source", None), ("NVDA", "source", {"name": "", "url": base["markets"]["NVDA"]["source"]["url"]}),
        ]
        for url in ("http://finance.yahoo.com/quote/NVDA/", "https://finance.yahoo.com.evil.test/quote/NVDA/", "https://finance.yahoo.com/quote/TSLA/", "https://user:password@finance.yahoo.com/quote/NVDA/", "https://finance.yahoo.com:8443/quote/NVDA/"):
            cases.append(("NVDA", "source", {"name": "Yahoo", "url": url}))
        for url in ("https://api.upbit.com/v1/candles/minutes/1?market=KRW-BTC", "https://api.upbit.com/v1/candles/days?market=KRW-ETH", "https://api.upbit.com/v1/candles/days?market=KRW-BTC&market=KRW-ETH"):
            cases.append(("KRW-BTC", "source", {"name": "Upbit", "url": url}))
        for symbol, field, value in cases:
            p = copy.deepcopy(base)
            p["markets"][symbol][field] = value
            with self.subTest(symbol=symbol, field=field, value=value):
                self.assert_invalid(p)

    def test_unclosed_future_and_weekend_candles_are_rejected(self):
        base = self.make_payload()
        for symbol, day in (("NVDA", "2026-10-13"), ("KRW-BTC", "2026-10-13"), ("034020.KS", "2026-10-14"), ("TSLA", "2026-10-11")):
            p = copy.deepcopy(base)
            p["markets"][symbol]["date"] = day
            self.assert_invalid(p)
        p = copy.deepcopy(base)
        p["verified_at"] = "2026-10-13T15:30:00+09:00"
        p["markets"]["034020.KS"]["date"] = "2026-10-13"
        self.assert_invalid(p)

    def test_verification_timestamp_must_be_aware_recent_and_same_snapshot_day(self):
        for value in ("2026-10-13T17:29:00", "2026-10-13T17:31:00+09:00", "2026-10-12T17:29:00+09:00", None):
            p = self.make_payload()
            p["verified_at"] = value
            self.assert_invalid(p)
        p = self.make_payload()
        p["trade_date"] = "2026-10-11"
        p["verified_at"] = "2026-10-11T17:29:00+09:00"
        self.assert_invalid(p)

    def test_older_close_cannot_overwrite_current_data(self):
        p = self.make_payload()
        p["markets"]["NVDA"]["date"] = "2026-10-09"
        self.assert_invalid(p)

    def test_duplicate_keys_and_missing_file_never_fall_back_to_environment(self):
        p = self.make_payload()
        path = self.root / "closing-prices.json"
        path.write_text(json.dumps(p)[:-1] + ',"schema_version":1}', "utf-8")
        before = self.bytes()
        with patch.dict(os.environ, self.env, clear=True):
            with self.assertRaises(ValueError):
                manual.main(now=NOW, input_file=path)
            with self.assertRaises(FileNotFoundError):
                manual.main(now=NOW, input_file=self.root / "absent.json")
        self.assertEqual(before, self.bytes())


if __name__ == "__main__":
    unittest.main()
