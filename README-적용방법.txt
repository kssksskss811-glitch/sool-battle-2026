술값배틀 2026 — 매일 17:30(KST) 딱 한 번 최소 조회 패치
=========================================================

대상: 기존 GitHub Pages 사이트 그대로 사용
자동 수집: 매일 17:30 한국시간, GitHub Actions 예약 실행 1회
한 번 실행 시: Yahoo Finance 미국 4종목, 네이버 금융 국내 3종목, 업비트 비트코인 1종목.
정상 응답 기준으로 총 8개의 HTTP 조회. Yahoo에서 국내 종목을 추가로 조회하지 않음.
한 종목이 실패해도 재요청하지 않고 이전 가격을 'stale'로 표시.
가격 파일(data/prices.json)과 과거 순위 기록(data/history.json)은 그대로 유지.

변경 파일 (총 3개)
----------------
1. scripts/update_prices.py
   - Yahoo 조회 대상: NVDA, TSLA, AMZN, GOOGL 4종목만
   - 네이버 조회 대상: 034020, 267260, 011200 3종목만
   - 비트코인 조회: 업비트 KRW-BTC 한 건
   - 중복 교차조회, 자동 재시도, 과거 백필 자동 호출 제거
   - 기존 2026년 과거 순위 기록, 공동 1위 로직 유지

2. .github/workflows/update.yml
   - UTC 08:30 = KST 17:30, 하루 한 번 예약
   - 코드 업로드(push) 때는 홈페이지 배포만 함. 가격 조회는 하지 않음.
   - Actions에서 Run workflow를 수동 실행하면 예약과 별개로 한 번 더 조회함.

3. index.html
   - 상단 안내를 '하루 1회 / 매일 오후 5:30 일괄 갱신'으로 변경
   - 순위표, 미장·국장 D-day, 주간 순위 차트는 그대로 유지

GitHub 적용 (한 번에 작업하려면)
--------------------------------
먼저 기존 저장소 파일의 백업을 추천합니다.
1) ZIP 압축을 풀고, GitHub 저장소 Code 탭으로 이동합니다.
   https://github.com/kssksskss811-glitch/sool-battle-2026
2) scripts/update_prices.py를 열고 연필 아이콘 > 코드 전체 교체 > Commit changes.
3) .github/workflows/update.yml을 열고 연필 아이콘 > 코드 전체 교체 > Commit changes.
   (.github는 숨김 폴더이므로 웹 업로드보다는 연필 아이콘이 편합니다.)
4) index.html도 같은 방법으로 교체 > Commit changes.
5) Actions 실행 기록을 확인합니다. 'push'에서 실행한 작업은 배포만 합니다.
   자동 조회는 매일 17:30(KST) 예정이며, 수동으로 검증하려면
   Actions > 해당 워크플로 > Run workflow를 한 번만 실행합니다.
6) 홈페이지를 강력 새로고침(Ctrl+Shift+R)합니다.
   https://kssksskss811-glitch.github.io/sool-battle-2026/

주의
----
- 미국 주식: 한국시간 17:30 기준 가장 최근에 마감된 미국 거래일 종가입니다.
- 한국 주식: 같은 날 15:30 정규장 종료 후 확정 종가를 사용합니다.
- 비트코인: 한국시간 09:00에 완료된 최근 업비트 일봉입니다.
- 응답 실패일 때 해당 종목은 과거 가격과 stale=True로 표시됩니다.
- 공휴일에는 최신 시장 종가 날짜가 서로 다를 수 있습니다.
- 적은 조회량이라고 Yahoo/네이버의 데이터 자동 수집 이용약관 문제가 해결되지는 않습니다.
- GitHub 예약 작업은 서버 사정에 따라 예정 시간보다 지연될 수 있습니다.
- 실제 외부 API 서버에서 실행하는 검증은 GitHub Actions 실행 후 확인해야 합니다.

테스트: Python 문법 검사/YAML 구조 검사, Yahoo 4 + Naver 3 + Upbit 1 = 8요청
모의 성공/네이버 403 실패 시 이전값 보존 테스트 통과.
