#!/usr/bin/env python3
"""술값배틀 2026: 외부 종가 → data/prices.json 및 data/history.json

주식은 Yahoo Finance의 비공식 일봉 chart API, 비트코인은 Upbit 공식 일봉 API 사용.
시세 제공이 지연되거나 차단될 수 있으므로 해당 종목을 stale로 표시합니다.
추가 pip 패키지 없이 Python 3.11+ 표준 라이브러리로 실행합니다.
"""
from __future__ import annotations

import json
import os
import sys
import time
from datetime import date, datetime, time as clock, timedelta, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, quote
from urllib.request import Request, urlopen
from xml.etree import ElementTree
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
PRICE_FILE = ROOT / "data" / "prices.json"
HISTORY_FILE = ROOT / "data" / "history.json"
KST = ZoneInfo("Asia/Seoul")
ET = ZoneInfo("America/New_York")
FINAL_DAY = date(2026, 12, 31)
LOCK_TIME = datetime(2027, 1, 1, 9, 20, tzinfo=KST)

PEOPLE = [
    ("eunji", "NVDA", 184.86), ("dongmin", "NVDA", 184.86),
    ("seongsu", "TSLA", 445.0), ("ojing", "AMZN", 247.3),
    ("bitna", "GOOGL", 328.57), ("yumin", "KRW-BTC", 133_600_000),
    ("jeonguk", "034020.KS", 84_800), ("gwangil", "267260.KS", 849_000),
    ("geumseung", "011200.KS", 20_050),
]
SYMBOLS = list(dict.fromkeys(symbol for _, symbol, _ in PEOPLE))
USD_SYMBOLS = ["NVDA", "TSLA", "AMZN", "GOOGL"]
KR_SYMBOLS = ["034020.KS", "267260.KS", "011200.KS"]


def load_json(path: Path, default: dict) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return default


def save_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    # 파일을 항상 완성된 JSON 상태로 교체.
    temp = path.with_suffix(".json.tmp")
    temp.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temp.replace(path)


def get_json(url: str, attempts: int = 2) -> object:
    headers = {
        "User-Agent": "Mozilla/5.0 (compatible; SoolBattle2026/1.0; GitHubAction)",
        "Accept": "application/json",
        "Accept-Language": "en-US,en;q=0.8,ko;q=0.6",
    }
    error = None
    for attempt in range(attempts):
        try:
            with urlopen(Request(url, headers=headers), timeout=12) as response:
                return json.load(response)
        except (HTTPError, URLError, TimeoutError, ValueError, OSError) as exc:
            error = exc
            if attempt + 1 < attempts:
                time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(str(error))


def fetch_stock(symbol: str, now: datetime) -> dict:
    """시장에서 실제로 정규장 종료가 완료된 마지막 일봉만 선택."""
    korea = symbol in KR_SYMBOLS
    market_tz = KST if korea else ET
    close_gate = clock(15, 45) if korea else clock(16, 15)
    local_now = now.astimezone(market_tz)
    start = int(datetime(2026, 10, 1, tzinfo=timezone.utc).timestamp())
    # 2027년 이후에도 마지막 종가를 찾을 수 있도록 고정된 조회 기간 사용.
    end_limit = datetime(2027, 1, 5, tzinfo=timezone.utc)
    query_end = min(now.astimezone(timezone.utc) + timedelta(days=2), end_limit)
    end = int(query_end.timestamp())
    params = urlencode({"period1": start, "period2": end, "interval": "1d"})
    error = None
    for host in ("query1.finance.yahoo.com", "query2.finance.yahoo.com"):
        try:
            url = f"https://{host}/v8/finance/chart/{quote(symbol)}?{params}"
            doc = get_json(url)
            result = doc["chart"]["result"][0]
            times = result["timestamp"]
            closes = result["indicators"]["quote"][0]["close"]
            candidates = []
            for stamp, close in zip(times, closes):
                if close is None or float(close) <= 0:
                    continue
                day = datetime.fromtimestamp(stamp, timezone.utc).astimezone(market_tz).date()
                if day > FINAL_DAY:
                    continue
                if day > local_now.date():
                    continue
                if day == local_now.date() and local_now.time() < close_gate:
                    # 장중 진행 중인 일봉을 종가로 쓰지 않음.
                    continue
                candidates.append((day, float(close)))
            if not candidates:
                raise RuntimeError("마감 완료된 일봉 데이터가 없습니다")
            traded_day, price = max(candidates, key=lambda c: c[0])
            return {
                "price": round(price, 6),
                "date": traded_day.isoformat(),
                "source": f"Yahoo Finance ({host})",
                "stale": False,
            }
        except (KeyError, TypeError, ValueError, IndexError, RuntimeError) as exc:
            error = exc
    raise RuntimeError(f"{symbol}: Yahoo 일봉 조회 실패: {error}")



