#!/usr/bin/env python3
"""수동 종가 입력 전용. 네트워크/API 호출 없음."""
import argparse, hashlib, json, os, math, re
from datetime import date, datetime, time, timezone, timedelta
from pathlib import Path
from urllib.parse import parse_qs, urlsplit, unquote

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
INPUT_PATH="inputs/closing-prices.json"
USD_HOSTS={"finance.yahoo.com","nasdaq.com","www.nasdaq.com","stockanalysis.com"}
KR_HOSTS={"finance.naver.com","m.stock.naver.com","finance.daum.net","data.krx.co.kr","www.krx.co.kr"}

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
   raise ValueError(f"JSON 키 중복: {key}")
  result[key]=value
 return result

def exact_keys(value,keys,label):
 if not isinstance(value,dict) or set(value)!=set(keys):
  raise ValueError(f"{label}: 필요한 키는 {', '.join(sorted(keys))}입니다.")

def load_input(path,now):
 raw=path.read_bytes()
 if len(raw)>65536:
  raise ValueError("입력 JSON은 64 KiB 이하여야 합니다.")
 payload=json.loads(raw.decode("utf-8"),object_pairs_hook=unique_keys)
 exact_keys(payload,{"schema_version","trade_date","verified_at","markets"},"입력 파일")
 if type(payload["schema_version"]) is not int or payload["schema_version"]!=1:
  raise ValueError("schema_version은 정수 1이어야 합니다.")
 day=parse_day(payload["trade_date"],"한국시간 스냅샷 날짜")
 if not isinstance(payload["verified_at"],str):
  raise ValueError("verified_at에는 시간대가 포함된 ISO 날짜·시각을 입력하세요.")
 verified=datetime.fromisoformat(payload["verified_at"])
 if verified.utcoffset() is None:
  raise ValueError("verified_at에는 시간대가 필요합니다.")
 verified=verified.astimezone(KST)
 if verified.date()!=day or verified>now or now-verified>timedelta(hours=36):
  raise ValueError("스냅샷 날짜와 확인 시각이 일치해야 하며, 미래 또는 36시간이 지난 입력은 사용할 수 없습니다.")
 expected={symbol for symbol,_ in SYMBOLS.values()}
 exact_keys(payload["markets"],expected,"markets")
 markets={}
 for symbol,_ in SYMBOLS.values():
  quote=payload["markets"][symbol]
  exact_keys(quote,{"price","date","currency","source"},symbol)
  value=quote["price"]
  if type(value) not in (int,float) or not math.isfinite(value) or value<=0:
   raise ValueError(f"{symbol}: price는 유한한 양수 JSON 숫자여야 합니다.")
  currency="USD" if symbol in ("NVDA","TSLA","AMZN","GOOGL") else "KRW"
  if quote["currency"]!=currency:
   raise ValueError(f"{symbol}: 통화는 {currency}이어야 합니다.")
  close_day=parse_day(quote["date"],symbol+" 종가 기준일")
  if close_day>day:
   raise ValueError(f"{symbol}: 종가 기준일이 스냅샷 날짜보다 늦습니다.")
  if symbol=="KRW-BTC":
   closed_at=datetime.combine(close_day+timedelta(days=1),time(9),KST)
   hosts={"api.upbit.com"}
  elif currency=="USD":
   # EST 기준 보수적 확정 시각. 한국시간 17:30 실행에서는 DST에도 지장이 없다.
   closed_at=datetime.combine(close_day+timedelta(days=1),time(6,15),KST)
   hosts=USD_HOSTS
  else:
   closed_at=datetime.combine(close_day,time(15,45),KST)
   hosts=KR_HOSTS
  if (symbol!="KRW-BTC" and close_day.weekday()>=5) or verified<closed_at:
   raise ValueError(f"{symbol}: 완료되지 않은 일봉 또는 주말 주식 종가는 입력할 수 없습니다.")
  source=quote["source"]
  exact_keys(source,{"name","url"},symbol+" source")
  if not isinstance(source["name"],str) or not 1<=len(source["name"].strip())<=100:
   raise ValueError(f"{symbol}: 출처 이름이 필요합니다.")
  if not isinstance(source["url"],str) or not 1<=len(source["url"])<=2048:
   raise ValueError(f"{symbol}: 출처 URL이 필요합니다.")
  url=urlsplit(source["url"])
  if url.scheme!="https" or url.hostname not in hosts or url.username or url.password or url.port not in (None,443):
   raise ValueError(f"{symbol}: 허용된 공개 HTTPS 종가 출처를 사용하세요.")
  if symbol=="KRW-BTC":
   if url.path!="/v1/candles/days" or parse_qs(url.query).get("market")!=["KRW-BTC"]:
    raise ValueError("BTC 출처는 market=KRW-BTC인 업비트 공식 일봉 URL이어야 합니다.")
  elif symbol.split(".")[0].lower() not in unquote(url.path+"?"+url.query).lower():
   raise ValueError(f"{symbol}: 출처 URL에 해당 종목 코드가 필요합니다.")
  markets[symbol]={"price":value,"date":close_day.isoformat(),"currency":currency,
                   "source":source["name"].strip(),"sourceUrl":source["url"],"stale":False}
 blob_sha=hashlib.sha1(b"blob "+str(len(raw)).encode("ascii")+b"\0"+raw).hexdigest()
 audit={"path":INPUT_PATH,"sha":blob_sha,"verifiedAt":verified.isoformat(timespec="seconds")}
 if os.environ.get("INPUT_COMMIT"):
  if not re.fullmatch(r"[0-9a-f]{40}",os.environ["INPUT_COMMIT"]):
   raise ValueError("INPUT_COMMIT은 40자리 Git 커밋 SHA이어야 합니다.")
  audit["commit"]=os.environ["INPUT_COMMIT"]
 return day,markets,audit

