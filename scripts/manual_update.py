#!/usr/bin/env python3
"""검증된 종가(v1) 및 실제 시세(v2) 수동 입력. 네트워크/API 호출 없음."""
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
USD_HOSTS={"finance.yahoo.com","nasdaq.com","www.nasdaq.com","stockanalysis.com","www.marketbeat.com"}
KR_HOSTS={"finance.naver.com","m.stock.naver.com","finance.daum.net","data.krx.co.kr","www.krx.co.kr","markets.hankyung.com","kind.krx.co.kr"}

def parse_instant(raw,label,precise=False):
 if not isinstance(raw,str) or precise and not re.match(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}",raw):
  raise ValueError(f"{label}: 시간대가 포함된 ISO 날짜·시각(초 포함)이 필요합니다.")
 value=datetime.fromisoformat(raw)
 if value.utcoffset() is None:
  raise ValueError(f"{label}: 시간대가 필요합니다.")
 return value.astimezone(KST)

def ny_offset(day):
 # US Eastern의 현행 DST 규칙. 가격일은 2026년으로 제한; 외부 시간대 패키지 불필요.
 march=date(day.year,3,8)
 start=march+timedelta(days=(6-march.weekday())%7)
 november=date(day.year,11,1)
 end=november+timedelta(days=(6-november.weekday())%7)
 return timezone(timedelta(hours=-4 if start<=day<end else -5))

def market_day(instant,symbol):
 if symbol in ("NVDA","TSLA","AMZN","GOOGL"):
  # 시세의 미국 현지 달력 날짜만 계산. 세션은 출처 표시를 입력하며 시각으로 추측하지 않는다.
  approximate=instant.astimezone(timezone(timedelta(hours=-5)))
  return instant.astimezone(ny_offset(approximate.date())).date()
 return instant.date()

def close_floor(day,symbol):
 # v1에는 실제 시각이 없다. 역행 검사에만 정규장 종료 경계를 사용하고 저장/표시하지 않는다.
 if symbol=="KRW-BTC":
  return datetime.combine(day+timedelta(days=1),time(9),KST)
 if symbol.endswith(".KS"):
  return datetime.combine(day,time(15,30),KST)
 return datetime.combine(day,time(16),ny_offset(day)).astimezone(KST)

def validate_metadata(quote,symbol,day,verified):
 kind,session=quote["price_type"],quote["session"]
 if symbol=="KRW-BTC":
  allowed={("spot","continuous"),("daily_close","daily")}
 else:
  sessions={"pre","regular","after"}|({"day"} if quote["currency"]=="USD" else set())
  allowed={("last_trade",s) for s in sessions}|{("previous_close","regular")}
 if not isinstance(kind,str) or not isinstance(session,str) or (kind,session) not in allowed:
  raise ValueError(f"{symbol}: 자산에 맞는 price_type·session 조합이 필요합니다.")
 instant=parse_instant(quote["as_of"],symbol+" as_of",precise=True)
 if instant>verified:
  raise ValueError(f"{symbol}: 실제 시세 시각은 확인 시각 이후일 수 없습니다.")
 if kind=="daily_close":
  if instant!=close_floor(day,symbol):
   raise ValueError("BTC 완료 일봉 as_of는 해당 일봉 다음날 09:00 KST 마감 시각이어야 합니다.")
 elif market_day(instant,symbol)!=day:
  raise ValueError(f"{symbol}: date는 실제 시세 시각의 시장 현지 날짜와 같아야 합니다.")
 delay=quote["delay"]
 exact_keys(delay,{"status","minutes"},symbol+" delay")
 status,minutes=delay["status"],delay["minutes"]
 valid=(status=="realtime" and type(minutes) is int and minutes==0 or
        status=="delayed" and type(minutes) is int and 0<minutes<=1440 or
        status=="unknown" and minutes is None)
 if not valid:
  raise ValueError(f"{symbol}: delay는 realtime/0, delayed/양수 분, unknown/null 중 하나여야 합니다.")
 return {"asOf":instant.isoformat(),"priceType":kind,"session":session,
         "delay":delay,"stale":status!="realtime"}

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
 version=payload["schema_version"]
 if type(version) is not int or version not in (1,2):
  raise ValueError("schema_version은 정수 1 또는 2이어야 합니다.")
 day=parse_day(payload["trade_date"],"한국시간 스냅샷 날짜")
 verified=parse_instant(payload["verified_at"],"verified_at")
 if verified.date()!=day or verified>now or now-verified>timedelta(hours=36):
  raise ValueError("스냅샷 날짜와 확인 시각이 일치해야 하며, 미래 또는 36시간이 지난 입력은 사용할 수 없습니다.")
 expected={symbol for symbol,_ in SYMBOLS.values()}
 exact_keys(payload["markets"],expected,"markets")
 markets={}
 for symbol,_ in SYMBOLS.values():
  quote=payload["markets"][symbol]
  keys={"price","date","currency","source"}
  if version==2:
   keys|={"as_of","price_type","session","delay"}
  exact_keys(quote,keys,symbol)
  value=quote["price"]
  if type(value) not in (int,float) or not math.isfinite(value) or value<=0:
   raise ValueError(f"{symbol}: price는 유한한 양수 JSON 숫자여야 합니다.")
  currency="USD" if symbol in ("NVDA","TSLA","AMZN","GOOGL") else "KRW"
  if quote["currency"]!=currency:
   raise ValueError(f"{symbol}: 통화는 {currency}이어야 합니다.")
  close_day=parse_day(quote["date"],symbol+" 가격 기준일")
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
  metadata=validate_metadata(quote,symbol,close_day,verified) if version==2 else {}
  is_close=version==1 or metadata["priceType"] in ("previous_close","daily_close")
  if is_close and ((symbol!="KRW-BTC" and close_day.weekday()>=5) or verified<closed_at):
   raise ValueError(f"{symbol}: 완료되지 않은 일봉 또는 주말 주식 종가는 입력할 수 없습니다.")
  if version==2 and symbol!="KRW-BTC" and metadata["priceType"]=="last_trade" and metadata["session"]!="day" and close_day.weekday()>=5:
   raise ValueError(f"{symbol}: 주말 주식 거래가격은 입력할 수 없습니다.")
  source=quote["source"]
  exact_keys(source,{"name","url"},symbol+" source")
  if not isinstance(source["name"],str) or not 1<=len(source["name"].strip())<=100:
   raise ValueError(f"{symbol}: 출처 이름이 필요합니다.")
  if not isinstance(source["url"],str) or not 1<=len(source["url"])<=2048:
   raise ValueError(f"{symbol}: 출처 URL이 필요합니다.")
  url=urlsplit(source["url"])
  if url.scheme!="https" or url.hostname not in hosts or url.username or url.password or url.port not in (None,443):
   raise ValueError(f"{symbol}: 허용된 공개 HTTPS 가격 출처를 사용하세요.")
  if symbol=="KRW-BTC":
   spot=version==2 and metadata["priceType"]=="spot"
   endpoint="/v1/ticker" if spot else "/v1/candles/days"
   query_key="markets" if spot else "market"
   if url.path!=endpoint or parse_qs(url.query,keep_blank_values=True).get(query_key)!=["KRW-BTC"]:
    raise ValueError("BTC 출처는 가격 유형에 맞는 업비트 KRW-BTC 현물/완료 일봉 URL이어야 합니다.")
  elif url.hostname=="kind.krx.co.kr":
   # KIND issuer IDs are five digits, not arbitrary six-digit substring matches.
   issuer={"034020.KS":"03402","267260.KS":"26726","011200.KS":"01120"}.get(symbol)
   query=parse_qs(url.query,keep_blank_values=True)
   if (url.path!="/common/stockprices.do" or url.fragment or
       query!={"isurCd":[issuer],"method":["searchStockPricesMain"]}):
    raise ValueError(f"{symbol}: KIND 종목·경로·조회 방식이 일치해야 합니다.")
  elif symbol.split(".")[0].lower() not in unquote(url.path+"?"+url.query).lower():
   raise ValueError(f"{symbol}: 출처 URL에 해당 종목 코드가 필요합니다.")
  markets[symbol]={"price":value,"date":close_day.isoformat(),"currency":currency,
                   "source":source["name"].strip(),"sourceUrl":source["url"],"stale":False,**metadata}
 blob_sha=hashlib.sha1(b"blob "+str(len(raw)).encode("ascii")+b"\0"+raw).hexdigest()
 audit={"path":INPUT_PATH,"sha":blob_sha,"verifiedAt":verified.isoformat()}
 if version==2:
  audit["schemaVersion"]=2
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
 if prior.get("mode")!="demo" and (audit or any(q.get("asOf") for q in old_markets.values() if isinstance(q,dict))):
  previous_verified=(prior.get("manualInput") or {}).get("verifiedAt") or prior.get("updatedAt")
  if previous_verified and parse_instant(previous_verified,"기존 verifiedAt").date()>day:
   raise ValueError("과거 스냅샷 날짜로 되돌리거나 과거 기록을 수정할 수 없습니다.")
  for symbol,quote in markets.items():
   old=old_markets.get(symbol) or {}
   if old.get("date") and parse_day(old["date"],"기존 "+symbol)>parse_day(quote["date"],symbol):
    raise ValueError(f"{symbol}: 기존 종가보다 오래된 입력으로 되돌릴 수 없습니다.")
   if old.get("date") and (old.get("asOf") or quote.get("asOf")):
    old_time=parse_instant(old["asOf"],"기존 "+symbol) if old.get("asOf") else close_floor(parse_day(old["date"],symbol),symbol)
    new_time=parse_instant(quote["asOf"],symbol) if quote.get("asOf") else close_floor(parse_day(quote["date"],symbol),symbol)
    if new_time<old_time:
     raise ValueError(f"{symbol}: 실제 시세 기준시각을 역행할 수 없습니다.")
    if old.get("asOf") and not quote.get("asOf") and old["date"]==quote["date"]:
     raise ValueError(f"{symbol}: 실제 시세 메타데이터를 종가 전용 입력으로 제거할 수 없습니다.")
 with_metadata=bool(audit and audit.get("schemaVersion")==2) or any(q.get("asOf") for q in old_markets.values() if isinstance(q,dict))
 same_fields=("price","date","currency","source","sourceUrl","asOf","priceType","session","delay") if with_metadata else ("price","date")
 if prior.get("mode")!="demo" and all(
  isinstance(old_markets.get(symbol),dict) and
  all(old_markets[symbol].get(field)==quote.get(field) for field in same_fields)
  for symbol,quote in markets.items()
 ):
  print("[MANUAL] 가격·기준 정보 변경 없음 / 저장·배포 생략")
  return False
 if check:
  print("[MANUAL] 가격·기준 정보 변경 있음 / 확인 전용: 파일 쓰기 없음")
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
   "errors":[],"notes":f"{day.isoformat()} 한국시간 스냅샷입니다. 가격 기준일은 markets.date, v2 실제 시세 시각은 markets.asOf, 확인 시각은 manualInput.verifiedAt, 저장 시각은 updatedAt입니다. 시세 API를 호출하지 않았습니다."}
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
 if audit and audit.get("schemaVersion")==2:
  recs[-1]["quotes"]={symbol:{key:quote[key] for key in ("price","date","currency","source","sourceUrl","asOf","priceType","session","delay","stale")} for symbol,quote in markets.items()}
 recs.sort(key=lambda r:r.get("day",""))
 write(PRICE,result)
 write(HISTORY,{**hist,"history":recs})
 print(f"[MANUAL] {day} 8종목 저장 / API 요청 0건 / 기록 {len(recs)}개")
 print("순위:",[(p,ranks[p]) for p,_,_ in rows])
 return True
if __name__=="__main__":
 parser=argparse.ArgumentParser(description=__doc__)
 parser.add_argument("--check",action="store_true",help="입력 검증과 변경 여부만 확인하고 데이터는 저장하지 않음")
 parser.add_argument("--input-file",type=Path,help="검증된 가격 JSON 파일 (v1 종가 / v2 실제 시세)")
 args=parser.parse_args()
 changed=main(check=args.check,input_file=args.input_file)
 if os.environ.get("GITHUB_OUTPUT"):
  with open(os.environ["GITHUB_OUTPUT"],"a",encoding="utf-8") as output:
   output.write(f"changed={str(changed).lower()}\n")