def fetch_korean_stock(symbol: str, now: datetime) -> dict:
    """네이버 국내주식 일봉을 우선 사용하고 Yahoo 종가와 거래일을 비교합니다."""
    local_now = now.astimezone(KST)
    sources = []
    errors = []
    try:
        url = "https://fchart.stock.naver.com/sise.nhn?" + urlencode({
            "symbol": symbol.split(".")[0], "timeframe": "day",
            "count": 35, "requestType": 0,
        })
        request = Request(url, headers={"User-Agent": "Mozilla/5.0", "Referer": "https://finance.naver.com/"})
        with urlopen(request, timeout=15) as response:
            root = ElementTree.fromstring(response.read(1000000))
        candles = []
        for item in root.iter("item"):
            parts = (item.get("data") or "").split("|")
            if len(parts) < 5:
                continue
            day = datetime.strptime(parts[0], "%Y%m%d").date()
            close = float(parts[4])
            if day > FINAL_DAY or day > local_now.date() or close <= 0:
                continue
            if day == local_now.date() and local_now.time() < clock(15, 45):
                continue
            candles.append((day, close))
        if not candles:
            raise ValueError("완료된 네이버 일봉 없음")
        day, price = max(candles)
        sources.append({"price": price, "date": day.isoformat(), "source": "네이버 금융 일봉", "stale": False})
    except Exception as exc:
        errors.append("Naver: " + str(exc))
        print(f"[NAVER ERROR] {symbol}: {type(exc).__name__}: {exc}", file=sys.stderr)
    try:
        sources.append(fetch_stock(symbol, now))
    except Exception as exc:
        errors.append("Yahoo: " + str(exc))
    if not sources:
        raise RuntimeError("; ".join(errors))
    selected = dict(max(sources, key=lambda x: (x["date"], x["source"] == "네이버 금융 일봉")))
    if len(sources) == 2 and sources[0]["date"] == sources[1]["date"]:
        if abs(sources[0]["price"] - sources[1]["price"]) > 0.5:
            selected = dict(sources[0])
            selected["stale"] = True
            selected["warning"] = "동일 거래일 소스별 종가 불일치 — 직접 확인 필요"

    # 휴장일 계산기는 없으므로, 예상 영업일보다 오래되면 경고(공휴일에는 경고 가능).
    expected = min(local_now.date(), date(2026, 12, 30))
    if expected == local_now.date() and local_now.time() < clock(15, 45):
        expected -= timedelta(days=1)
    while expected.weekday() >= 5 or expected == date(2026, 12, 31):
        expected -= timedelta(days=1)
    if date.fromisoformat(selected["date"]) < expected:
        selected["stale"] = True
        selected["warning"] = f"종가 날짜 {selected['date']}, 예상 최신 거래일 {expected} — 확인 필요"
    if errors:
        selected["source"] += " (일부 제공처 조회 실패)"
    return selected


def fetch_bitcoin(now: datetime) -> dict:
    """업비트 KRW-BTC 일봉. 한국시간 09:00가 다음 일봉 시작/전일 일봉 확정 시각."""
    params = {"market": "KRW-BTC", "count": 7}
    if now.astimezone(KST).date() >= date(2027, 1, 2):
        # 연말 이후에도 12/31 일봉에 직접 접근.
        params["to"] = "2027-01-02T09:00:00+09:00"
    url = "https://api.upbit.com/v1/candles/days?" + urlencode(params)
    candles = get_json(url)
    if not isinstance(candles, list):
        raise RuntimeError("Upbit 비정상 응답")
    candidates = []
    for candle in candles:
        candle_day = date.fromisoformat(candle["candle_date_time_kst"][:10])
        end = datetime.combine(candle_day + timedelta(days=1), clock(9), tzinfo=KST)
        if candle_day > FINAL_DAY or now < end:
            continue  # 아직 완성되지 않은 오늘 일봉은 제외
        price = float(candle["trade_price"])
        if price > 0:
            candidates.append((candle_day, price))
    if not candidates:
        raise RuntimeError("완성된 BTC/KRW 일봉이 없습니다")
    traded_day, price = max(candidates, key=lambda c: c[0])
    return {
        "price": price,
        "date": traded_day.isoformat(),
        "source": "Upbit KRW-BTC 공식 일봉",
        "stale": False,
    }


