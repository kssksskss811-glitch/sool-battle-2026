"""Synthetic 09:10 fixtures only; no real input, collectors or network requests."""
import contextlib
import copy
import io
import json
import os
from datetime import datetime, timedelta
from unittest.mock import patch
import unittest

import test_manual_input as legacy
manual = legacy.manual

NOW = datetime.fromisoformat("2026-10-13T09:10:00+09:00")


class MarketQuoteTests(unittest.TestCase):
    setUp = legacy.FileInputTests.setUp
    bytes = legacy.FileInputTests.bytes

    def payload(self):
        p = legacy.FileInputTests.make_payload(self)
        p.update(schema_version=2, verified_at=NOW.isoformat())
        for symbol, q in p["markets"].items():
            q.update(price_type="last_trade", session="day" if q["currency"] == "USD" else "regular",
                     as_of="2026-10-12T20:09:00-04:00" if q["currency"] == "USD" else "2026-10-13T09:09:00+09:00",
                     delay={"status": "realtime", "minutes": 0})
            if q["currency"] == "KRW":
                q["date"] = "2026-10-13"
            if symbol == "KRW-BTC":
                q.update(price_type="spot", session="continuous")
                q["source"]["url"] = "https://api.upbit.com/v1/ticker?markets=KRW-BTC"
        return p

    def run_file(self, p, check=False, now=NOW):
        path = self.root / "quotes.json"
        path.write_text(json.dumps(p, ensure_ascii=False), "utf-8")
        with patch.dict(os.environ, {"INPUT_COMMIT": "a" * 40}, clear=True), contextlib.redirect_stdout(io.StringIO()):
            return manual.main(now=now, input_file=path, check=check)

    def reject(self, p, now=NOW):
        before = self.bytes()
        with self.assertRaises((ValueError, TypeError, KeyError)):
            self.run_file(p, now=now)
        self.assertEqual(before, self.bytes())

    def test_0910_mixed_markets_and_history_preserve_actual_basis(self):
        p = self.payload()
        p["markets"]["034020.KS"]["delay"] = {"status": "delayed", "minutes": 1}
        p["markets"]["GOOGL"]["delay"] = {"status": "unknown", "minutes": None}
        self.assertTrue(self.run_file(p))
        saved = json.loads(self.price.read_text("utf-8"))
        hist = json.loads(self.history.read_text("utf-8"))
        row = next(r for r in hist["history"] if r["day"] == p["trade_date"])
        self.assertEqual(row["quotes"], saved["markets"])
        self.assertEqual(saved["manualInput"]["schemaVersion"], 2)
        self.assertEqual(saved["manualInput"]["verifiedAt"], p["verified_at"])
        self.assertEqual(saved["markets"]["NVDA"]["asOf"], "2026-10-13T09:09:00+09:00")
        self.assertTrue(saved["markets"]["034020.KS"]["stale"])
        self.assertTrue(saved["markets"]["GOOGL"]["stale"])
        self.assertFalse(saved["markets"]["KRW-BTC"]["stale"])
        self.assertEqual(row["ranks"]["eunji"], row["ranks"]["dongmin"])
        self.assertEqual(len(row["losers"]), 3)
        self.assertEqual([r for r in hist["history"] if r["day"] != p["trade_date"]],
                         [r for r in self.legacy["history"] if r["day"] != p["trade_date"]])
        # Exercise the site's actual ranking/weekly functions against this new output.
        import subprocess
        from test_manual_update import ROOT
        result = subprocess.run(["node", str(ROOT / "tests/manual_frontend.cjs"), str(ROOT), str(self.root)],
                                check=True, capture_output=True, text=True, encoding="utf-8")
        self.assertIn("ranking and weekly chart compatible", result.stdout)

    def test_readonly_check_and_identical_reverification_preserve_files(self):
        p = self.payload()
        before = self.bytes()
        self.assertTrue(self.run_file(p, check=True))
        self.assertEqual(before, self.bytes())
        self.assertTrue(self.run_file(p))
        before = self.bytes()
        mtimes = (self.price.stat().st_mtime_ns, self.history.stat().st_mtime_ns)
        p["verified_at"] = (NOW + timedelta(seconds=1)).isoformat()
        self.assertFalse(self.run_file(p, now=NOW + timedelta(seconds=1)))
        self.assertEqual(before, self.bytes())
        self.assertEqual(mtimes, (self.price.stat().st_mtime_ns, self.history.stat().st_mtime_ns))

    def test_same_price_new_time_or_metadata_is_a_change(self):
        p = self.payload()
        self.assertTrue(self.run_file(p))
        for field, value in (("as_of", "2026-10-12T20:09:01-04:00"),
                             ("delay", {"status": "unknown", "minutes": None}),
                             ("source", {"name": "Corrected source", "url": "https://nasdaq.com/market-activity/stocks/NVDA"})):
            p["markets"]["NVDA"][field] = value
            with self.subTest(field=field):
                self.assertTrue(self.run_file(p))

    def test_equivalent_offsets_are_identical_and_subseconds_are_preserved(self):
        p = self.payload()
        p["markets"]["NVDA"]["as_of"] = "2026-10-13T00:09:00.123456Z"
        self.assertTrue(self.run_file(p))
        q = json.loads(self.price.read_text("utf-8"))["markets"]["NVDA"]
        self.assertEqual(q["asOf"], "2026-10-13T09:09:00.123456+09:00")
        p["markets"]["NVDA"]["as_of"] = q["asOf"]
        self.assertFalse(self.run_file(p))

    def test_all_assets_keep_numeric_currency_and_source_validation(self):
        for symbol in self.payload()["markets"]:
            for field, value in (("price", True), ("price", 0), ("price", -1), ("price", "100"),
                                 ("price", float("nan")), ("price", float("inf")),
                                 ("currency", "EUR"), ("source", {"name": "Bad", "url": "https://example.invalid/" + symbol})):
                p = self.payload()
                p["markets"][symbol][field] = value
                with self.subTest(symbol=symbol, field=field, value=value):
                    self.reject(p)

    def test_metadata_required_and_unknown_fields_rejected(self):
        for field in ("as_of", "price_type", "session", "delay"):
            p = self.payload()
            del p["markets"]["NVDA"][field]
            self.reject(p)
        p = self.payload()
        p["markets"]["NVDA"]["retrieved_at"] = NOW.isoformat()
        self.reject(p)

    def test_actual_timestamps_are_not_retrieval_time_or_future(self):
        for value in (None, "2026-10-12", "2026-10-13T09:09:00", "2026-10-13T09:09+09:00",
                      "2026-10-13T09:10:01+09:00", "2026-10-11T20:09:00-04:00"):
            p = self.payload()
            p["markets"]["NVDA"]["as_of"] = value
            self.reject(p)
        for value in ("2026-10-13T09:11:00+09:00", "2026-10-12T09:10:00+09:00", "2026-10-13T09:10:00"):
            p = self.payload()
            p["verified_at"] = value
            self.reject(p)
        self.reject(self.payload(), now=NOW + timedelta(hours=37))

    def test_same_day_time_regression_and_legacy_close_floor_rejected(self):
        p = self.payload()
        self.assertTrue(self.run_file(p))
        p["markets"]["NVDA"]["as_of"] = "2026-10-12T20:08:00-04:00"
        self.reject(p)
        # Same local source day but before the old completed regular close must not replace v1.
        fresh = json.loads(self.price.read_text("utf-8"))
        for q in fresh["markets"].values():
            for field in ("asOf", "priceType", "session", "delay"):
                q.pop(field, None)
        fresh["markets"]["NVDA"]["date"] = "2026-10-12"
        self.price.write_text(json.dumps(fresh), "utf-8")
        p["markets"]["NVDA"].update(as_of="2026-10-12T15:00:00-04:00", session="regular")
        self.reject(p)

    def test_older_snapshot_day_and_locked_result_are_rejected(self):
        p = self.payload()
        prior = json.loads(self.price.read_text("utf-8"))
        prior["manualInput"] = {"verifiedAt": "2026-10-14T09:10:00+09:00"}
        self.price.write_text(json.dumps(prior), "utf-8")
        self.reject(p)
        prior.pop("manualInput")
        prior["locked"] = True
        self.price.write_text(json.dumps(prior), "utf-8")
        self.reject(p)

    def test_asset_session_type_pairs_and_delay_flags_are_strict(self):
        for symbol, kind, session in (("NVDA", "spot", "continuous"), ("NVDA", "last_trade", "extended"),
                                      ("NVDA", "previous_close", "pre"), ("034020.KS", "last_trade", "day"),
                                      ("KRW-BTC", "last_trade", "regular"), ("KRW-BTC", "spot", "daily"),
                                      ("NVDA", [], "day"), ("NVDA", "last_trade", [])):
            p = self.payload()
            p["markets"][symbol].update(price_type=kind, session=session)
            self.reject(p)
        for delay in ({}, {"status": "delayed", "minutes": 0}, {"status": "delayed", "minutes": True},
                      {"status": "delayed", "minutes": 1.5}, {"status": "realtime", "minutes": 15},
                      {"status": "unknown", "minutes": 0}, {"status": "live", "minutes": None}):
            p = self.payload()
            p["markets"]["NVDA"]["delay"] = delay
            self.reject(p)

    def test_pre_regular_after_and_day_sessions_are_preserved(self):
        # These are source-declared sessions in synthetic historical inputs, never inferred at 09:10.
        for session, clock in (("pre", "08:00"), ("regular", "15:59"), ("after", "19:59"), ("day", "20:09")):
            with self.subTest(session=session):
                p = self.payload()
                p["markets"]["NVDA"].update(session=session, as_of=f"2026-10-12T{clock}:00-04:00")
                path = self.root / "session.json"
                path.write_text(json.dumps(p), "utf-8")
                _, markets, _ = manual.load_input(path, NOW)
                self.assertEqual(markets["NVDA"]["session"], session)

    def test_previous_close_and_completed_btc_candle_compatibility(self):
        p = self.payload()
        for symbol, q in p["markets"].items():
            q.update(date="2026-10-12", price_type="previous_close", session="regular",
                     as_of="2026-10-12T16:00:00-04:00" if q["currency"] == "USD" else "2026-10-12T15:30:00+09:00")
            if symbol == "KRW-BTC":
                q.update(price_type="daily_close", session="daily", as_of="2026-10-13T09:00:00+09:00")
                q["source"]["url"] = "https://api.upbit.com/v1/candles/days?market=KRW-BTC&count=1"
        self.assertTrue(self.run_file(p))
        old_input = legacy.FileInputTests.make_payload(self)
        old_input["verified_at"] = NOW.isoformat()
        self.reject(old_input)  # Removing v2 actual-time metadata is not an identical old close.
        p["markets"]["KRW-BTC"].update(date="2026-10-13", as_of="2026-10-14T09:00:00+09:00")
        self.reject(p)

    def test_spot_and_daily_sources_cannot_be_swapped_or_market_duplicated(self):
        for url in ("https://api.upbit.com/v1/candles/days?market=KRW-BTC",
                    "https://api.upbit.com/v1/ticker?markets=KRW-ETH",
                    "https://api.upbit.com/v1/ticker?markets=KRW-BTC&markets=",
                    "https://api.upbit.com/v1/ticker?markets=KRW-BTC,KRW-ETH"):
            p = self.payload()
            p["markets"]["KRW-BTC"]["source"]["url"] = url
            self.reject(p)
        p = self.payload()
        p["markets"]["KRW-BTC"].update(date="2026-10-12", price_type="daily_close", session="daily", as_of="2026-10-13T09:00:00+09:00")
        self.reject(p)

    def test_winter_us_date_and_legacy_floor_respect_eastern_offset(self):
        winter = datetime.fromisoformat("2026-12-15T09:10:00+09:00")
        p = self.payload()
        p.update(trade_date="2026-12-15", verified_at=winter.isoformat())
        for q in p["markets"].values():
            q.update(date="2026-12-14" if q["currency"] == "USD" else "2026-12-15",
                     as_of="2026-12-14T19:09:00-05:00" if q["currency"] == "USD" else "2026-12-15T09:09:00+09:00")
            if q["currency"] == "USD":
                q["session"] = "after"
        self.assertTrue(self.run_file(p, now=winter))
        self.assertEqual(manual.close_floor(datetime.fromisoformat("2026-12-14").date(), "NVDA").hour, 6)


if __name__ == "__main__":
    unittest.main()
