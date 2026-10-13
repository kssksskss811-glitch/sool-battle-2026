#!/usr/bin/env python3
"""2026-01-01부터 과거 확정 일봉으로 실제 날짜별 순위 이력 복원.

각 날짜의 한국시간 오후 17:30 기준:
  미국: 직전 미국 거래일까지 완료한 일봉 (보통 전날)
  한국: 당일 15:30 장 종료 일봉 (휴장일은 직전 거래일)
  BTC: 당일 09:00 이전에 완료된 업비트 일봉 (전날 캔들)
각 종목은 과거 일봉 자료를 바탕으로 계산하며, 누락 시 임의 보간하지 않습니다.
조회에 실패한 경우 history.json을 덮어쓰지 않고 다음 실행에서 재시도합니다.
"""
from __future__ import annotations

import sys
import time
from bisect import bisect_right
from datetime import date, datetime, time as clock, timedelta, timezone
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen
from xml.etree import ElementTree

from update_prices import (
    ROOT, HISTORY_FILE, KST, ET, PEOPLE, USD_SYMBOLS, KR_SYMBOLS,
    load_json, save_json, get_json,
)

FIRST = date(2026, 1, 1)
FIRST_FETCH = date(2025, 12, 16)
LAST_DAY = date(2026, 12, 31)
TAG = "backfill-2026-v1"

def yahoo_series(symbol: str, now: datetime) -> dict:
    start = int(datetime.combine(FIRST_FETCH, clock(), timezone.utc).timestamp())
    end = int((now.astimezone(timezone.utc) + timedelta(days=1)).timestamp())
    params = urlencode({"period1": start, "period2": end, "interval": "1d"})
    err = None
    for host in ("query1.finance.yahoo.com", "query2.finance.yahoo.com"):
        try:
            doc = get_json(f"https://{host}/v8/finance/chart/{quote(symbol)}?{params}")
            result = doc["chart"]["result"][0]
            stamps = result["timestamp"]
            closes = result["indicators"]["quote"][0]["close"]
            local_tz = KST if symbol in KR_SYMBOLS else ET
            series = {}
            for stamp, price in zip(stamps, closes):
                if price is None or float(price) <= 0:
                    continue
                trading_day = datetime.fromtimestamp(stamp, timezone.utc).astimezone(local_tz).date()
                if trading_day > now.astimezone(local_tz).date():
                    continue
                if trading_day == now.astimezone(local_tz).date():
                    # 오늘 일봉은 장이 닫힌 뒤에만 인정합니다.
                    threshold = clock(15, 45) if symbol in KR_SYMBOLS else clock(16, 15)
                    if now.astimezone(local_tz).time() < threshold:
                        continue
                series[trading_day] = round(float(price), 6)
            if len(series) < 5:
                raise ValueError("사용 가능한 일봉이 5개 미만")
            return series
        except (KeyError, TypeError, ValueError, IndexError, RuntimeError) as exc:
            err = exc
    raise RuntimeError(f"{symbol}: Yahoo 기간조회 실패: {err}")

def naver_series(symbol: str, now: datetime) -> dict:
    url = "https://fchart.stock.naver.com/sise.nhn?" + urlencode({
        "symbol":symbol.split(".")[0],"timeframe":"day","count":390,"requestType":0,
    })
    req = Request(url,headers={"User-Agent":"Mozilla/5.0","Referer":"https://finance.naver.com/"})
    with urlopen(req,timeout=20) as response:
        raw = response.read(5_000_000)
    try:
        xml = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        xml = raw.decode("cp949")
    xml = xml.lstrip()
    if xml.startswith("<?xml"):
        xml = xml.split("?>",1)[1]
    root = ElementTree.fromstring(xml)
    items = {}
    local_now = now.astimezone(KST)
    for item in root.iter("item"):
        parts=(item.get("data") or "").split("|")
        if len(parts)<5: continue
        d = datetime.strptime(parts[0],"%Y%m%d").date()
        p = float(parts[4])
        if p<=0 or d>LAST_DAY or d>local_now.date(): continue
        if d==local_now.date() and local_now.time()<clock(15,45): continue
        items[d]=p
    if len(items)<5: raise RuntimeError(f"{symbol}: 네이버 기간조회 데이터 부족 ({len(items)}개)")
    return items

def kr_history(symbol: str, now: datetime) -> dict:
    failures = []
    sources = []
    for name, method in (("Naver",naver_series),("Yahoo",yahoo_series)):
        try:
            rows = method(symbol,now)
            sources.append((name,rows))
            print(f"[HISTORY SOURCE] {symbol} {name}: {len(rows)}개, "
                  f"{min(rows)} ~ {max(rows)}",flush=True)
        except Exception as exc:
            failures.append(f"{name}: {exc}")
            print(f"[HISTORY WARN] {symbol} {name}: {exc}",file=sys.stderr,flush=True)
    if not sources:
        raise RuntimeError(f"{symbol}: 모든 과거 시세 조회 실패; {'; '.join(failures)}")
    # 역사 데이터는 가능한 오래되고 최신까지 담긴 네이버를 우선 사용.
    # Yahoo는 네이버에서 누락된 날짜만 보완하되, 같은 날 서로 다른 가격은 혼합하지 않습니다.
    primary = next((v for n,v in sources if n=="Naver"),None)
    if primary is not None:
        merged = dict(next((v for n,v in sources if n=="Yahoo"),{}))
        merged.update(primary)
        return merged
    return sources[0][1]

