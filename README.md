# 술값배틀 2026 🍻

**9명 중 수익률 최하위 3명이 술을 사는 모임용 웹사이트.**

별도의 데이터베이스/서버/유료 서비스 없이 **GitHub Pages + GitHub Actions**로 운영하는 정적 사이트입니다.

## 무엇이 들어 있나요?

- 모바일/데스크톱 반응형 대시보드
- 9명 수익률 순위 · 위험구간 3인 · 개인 상세 카드 · 단톡방 공유
- 시작 단가와 현재 시장 종가 비교
- 매일 자동 시세 수집, 순위 변화 보존, 개인별 최근 30회 기록 그래프
- 2026 연말 마감 이후 결과 확정(잠금)
- 시세 수집 실패 시 과거 가격임을 표시하고, 임의 값을 만들지 않음

## 들어 있는 참가자와 시작 가격

| 참가자 | 종목 | 시세 코드 | 시작 단가 |
|:---|:---|:---|---:|
| 은지 | 엔비디아 | NVDA | 184.86 USD |
| 동민 | 엔비디아 | NVDA | 184.86 USD |
| 성수 | 테슬라 | TSLA | 445 USD |
| 오징 | 아마존 | AMZN | 247.3 USD |
| 빛나 | 구글(알파벳 A주) | GOOGL | 328.57 USD |
| 유민 | 비트코인(업비트 원화) | KRW-BTC | 133,600,000 KRW |
| 정욱 | 두산에너빌리티 | 034020.KS | 84,800 KRW |
| 광일 | HD현대일렉트릭 | 267260.KS | 849,000 KRW |
| 금승 | HMM | 011200.KS | 20,050 KRW |

> **종목 확인:** '구글'은 임시로 **GOOGL(A주)**, '비트'는 **업비트 KRW-BTC** 기준으로 설정했습니다. 선택 당시 GOOG(C주) 또는 빗썸 등 다른 거래소를 뜻했다면 코드를 수정해야 합니다. '두에빌'은 두산에너빌리티로 해석했습니다.

## 당장 미리보기

ZIP을 풀고 `index.html`을 더블클릭하세요. **가상 가격 데모**가 보입니다. `순위 흔들기` 버튼으로 순위 변화도 체험할 수 있습니다.

- `data/prices.json`이 `mode: "demo"`일 때 표시되는 가격·수익률은 모두 **허구의 예시**입니다.
- 실데이터 갱신이 처음 성공하면 데모 가격과 가상 히스토리를 제거합니다.
- 로컬의 `file://` 환경에서는 자동 API 호출 기능이 아니라 데모 모드로 동작합니다.

## 실제 사이트로 공개하는 순서

1. GitHub에서 새 **Public Repository**를 만듭니다. 예: `sool-battle-2026`.
2. ZIP 내용을 그대로 저장소 루트에 올립니다. `.github/workflows/update-and-deploy.yml` **숨김 폴더까지** 꼭 포함되어야 합니다.
3. GitHub 저장소 → **Settings → Pages → Build and deployment → Source: GitHub Actions**로 설정합니다.
4. 상단 **Actions** 탭에서 `술값배틀 · 종가 자동 수집 + 사이트 배포` 워크플로를 찾아 **Run workflow**를 눌러 첫 시세 수집/배포를 실행합니다.
5. 완료되면 `https://내-깃허브-아이디.github.io/sool-battle-2026/` 같은 주소로 단톡방에 공유합니다. 정확한 주소는 Pages 설정에서 확인하세요.

Git 명령어로 올릴 경우 (저장소를 먼저 생성):

```bash
git init
git branch -M main
git add .
git commit -m "Create sool battle site"
git remote add origin https://github.com/YOUR_ID/sool-battle-2026.git
git push -u origin main
```

### 자동 업데이트 주기

GitHub Actions가 아래 시간대에 자동으로 실행됩니다.

- 매일 **오전 9:30 KST** — 미국 주식 전일 종가와 비트코인 일봉 마감값 확인
- 매일 **오후 5:30 KST** — 국내 주식 당일 종가까지 반영
- GitHub 서버의 예약 작업은 몇 분 이상 늦을 수 있으며, 가격 제공 사이트 장애로 누락될 수도 있습니다.
- 열어 둔 사이트도 15분마다 게시된 데이터를 다시 확인합니다.

