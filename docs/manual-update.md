# 검증된 가격 입력 파일로 갱신 (종가 v1 / 시세 v2)

운영 입력 파일은 `inputs/closing-prices.json` 하나입니다. `main`에서 이 파일이
바뀌는 push가 `manual.yml`의 가격 입력 경로를 실행합니다. `index.html` 또는
`assets/**` 변경은 같은 워크플로의 UI 전용 배포 경로를 실행하며 입력 파일 검증과
가격 저장을 건너뜁니다. 기존 데이터·확인 시각·과거 기록을 바꾸지 않고 최신 main을
배포합니다. 문서 push와 결과 데이터 커밋은 실행을 유발하지 않습니다.
`update.yml`은 계속 Disabled로 유지합니다.
실제 운영 입력과 과거 데이터는 이 코드 변경에서 수정하지 않습니다. 테스트의 가격은
임시 복사본에서만 사용하는 합성값입니다. 매일 **09:10 KST** 확인은 운영 계획이며,
예약 변경은 별도 작업입니다. UI의 계획 표시는 예약 변경 완료를 뜻하지 않습니다.

## 공통 스키마 및 기존 종가 v1

최상위 키는 아래 4개만 허용합니다.

| 키 | 값 |
|---|---|
| `schema_version` | JSON 정수 `1`(기존 종가) 또는 `2`(실제 시세 메타데이터 포함) |
| `trade_date` | 한국시간 스냅샷 날짜, `YYYY-MM-DD`, 2026년 |
| `verified_at` | 8종목 확인을 완료한 시각, 시간대가 포함된 ISO 8601 문자열 |
| `markets` | 아래 8개 시세 코드를 정확히 키로 갖는 객체 |

`markets` 키: `NVDA`, `TSLA`, `AMZN`, `GOOGL`, `KRW-BTC`, `034020.KS`,
`267260.KS`, `011200.KS`.
v1 종목 객체의 키는 아래 4개만 허용합니다. 기존 v1 입력·종가 기록을 계속 읽습니다.

| 키 | 값 |
|---|---|
| `price` | 확인한 확정 종가, 유한한 양수 JSON 숫자; 문자열·쉼표·불리언 불가 |
| `date` | 해당 종목의 실제 종가 기준일, `YYYY-MM-DD`, 2026년 |
| `currency` | 미국 4종목 `USD`, BTC와 한국 3종목 `KRW` |
| `source` | 정확히 `name`, `url` 두 키를 갖는 객체 |

`source.name`은 공백 제외 1~100자 출처 이름입니다. `source.url`은 2048자 이하
공개 HTTPS URL이며 로그인 정보와 443 이외 포트를 허용하지 않습니다.
아래 출처 호스트와 해당 종목 코드가 URL 경로 또는 쿼리에 있어야 합니다.

| 종목 | 허용 출처 호스트 |
|---|---|
| 미국 | `finance.yahoo.com`, `nasdaq.com`, `www.nasdaq.com`, `stockanalysis.com`, `www.marketbeat.com` |
| 한국 | `finance.naver.com`, `m.stock.naver.com`, `finance.daum.net`, `data.krx.co.kr`, `www.krx.co.kr`, `markets.hankyung.com`, `kind.krx.co.kr` |
| BTC | `api.upbit.com`의 `/v1/candles/days` (`market=KRW-BTC` 정확히 1개); v2 현물은 `/v1/ticker` (`markets=KRW-BTC` 정확히 1개) |

미국 출처 URL 예: `https://finance.yahoo.com/quote/NVDA/history/`.
한국 출처 URL 예: `https://finance.naver.com/item/sise_day.naver?code=034020`.
BTC 출처 URL 예: `https://api.upbit.com/v1/candles/days?market=KRW-BTC&count=1`.
실제 확인한 페이지 URL을 기록합니다. BTC의 `date`는 UTC 00:00/KST 09:00에 시작한
완료 일봉의 시작 날짜입니다. 캔들 종료 시각을 기준일로 넣지 않습니다.