def upbit_history(now: datetime) -> dict:
    kst_now = now.astimezone(KST)
    latest_completed = kst_now.date() - timedelta(days=1 if kst_now.time()>=clock(9) else 2)
    next_start = datetime.combine(latest_completed+timedelta(days=1),clock(9),tzinfo=KST)
    collected={}
    for page in range(5):
        params=urlencode({
            "market":"KRW-BTC","count":200,"to":next_start.isoformat(timespec="seconds"),
        })
        rows=get_json("https://api.upbit.com/v1/candles/days?"+params)
        if not isinstance(rows,list) or not rows:
            raise RuntimeError("업비트 과거 일봉 응답 비정상/빈 결과")
        oldest=None
        for row in rows:
            d=date.fromisoformat(row["candle_date_time_kst"][:10])
            p=float(row["trade_price"])
            if p>0 and d<=latest_completed:
                collected[d]=p
            if oldest is None or d<oldest: oldest=d
        print(f"[HISTORY SOURCE] KRW-BTC page={page+1}, rows={len(rows)}, oldest={oldest}",flush=True)
        if oldest is None:
            raise RuntimeError("업비트 일봉 날짜 해석 불가")
        if oldest<=date(2025,12,31):
            break
        # Upbit to는 exclusive; 가장 오래된 캔들 개시(09:00 KST)로 다음 페이지 요청.
        next_start=datetime.combine(oldest,clock(9),tzinfo=KST)
        time.sleep(.15)
    if min(collected)>date(2025,12,31):
        raise RuntimeError("업비트 과거 데이터가 2025-12-31까지 도달하지 못함")
    return collected

def require_coverage(symbol: str, rows: dict, today:date) -> None:
    # 1/1 휴장일에 적용할 직전 영업일 종가가 있어야 합니다.
    required_last_2025 = date(2025,12,30) if symbol in KR_SYMBOLS else date(2025,12,31)
    if min(rows)>required_last_2025:
        raise RuntimeError(f"{symbol} 전년도 마지막 확정 종가 없음: 최소 {min(rows)}")
    if max(rows)<max(FIRST,today-timedelta(days=8)):
        raise RuntimeError(f"{symbol} 최신 일봉 지연: 마지막 {max(rows)}")

def get_quote(series:dict, cutoff:date) -> float | None:
    days=sorted(series)
    index=bisect_right(days,cutoff)-1
    return float(series[days[index]]) if index>=0 else None

def get_day_record(day:date, all_series:dict) -> dict | None:
    daily={}
    for symbol,series in all_series.items():
        # KST 오후 17:30 시점 기준 미국은 전날까지, 한국은 오늘까지, BTC는 어제까지.
        cutoff=day if symbol in KR_SYMBOLS else day-timedelta(days=1)
        close=get_quote(series,cutoff)
        if close is None:
            return None
        daily[symbol]=close
    rows=[]
    for idx,(person,symbol,base) in enumerate(PEOPLE):
        pct=(daily[symbol]/base-1)*100
        rows.append((person,pct,idx))
    rows.sort(key=lambda item:(-item[1],item[2]))
    returns={person:round(value,6) for person,value,_ in rows}
    ranks={}
    for idx,(person,value,_) in enumerate(rows):
        ranks[person]=next(i+1 for i,(_,a,_) in enumerate(rows) if abs(a-value)<1e-9)
    return {
        "day":day.isoformat(),
        "updatedAt":f"{day.isoformat()}T17:30:00+09:00",
        "returns":returns,
        "ranks":ranks,
        "losers":[person for person,_,_ in rows[-3:]],
        "final":False,
        "source":TAG,
    }

def backfill_if_missing(now:datetime|None=None) -> bool:
    now=now or datetime.now(KST)
    local=now.astimezone(KST)
    doc=load_json(HISTORY_FILE,{"history":[]})
    existing=doc.get("history",[])
    if not isinstance(existing,list):existing=[]
    # 복원 성공 이후에는 네트워크 호출 없이 일반 일일 갱신 이력만 누적합니다.
    if any(row.get("day")=="2026-01-01" and row.get("source")==TAG for row in existing):
        print("[HISTORY] 2026-01-01 복원 이력이 이미 있어 재조회 생략",flush=True)
        return False
    end=min(LAST_DAY,local.date()-timedelta(days=1))
    if end<FIRST:
        return False
    all_series={}
    for symbol in USD_SYMBOLS:
        data=yahoo_series(symbol,now)
        require_coverage(symbol,data,end)
        all_series[symbol]=data
        print(f"[HISTORY SOURCE] {symbol} Yahoo: {len(data)}개, {min(data)}~{max(data)}",flush=True)
    for symbol in KR_SYMBOLS:
        data=kr_history(symbol,now)
        require_coverage(symbol,data,end)
        all_series[symbol]=data
    btc=upbit_history(now)
    require_coverage("KRW-BTC",btc,end)
    all_series["KRW-BTC"]=btc

    rebuilt=[]
    d=FIRST
    while d<=end:
        record=get_day_record(d,all_series)
        if record is None: raise RuntimeError(f"{d}: 종목별 과거 일봉이 불충분함")
        rebuilt.append(record)
        d+=timedelta(days=1)
    # 과거의 demo/불완전 이력 제거. 오늘 실시간 자동 기록은 유지.
    future=[r for r in existing if r.get("day","")>end.isoformat() and not r.get("demo")]
    merged={r["day"]:r for r in rebuilt+future if r.get("day")}
    values=[merged[d] for d in sorted(merged)]
    save_json(HISTORY_FILE,{"history":values})
    print(f"[HISTORY OK] 2026-01-01 ~ {end} 복원 {len(rebuilt)}일, 누적 {len(values)}일",flush=True)
    return True

if __name__=="__main__":
    backfill_if_missing()
