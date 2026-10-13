#!/usr/bin/env python3
"""수동 종가 입력 전용. 네트워크/API 호출 없음."""
import argparse, json, os, math
from datetime import date, datetime, timezone, timedelta
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
PRICE=ROOT/"data"/"prices.json"
HISTORY=ROOT/"data"/"history.json"
SYMBOLS={
 "NVDA":("NVDA",184.86),
 "TSLA":("TSLA",445),
 "AMZN":("AMZN",247.3),
 "GOOGL":("GOOGL",328.57),
 "KRW_BTC":("KRW-BTC",133600000),
 "KR_034020":("034020.KS",84800),
 "KR_267260":("267260.KS",849000),
 "KR_011200":("011200.KS",20050),
}
PEOPLE=[
 ("eunji","NVDA",184.86),("dongmin","NVDA",184.86),
 ("seongsu","TSLA",445),("ojing","AMZN",247.3),
 ("bitna","GOOGL",328.57),("yumin","KRW-BTC",133600000),
 ("jeonguk","034020.KS",84800),("gwangil","267260.KS",849000),
 ("geumseung","011200.KS",20050),
]
KST=timezone(timedelta(hours=9))

def read(path,default):
 try: return json.loads(path.read_text("utf-8"))
 except FileNotFoundError: return default
def write(path,data):
 path.parent.mkdir(parents=True,exist_ok=True)
 temp=path.with_suffix(".json.tmp")
 temp.write_text(json.dumps(data,ensure_ascii=False,indent=2)+"\n","utf-8")
 temp.replace(path)

def parse_day(raw,label):
 if not isinstance(raw,str):
  raise ValueError(f"{label}: YYYY-MM-DD 문자열이 필요합니다.")
 raw=raw.strip()
 day=date.fromisoformat(raw)
 if day.isoformat()!=raw:
  raise ValueError(f"{label}: YYYY-MM-DD 형식이 필요합니다.")
 if not date(2026,1,1)<=day<=date(2026,12,31):
  raise ValueError(f"{label}: 2026-01-01부터 2026-12-31까지 입력해주세요.")
 return day

def unique_keys(pairs):
 result={}
 for key,value in pairs:
  if key in result:
   raise ValueError(f"종가 기준일 키 중복: {key}")
  result[key]=value
 return result

def main(now=None,check=False):
 now=(now or datetime.now(KST)).astimezone(KST)
 day=parse_day(os.environ["INPUT_TRADE_DATE"],"한국시간 스냅샷 날짜")
 if day>now.date():
  raise ValueError("스냅샷 날짜는 미래일 수 없습니다.")
 price_dates=json.loads(os.environ["INPUT_PRICE_DATES"],object_pairs_hook=unique_keys)
 expected={symbol for symbol,_ in SYMBOLS.values()}
 if not isinstance(price_dates,dict) or set(price_dates)!=expected:
  raise ValueError("price_dates에 8종목의 정확한 시세 코드와 종가 기준일을 모두 입력해주세요.")
 markets={}
 for key,(symbol,start) in SYMBOLS.items():
  close_day=parse_day(price_dates[symbol],symbol+" 종가 기준일")
  if close_day>day:
   raise ValueError(f"{symbol}: 종가 기준일은 스냅샷 날짜보다 늦을 수 없습니다.")
  raw=os.environ["INPUT_"+key].strip().replace(",","")
  value=float(raw)
  if not math.isfinite(value) or value<=0:
   raise ValueError(f"{symbol} 가격은 0보다 큰 숫자여야 합니다.")
  markets[symbol]={"price":value,"date":close_day.isoformat(),"source":"직접 입력 (웹 검색으로 종가·기준일 확인)","stale":False}
 # 모든 입력과 기존 파일을 검증한 다음에만 기록한다. 공통 날짜로 보완하지 않는다.
 prior=read(PRICE,{})
 hist=read(HISTORY,{"history":[]})
 if not isinstance(prior,dict) or not isinstance(prior.get("markets",{}),dict):
  raise ValueError("기존 prices.json 형식 오류: 원본을 보존합니다.")
 if not isinstance(hist,dict) or not isinstance(hist.get("history"),list) or not all(isinstance(r,dict) for r in hist["history"]):
  raise ValueError("기존 history.json 형식 오류: 원본을 보존합니다.")
 if prior.get("locked") is True:
  raise ValueError("최종 결과가 잠겨 있어 수동 입력으로 변경할 수 없습니다.")
 old_markets=prior.get("markets",{})
 if prior.get("mode")!="demo" and all(
  isinstance(old_markets.get(symbol),dict) and
  old_markets[symbol].get("price")==quote["price"] and
  old_markets[symbol].get("date")==quote["date"]
  for symbol,quote in markets.items()
 ):
  print("[MANUAL] 가격·종가 기준일 변경 없음 / 저장·배포 생략")
  return False
 if check:
  print("[MANUAL] 가격·종가 기준일 변경 있음 / 확인 전용: 파일 쓰기 없음")
  return True
 rows=[]
 for index,(person,symbol,start) in enumerate(PEOPLE):
  roi=(markets[symbol]["price"]/start-1)*100
  rows.append((person,roi,index))
 rows.sort(key=lambda r:(-round(r[1],10),r[2]))
 # 공동 순위는 동일 수익률이면 동일 등수, 다음 순위는 사람 수만큼 건너뜀.
 ranks={}
 for i,(person,roi,_) in enumerate(rows):
  rank=next((ranks[p] for p,old,_ in rows[:i] if abs(roi-old)<1e-8),i+1)
  ranks[person]=rank
 returns={p:round(roi,6) for p,roi,_ in rows}
 losers=[p for p,_,_ in rows[-3:]]
 updated_at=now.isoformat(timespec="seconds")
 result={"mode":"manual","updatedAt":updated_at,"locked":False,"markets":markets,
   "errors":[],"notes":f"{day.isoformat()} 한국시간 스냅샷입니다. 종목별 종가 기준일은 markets.date, 데이터 갱신 시각은 updatedAt입니다. 시세 API를 호출하지 않았습니다."}
 recs=hist["history"]
 # 그 날짜 기존 기록만 대체. 다른 날짜 기록은 보존.
 recs=[r for r in recs if r.get("day")!=day.isoformat()]
 recs.append({"day":day.isoformat(),"updatedAt":updated_at,
              "priceDates":{symbol:quote["date"] for symbol,quote in markets.items()},"returns":returns,
              "ranks":ranks,"losers":losers,"final":False})
 recs.sort(key=lambda r:r.get("day",""))
 write(PRICE,result)
 write(HISTORY,{**hist,"history":recs})
 print(f"[MANUAL] {day} 8종목 저장 / API 요청 0건 / 기록 {len(recs)}개")
 print("순위:",[(p,ranks[p]) for p,_,_ in rows])
 return True
if __name__=="__main__":
 parser=argparse.ArgumentParser(description=__doc__)
 parser.add_argument("--check",action="store_true",help="입력 검증과 변경 여부만 확인하고 데이터는 저장하지 않음")
 changed=main(check=parser.parse_args().check)
 if os.environ.get("GITHUB_OUTPUT"):
  with open(os.environ["GITHUB_OUTPUT"],"a",encoding="utf-8") as output:
   output.write(f"changed={str(changed).lower()}\n")