코드는 출처 형식·호스트·종목 코드·통화·날짜 일관성을 검증하며 출처 URL을 열거나
시세를 수집하지 않습니다. 페이지의 실제 종가와 거래일, 휴장일, 완료 일봉 여부는
입력 담당자가 웹 검색/공식 자료에서 확인해야 합니다. 미확인 종목이 있으면 파일을
저장하지 않습니다. `verified_at`의 한국 날짜는 `trade_date`와 같아야 하며 미래 시각
또는 확인 후 36시간이 지난 입력은 실패합니다. 주식 주말 날짜와 진행 중 BTC 일봉도
거부합니다. 보수적인 완료 시각은 한국 주식 당일 15:45 KST, 미국 주식 다음날
06:15 KST, BTC 다음날 09:00 KST입니다.

## 실제 시세 v2

최상위 4개 키는 동일합니다. 각 종목은 v1의 4개 키와 아래 4개 키를 **모두** 갖습니다.
알 수 없는 키, 빠진 종목, 혼합 스키마, 중복 JSON 키를 거부합니다.

| 키 | 의미 / 허용값 |
|---|---|
| `as_of` | 출처에서 확인한 실제 가격 기준시각. 초와 시간대를 포함한 ISO 8601. 열람·검색·입력 시각을 넣지 않습니다. |
| `price_type` | 주식 `last_trade` 또는 `previous_close`; BTC `spot` 또는 `daily_close` |
| `session` | 미국 거래가격 `day`(데이장/overnight), `pre`(프리장), `regular`(정규장), `after`(시간외). 한국 거래가격 `pre`, `regular`, `after`. 주식 종가는 `regular`. BTC 현물 `continuous`, 완료 일봉 `daily`. |
| `delay` | 정확히 `status`, `minutes` 두 키. 출처 표시 기준 `realtime`/정수 `0`, `delayed`/정수 `1..1440`분, `unknown`/`null` 중 하나. 지연을 모르면 0으로 만들지 않습니다. |

v2의 `price`는 해당 시각·세션에서 확인한 유한한 양수 가격입니다. 주식 `date`는
실제 가격 시각의 시장 현지 **달력 날짜**(미국 Eastern, 국내 KST)입니다. 미국 데이장이
전날 저녁 시작된 경우 KST 스냅샷 날짜와 다를 수 있습니다. BTC 현물 `date`는 실제
거래시각의 KST 날짜, 완료 일봉 `date`는 기존과 같이 KST 09:00에 시작한 일봉의
시작 날짜입니다. 완료 일봉 `as_of`는 다음날 09:00 KST의 마감 경계여야 합니다.

`as_of <= verified_at <= 실행 시각`이어야 하고 확인 입력의 36시간 제한을 유지합니다.
직전 종가와 완료 일봉은 v1의 보수적 완료 시각·주말 종가 검증을 유지합니다. 국내
09:10에는 당일 `last_trade`를 허용하며, 출처의 실제 거래시각과 지연 표시를 남깁니다.
미국은 09:10이라는 실행 시각으로 세션을 추론하지 않습니다. 출처가 가격과 함께
표시한 데이장·프리장·정규장·시간외 세션을 그대로 기록합니다. 휴장·조기 폐장·거래소별
세션 경계·가장 최신 값 여부는 입력 담당자가 근거 자료에서 대조해야 합니다. 검증기는
자산별 유형/세션 조합을 검사하지만 외부 자료를 읽거나 세션 시간을 자동 판정하지 않습니다.

종목 하나의 필드 형태 예시(실제 가격값을 제공하는 운영 입력 예시가 아님):

```text
price: 직접 확인한 숫자
date: 출처 시세의 시장 현지 날짜
currency: USD 또는 KRW (종목별 고정)
source: {name: 실제 출처 이름, url: 기존 허용 호스트의 해당 종목 URL}
as_of: 실제 시세 기준시각 (초·시간대 포함)
price_type: last_trade
session: day
delay: {status: unknown, minutes: null}
```