def make_ranking(markets: dict) -> tuple[dict, dict, list]:
    rows = []
    for index, (person_id, symbol, start) in enumerate(PEOPLE):
        info = markets.get(symbol) or {}
        price = info.get("price")
        if not isinstance(price, (float, int)) or price <= 0:
            continue
        roi = (price / start - 1) * 100
        rows.append((person_id, roi, index))
    rows.sort(key=lambda r: (-r[1], r[2]))
    returns = {p: round(roi, 6) for p, roi, _ in rows}
    ranks = {p: i + 1 for i, (p, _, _) in enumerate(rows)}
    losers = [p for p, _, _ in rows[-3:]] if len(rows) == len(PEOPLE) else []
    return returns, ranks, losers


def update(now: datetime | None = None) -> dict:
    if now is None:
        now = datetime.now(KST)
    else:
        now = now.astimezone(KST)
    previous = load_json(PRICE_FILE, {"mode": "demo", "markets": {}, "locked": False})
    if previous.get("locked") is True:
        print("최종 결과가 잠겨 있어 데이터 갱신을 생략합니다.")
        return previous

    # 데모 가격은 절대 실데이터의 실패 대체값으로 사용할 수 없음.
    previous_real = previous.get("markets", {}) if previous.get("mode") in ("live", "partial", "unavailable") else {}
    markets = {}
    errors = []
    new_success = set()

    for symbol in SYMBOLS:
        try:
            quote_data = (fetch_bitcoin(now) if symbol == "KRW-BTC" else
                          fetch_korean_stock(symbol, now) if symbol in KR_SYMBOLS else fetch_stock(symbol, now))
            markets[symbol] = quote_data
            if not quote_data.get("stale"):
                new_success.add(symbol)
            else:
                errors.append(f"{symbol}: {quote_data.get('warning', '종가 검증 필요')}")
            print(f"[OK] {symbol:11s} {quote_data['date']} {quote_data['price']:,.2f}")
        except Exception as exc:
            prev = previous_real.get(symbol, {})
            if isinstance(prev.get("price"), (int, float)) and prev["price"] > 0:
                markets[symbol] = {**prev, "stale": True}
            else:
                markets[symbol] = {"price": None, "date": None, "source": "조회 실패", "stale": True}
            errors.append(f"{symbol}: {exc}")
            print(f"[WARN] {symbol} => {exc}", file=sys.stderr)
        time.sleep(.16)

    if len(new_success) == len(SYMBOLS):
        mode = "live"
    elif new_success:
        mode = "partial"
    else:
        mode = "unavailable"
    locked = (
        mode == "live"
        and now >= LOCK_TIME
        and all(date.fromisoformat(markets[s]["date"]) <= FINAL_DAY for s in SYMBOLS)
        and markets["KRW-BTC"]["date"] == "2026-12-31"
        and all(markets[s]["date"] == "2026-12-30" and not markets[s].get("stale") for s in KR_SYMBOLS)
        and all(markets[s]["date"] == "2026-12-31" and not markets[s].get("stale") for s in USD_SYMBOLS)
    )
    result = {
        "mode": mode, "updatedAt": now.isoformat(timespec="seconds"),
        "locked": bool(locked), "markets": markets, "errors": errors,
        "notes": "주식은 각 거래소의 최근 완료된 일봉, BTC는 업비트 최근 완료된 원화 일봉입니다.",
    }
    save_json(PRICE_FILE, result)

    # 데이터 변동 이력: 데모 이력은 최초 실데이터 성공 시 제거.
    previous_history = load_json(HISTORY_FILE, {"history": []})
    if previous.get("mode") == "demo":
        records = []
    else:
        records = previous_history.get("history", [])
        if not isinstance(records, list):
            records = []
    if mode == "live":
        returns, ranks, losers = make_ranking(markets)
        if len(returns) == len(PEOPLE):
            today = now.date().isoformat()
            record = {
                "day": today, "updatedAt": result["updatedAt"], "returns": returns,
                "ranks": ranks, "losers": losers, "final": bool(locked),
            }
            records = [r for r in records if r.get("day") != today]
            records.append(record)
            records.sort(key=lambda r: r.get("day", ""))
            records = records[-180:]
    save_json(HISTORY_FILE, {"history": records})

    print(f"작업 완료: mode={mode}, 새로 수집한 종목={len(new_success)}/{len(SYMBOLS)}, locked={locked}")
    if errors:
        print("※ 갱신 오류 있음: 데이터와 함께 stale 플래그 저장. GitHub Actions 로그 확인.", file=sys.stderr)
    return result


if __name__ == "__main__":
    # 실제 실행에서는 시스템 현재 시각(KST)을 사용.
    update()