def main(now=None,check=False,input_file=None):
 now=(now or datetime.now(KST)).astimezone(KST)
 audit=None
 if input_file is not None:
  day,markets,audit=load_input(Path(input_file),now)
 else:
  day,markets=load_environment(now)
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
 if audit and prior.get("mode")!="demo":
  for symbol,quote in markets.items():
   old=old_markets.get(symbol) or {}
   if old.get("date") and parse_day(old["date"],"기존 "+symbol)>parse_day(quote["date"],symbol):
    raise ValueError(f"{symbol}: 기존 종가보다 오래된 입력으로 되돌릴 수 없습니다.")
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
 return save_snapshot(day,markets,hist,now,audit)

def load_environment(now):
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
 return day,markets

def save_snapshot(day,markets,hist,now,audit):
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
 if audit:
  result["manualInput"]=audit
 recs=hist["history"]
 # 그 날짜 기존 기록만 대체. 다른 날짜 기록은 보존.
 recs=[r for r in recs if r.get("day")!=day.isoformat()]
 recs.append({"day":day.isoformat(),"updatedAt":updated_at,
              "priceDates":{symbol:quote["date"] for symbol,quote in markets.items()},"returns":returns,
              "ranks":ranks,"losers":losers,"final":False})
 if audit:
  recs[-1]["manualInput"]=audit
 recs.sort(key=lambda r:r.get("day",""))
 write(PRICE,result)
 write(HISTORY,{**hist,"history":recs})
 print(f"[MANUAL] {day} 8종목 저장 / API 요청 0건 / 기록 {len(recs)}개")
 print("순위:",[(p,ranks[p]) for p,_,_ in rows])
 return True
if __name__=="__main__":
 parser=argparse.ArgumentParser(description=__doc__)
 parser.add_argument("--check",action="store_true",help="입력 검증과 변경 여부만 확인하고 데이터는 저장하지 않음")
 parser.add_argument("--input-file",type=Path,help="검증된 종가 JSON 파일")
 args=parser.parse_args()
 changed=main(check=args.check,input_file=args.input_file)
 if os.environ.get("GITHUB_OUTPUT"):
  with open(os.environ["GITHUB_OUTPUT"],"a",encoding="utf-8") as output:
   output.write(f"changed={str(changed).lower()}\n")