데이장·프리장 가격이 기존 허용 출처에서 확인되지 않으면 추정값이나 새 출처/API를
추가하지 않습니다. 확인 가능한 직전 종가를 그 종가의 **실제 기준일·시각**과
`previous_close`로 기록할 수 있습니다. 실제 시각까지 확인할 수 없으면 v2 값을
현재 시각으로 꾸미지 말고 입력을 중단해 보고합니다. `unknown`은 지연 여부만
미확인인 상태이며, 가격·시각·세션 자체의 미확인을 허용하는 값이 아닙니다.

출력 `markets`는 기존 `price`, `date`, `currency`, `source`, `sourceUrl`, `stale`를
유지하며 v2에만 `asOf`, `priceType`, `session`, `delay`를 추가합니다. `asOf`는 같은
순간의 KST ISO 문자열로 정규화하며 초 미만 정밀도도 보존합니다. `manualInput`의
`verifiedAt`은 확인 시각이고 v2에는 `schemaVersion: 2`가 붙습니다. `updatedAt`은
저장 시각입니다. v1에 없는 실제 시각·지연 여부를 새 값으로 채우지 않습니다.
화면은 세션/유형·실제 시각·출처·지연 여부를 표시하고 v1은 종가 기준일과 실제
시각 미기록 상태를 표시합니다. 지연 또는 지연 여부 미확인은 잠정 순위 경고를 냅니다.

v2 새 일별 기록에는 `quotes`에 종목별 가격과 모든 메타데이터를 보존합니다. 기존
일별 기록의 `returns`, `ranks`, `losers`, `priceDates`와 주간 대표값 선택은 그대로입니다.
차트의 토요일 대표값은 저장 시점의 순위이며 모든 종목의 확정 종가라는 의미는 아닙니다.
과거 종가 기록은 소급 변환하지 않습니다.

## 매일 실행할 절차

1. 8종목 모두 그 시각에 검증 가능한 최신 가격과 실제 기준일·시각·세션·지연 표시를
   확인하고 기존 허용 출처 이름·URL을 확보합니다. 미국 달러 시세, 업비트 KRW-BTC
   원화 현물/완료 일봉, 한국 3종목 원화 거래가격/직전 종가를 구분합니다.
2. `data/prices.json`을 읽습니다. 8종목 가격과 날짜가 모두 같으면 입력 파일 저장과
   새 커밋을 생략합니다(v1). v2는 가격·날짜·통화·출처·실제 기준시각·유형·세션·지연
   정보까지 같아야 생략합니다. 확인 시각만 달라진 중복은 저장하지 않습니다. 새
   시세 시각에 같은 가격이 확인됐거나 지연/출처 정보가 바뀌면 새 데이터로 처리합니다.
3. `update.yml`의 서버 상태가 `disabled_manually`인지 확인합니다. 확인할 수 없거나
   활성화되어 있으면 main에 쓰지 않습니다. 워크플로를 활성화하거나 실행하지 않습니다.
4. 위 스키마로 UTF-8 JSON을 완성합니다. 한국시간 스냅샷 날짜와 실제 확인 시각을
   기록하고, 기존 GitHub 연결 도구로 지정 저장소 `main`의 입력 파일만 저장합니다.
   첫 생성에는 `create_file`, 이후에는 최신 파일 SHA를 읽고 `update_file`을 사용합니다.
   Git 데이터 API를 사용한다면 현재 main의 커밋·tree에서 입력 파일만 바꾼 커밋을
   생성하고 `update_ref`의 `expected_sha`로 경쟁 변경을 막습니다. 강제 push하지 않습니다.
5. 저장 결과의 커밋 SHA를 보관합니다. 원격 파일을 그 커밋 ref로 다시 읽어 내용과
   **입력 파일 blob SHA**를 확인합니다. 커밋 SHA와 파일 blob SHA는 서로 다릅니다.
6. 그 입력 커밋의 `manual.yml` 실행이 성공했는지 확인합니다. 출력 changed=false는
   정상 중복 생략입니다. 실패 시 원인을 확인하며 거짓 데이터나 임의 날짜로 재시도하지
   않습니다. 부모 연결의 workflow job/run 재실행 기능은 실패 복구에 사용할 수 있습니다.