Actions가 새 종가를 읽고 `data/prices.json`, `data/history.json`을 갱신하며, 갱신 결과를 저장소에 커밋하고 GitHub Pages에 사이트를 다시 게시합니다.

> Github Free에서 Public Repository라면 일반적으로 Pages/Actions 무료 이용 범위 안에 운영할 수 있지만 GitHub 정책과 사용량 한도에 따라 달라질 수 있습니다. 장기간 활동이 없는 public repo는 예약 워크플로가 비활성화될 수 있으므로 **Actions 실행 내역을 가끔 확인**하세요.

## 연말 마감 규칙 (중요)

- **수익률 = (마감 종가 ÷ 시작 단가 − 1) × 100**; 거래 수수료, 세금, 배당, 환율 차이는 계산하지 않습니다.
- **미국 주식(NVDA/TSLA/AMZN/GOOGL):** 2026-12-31까지의 마지막 정규장 종가.
- **한국 주식:** 한국거래소는 2026-12-31 연말 휴장 예정이므로 **2026-12-30**까지 마지막 종가.
- **비트코인:** 업비트의 **2026-12-31자 KRW-BTC 일봉 종가**. 업비트 일봉은 **2027-01-01 09:00 KST**에 12/31자 캔들이 확정됩니다.
- **최종 잠금:** 2027-01-01 **09:20 KST 이후** 모든 종목의 종가를 정상 수집한 경우 `locked: true`로 저장하고 더 이상 재계산하지 않습니다.
- **동률:** 엔비디아 은지·동민은 수익률이 정확히 같으므로 공동 순위를 표현합니다. 단, 하위 3인 커트라인에 동률이 걸리면 UI에 별도 경고가 뜹니다. 누가 술값을 낼지 **동률 처리 규칙을 미리 합의하세요.**
- **주식분할:** 현금배당을 제외한 순수 가격 수익률입니다. 액면분할/병합 등 조정이 필요한 기업행동 발생 시 시작 단가도 조정해야 합니다.

## 실제 시세 소스 · 신뢰성

| 자산 | 데이터 소스 |
|---|---|
| 미국/한국 주식 | Yahoo Finance **비공식** 일봉 Chart API (`/v8/finance/chart/...`) |
| 비트코인 | Upbit **공식** 일 캔들 REST API (`/v1/candles/days`) |

Yahoo API는 비공식·비보장이고 요청이 차단되거나 종가 반영이 지연될 수 있습니다. **특히 연말 결산 전엔 증권거래소·증권사 종가를 수동으로 대조하세요.** 더 높은 안정성이 필요하면 유료 시세 API/국내 증권사 API로 교체하는 것이 좋습니다.

수집 실패 시엔 `mode`가 `partial` 또는 `unavailable`로 변경되고 해당 시세는 이전 값이 있을 때 **지연(stale)**으로 표시됩니다. 이전 데모 가격을 실제 가격인 것처럼 유지하지는 않습니다.

## 개인 정보 / 공개 범위

GitHub Pages의 공개 사이트 URL을 아는 사람은 누구나 볼 수 있습니다. 닉네임과 참가자 목록이 외부에 공개되어도 되는지 먼저 확인하세요. 비공개 모임이라면 비밀번호 또는 로그인 보호형 별도 호스팅으로 변경해야 합니다.

## 파일 구조

```text
index.html                           메인 웹페이지
assets/style.css                     반응형 디자인
assets/app.js                        수익률 계산 · 랭킹 · 그래프 · 공유
assets/favicon.svg                   파비콘
data/prices.json                     자동 수집 종가 (초기값은 가상 데모)
data/history.json                    날짜별 변화 이력 (초기값은 가상 데모)
scripts/update_prices.py             시세 갱신 Python
.github/workflows/update-and-deploy.yml    자동 수집 및 Pages 배포
```

## 참고 링크

- 업비트 일 캔들 문서: https://docs.upbit.com/kr/reference/list-candles-days
- GitHub Pages Actions 배포: https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages
