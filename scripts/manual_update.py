#!/usr/bin/env python3
"""수동 종가 입력 전용. 네트워크/API 호출 없음."""
import json, os, math
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
def read(path,default):
 try: return json.loads(path.read_text("utf-8"))
 except (OSError,ValueError): return default
def write(path,data):
 path.parent.mkdir(parents=True,exist_ok=True)
 path.write_text(json.dumps(data,ensure_ascii=False,indent=2)+"\n","utf-8")
def main():
 day=date.fromisoformat(os.environ["INPUT_TRADE_DATE"].strip())
 if not date(2026,1,1)<=day<=date(2026,12,31):
  raise ValueError("기준 날짜는 2026-01-01부터 2026-12-31까지 입력해주세요.")
 markets={}
 for key,(symbol,start) in SYMBOLS.items():
  raw=os.environ["INPUT_"+key].strip().replace(",","")
  value=float(raw)
  if not math.isfinite(value) or value<=0:
   raise ValueError(f"{symbol} 가격은 0보다 큰 숫자여야 합니다.")
  markets[symbol]={"price":value,"date":day.isoformat(),"source":"직접 입력 (기준일 확인 필요)","stale":False}
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
 prior=read(PRICE,{})
 now=datetime.now(timezone(timedelta(hours=9))).isoformat(timespec="seconds")
 result={"mode":"manual","updatedAt":now,"locked":False,"markets":markets,
   "errors":[],"notes":f"{day.isoformat()} 기준 사용자가 직접 입력한 가격입니다. 시세 API를 호출하지 않았습니다."}
 write(PRICE,result)
 hist=read(HISTORY,{"history":[]})
 recs=hist.get("history",[])
 if not isinstance(recs,list): recs=[]
 # 그 날짜 기존 기록만 대체. 다른 날짜 기록은 보존.
 recs=[r for r in recs if r.get("day")!=day.isoformat()]
 recs.append({"day":day.isoformat(),"updatedAt":now,"returns":returns,
              "ranks":ranks,"losers":losers,"final":False})
 recs.sort(key=lambda r:r.get("day",""))
 write(HISTORY,{"history":recs})
 print(f"[MANUAL] {day} 8종목 저장 / API 요청 0건 / 기록 {len(recs)}개")
 print("순위:",[(p,ranks[p]) for p,_,_ in rows])
if __name__=="__main__":main()