7. 변경이 있었다면 `data/prices.json.manualInput.sha`가 입력 파일 blob SHA와 같고,
   `manualInput.commit`이 입력 커밋 SHA와 같은지 확인합니다. `markets`의 가격·날짜·통화와
   사이트 게시 JSON도 비교하고 v2 기준시각·세션·지연·확인 시각, 실제 순위·주간
   차트·갱신 시각을 확인합니다.
   SHA가 다르거나 배포가 실패하면 사이트 반영 완료라고 보고하지 않습니다.

Git을 사용할 때 입력 SHA 확인 명령은
`git rev-parse <입력커밋SHA>:inputs/closing-prices.json`입니다.
연결 도구의 파일 응답 `sha` 또는 tree의 해당 경로 `sha`도 같은 blob SHA입니다.
`updatedAt`은 데이터 저장 시각이며 실제 Pages 배포 완료 시각은 별도로 확인합니다.

## 중복·경쟁 실행 처리

동시성 그룹은 기존 `sool-manual-pages`를 사용합니다. 실행 시작 시 입력 커밋의 파일
SHA와 현재 main의 파일 SHA를 비교합니다. 더 최신 입력이 있으면 오래된 실행은
생략합니다. 입력이 같으면 최신 main을 기준으로 작업합니다. 위 버전별 비교 필드가
동일하면 파일·기록·갱신 시각을 보존하고 커밋·배포를 생략합니다. 기존 기준일 또는
실제 시세 시각보다 오래된 입력, 과거 스냅샷 날짜로의 복귀, 잠긴 최종 결과 변경을
거부합니다. v1에서 v2로 전환할 때는 기존 종가 종료 경계(미국 정규장 16시 Eastern,
국내 15:30 KST, BTC 다음날 09시)를 역행 검사에만 사용하며 실제 시각으로 저장하지
않습니다. v1 미국 조기 폐장일도 보수적으로 16시 경계를 적용하므로 같은 날의 더
이른 시세 전환은 거부될 수 있습니다. v2 실제 시각을 같은 기준일의 v1 입력으로
제거하지 않습니다. 당일 재확인만 같은 날짜 기록을 대체하고 다른 날짜는 보존합니다.
결과 커밋은 data 파일만 바꾸므로 push paths
필터에 걸리지 않으며 재귀 실행되지 않습니다. 작업 중 main이 바뀌어 push가 실패하면
배포도 중단되므로 강제 push나 덮어쓰기로 해결하지 않습니다.

## 로컬 확인

`python scripts/manual_update.py --input-file <검증파일> --check`는 입력 검증과
변경 여부만 확인하며 데이터는 쓰지 않습니다. 기존 환경변수 입력 경로는 호환용으로
남아 있지만 운영 워크플로는 입력 파일만 사용합니다.
`python -m unittest discover -s tests -v`는 임시 복사본만 사용합니다.
Node.js가 있으면 실제 프런트 코드의 순위·주간 집계 호환성도 검사합니다.
`node tests/header_dates.cjs`, `node tests/participant_details.cjs`,
`node tests/market_quotes.cjs`는 표시·계산 회귀를 검사합니다. 테스트는 수집기를 실행하지
않습니다. 워크플로 변경, 예약 변경, main 병합, 실제 가격 입력·배포는 코드 검증과
분리해 검토해야 합니다. UI 변경을 main에 병합하면 기존 manual.yml UI 경로가 배포를
실행하므로 병합 자체도 운영 검토 후 진행합니다.

## KRX KIND 공식 출처
KIND는 `https://kind.krx.co.kr/common/stockprices.do?isurCd=03402&method=searchStockPricesMain`
형식만 허용합니다. 두산에너빌리티 034020→03402, HD현대일렉트릭 267260→26726,
HMM 011200→01120를 정확히 대응하며, 다른 경로·조회 방식·추가/중복 쿼리·fragment를 거부합니다.
KIND의 실제 마감 시각과 거래일을 열람해 확인한 경우만 사용합니다.
기존 8종목 필수·확정 종가·통화·시각·역행 방지 검증은 그대로 유지합니다.
