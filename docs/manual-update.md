# 검증된 종가 입력 파일로 갱신

운영 입력 파일은 `inputs/closing-prices.json` 하나입니다. `main`에서 이 파일이
바뀌는 push가 `manual.yml`의 가격 입력 경로를 실행합니다. `index.html` 또는
`assets/**` 변경은 같은 워크플로의 UI 전용 배포 경로를 실행하며 입력 파일 검증과
가격 저장을 건너뜁니다. 기존 데이터·확인 시각·과거 기록을 바꾸지 않고 최신 main을
배포합니다. 문서 push와 결과 데이터 커밋은 실행을 유발하지 않습니다.
`update.yml`은 계속 Disabled로 유지합니다.
첫 운영 파일은 검증한 실제 가격이 준비된 뒤 생성합니다. 예시 가격 파일은 없습니다.

## 정확한 스키마

최상위 키는 아래 4개만 허용합니다.

| 키 | 값 |
|---|---|
| `schema_version` | JSON 정수 `1` |
| `trade_date` | 한국시간 스냅샷 날짜, `YYYY-MM-DD`, 2026년 |
| `verified_at` | 8종목 확인을 완료한 시각, 시간대가 포함된 ISO 8601 문자열 |
| `markets` | 아래 8개 시세 코드를 정확히 키로 갖는 객체 |

`markets` 키: `NVDA`, `TSLA`, `AMZN`, `GOOGL`, `KRW-BTC`, `034020.KS`,
`267260.KS`, `011200.KS`.
각 종목 객체의 키도 아래 4개만 허용합니다.

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
| 한국 | `finance.naver.com`, `m.stock.naver.com`, `finance.daum.net`, `data.krx.co.kr`, `www.krx.co.kr`, `markets.hankyung.com` |
| BTC | `api.upbit.com`의 `/v1/candles/days`, 쿼리 `market=KRW-BTC` 정확히 1개 |

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

## 매일 실행할 절차

1. 8종목 모두 최신 **확정 종가**와 실제 기준일을 확인하고 출처 이름·URL을 확보합니다.
   미국 달러 종가, 업비트 KRW-BTC 원화 일봉, 한국 3종목 원화 종가를 구분합니다.
2. `data/prices.json`을 읽습니다. 8종목 가격과 날짜가 모두 같으면 입력 파일 저장과
   새 커밋을 생략합니다. 새 날짜에 같은 가격이 나왔으면 새 데이터로 처리합니다.
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
   사이트 게시 JSON도 비교하고 실제 순위·주간 차트·갱신 시각을 확인합니다.
   SHA가 다르거나 배포가 실패하면 사이트 반영 완료라고 보고하지 않습니다.

Git을 사용할 때 입력 SHA 확인 명령은
`git rev-parse <입력커밋SHA>:inputs/closing-prices.json`입니다.
연결 도구의 파일 응답 `sha` 또는 tree의 해당 경로 `sha`도 같은 blob SHA입니다.
`updatedAt`은 데이터 저장 시각이며 실제 Pages 배포 완료 시각은 별도로 확인합니다.

## 중복·경쟁 실행 처리

동시성 그룹은 기존 `sool-manual-pages`를 사용합니다. 실행 시작 시 입력 커밋의 파일
SHA와 현재 main의 파일 SHA를 비교합니다. 더 최신 입력이 있으면 오래된 실행은
생략합니다. 입력이 같으면 최신 main을 기준으로 작업합니다. 가격·기준일이 동일하면
파일·기록·갱신 시각을 보존하고 커밋·배포를 생략합니다. 기존 종가보다 오래된 입력과
잠긴 최종 결과의 변경은 거부합니다. 결과 커밋은 data 파일만 바꾸므로 push paths
필터에 걸리지 않으며 재귀 실행되지 않습니다. 작업 중 main이 바뀌어 push가 실패하면
배포도 중단되므로 강제 push나 덮어쓰기로 해결하지 않습니다.

## 로컬 확인

`python scripts/manual_update.py --input-file <검증파일> --check`는 입력 검증과
변경 여부만 확인하며 데이터는 쓰지 않습니다. 기존 환경변수 입력 경로는 호환용으로
남아 있지만 운영 워크플로는 입력 파일만 사용합니다.
`python -m unittest discover -s tests -v`는 임시 복사본만 사용합니다.
Node.js가 있으면 실제 프런트 코드의 순위·주간 집계 호환성도 검사합니다.
