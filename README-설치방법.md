# 술값배틀 2026 — API 없는 수동 종가 입력

## 먼저 확인
- 기존 `.github/workflows/update.yml`은 **Disable workflow 상태 유지**. Enable workflow를 누르지 마세요.
- 새 작업 `.github/workflows/manual.yml`에는 `schedule`도, `scripts/update_prices.py` 실행도 없습니다.
- 수동 입력을 눌렀을 때만 `manual_update.py`로 JSON을 고치고 GitHub Pages로 배포합니다.
- `data/history.json` 과거 기록은 보존하고 해당 날짜만 교체합니다.
- 사이트가 읽는 `data/prices.json`은 입력한 8개 가격으로 교체됩니다.

## 설치 (최초 1회)
1. ZIP 압축 풀기
2. GitHub 저장소 Code 화면에서 `index.html`과 `assets/app.js`를 각각 교체
3. `scripts/manual_update.py` 새 파일 업로드
4. `.github/workflows/manual.yml`을 GitHub `Add file -> Create new file`로 만들고 내용을 붙여넣어 저장
5. Settings -> Pages -> Source가 `GitHub Actions`인지 확인
6. 기존 update.yml은 계속 비활성화 상태인지 확인

**주의:** 비활성화된 update.yml을 다시 활성화하지 마세요.

## 매주 수동 입력
1. GitHub 저장소 -> Actions -> `술값배틀 · 수동 종가 입력 및 사이트 배포`
2. `Run workflow` -> 날짜 YYYY-MM-DD와 8개 종목 가격 입력 (쉼표 없이)
3. `Run workflow`로 실행. 성공하면 기존 GitHub Pages 주소에 자동 배포됨
4. 주간 차트는 data/history.json의 수동 기록 날짜로 계산됨

## 주의사항
- 입력한 가격이 정확한 확정 종가인지는 사람이 확인해야 합니다.
- 같은 날짜에 재입력하면 해당 날짜 이력만 교체합니다.
- 과거 2026년 기록은 보존됩니다.
- 이 패치는 GitHub 페이지 상단에서 '수동 입력 중'임을 알려줍니다.
- **GitHub Pages 접속자 아무나 편집하는 방식은 아닙니다.** GitHub 저장소 수정 권한을 가진 관리자만 수동 입력할 수 있습니다.
- 다른 사이트 파일을 수정해도 자동 배포되지 않으므로, 그때에는 수동 워크플로를 한번 실행해야 합니다(가격 재입력 필요).
- 이 워크플로는 Yahoo/네이버/업비트 등 외부 시세 API를 호출하지 않습니다. 단 GitHub 자체의 checkout/배포 통신은 발생합니다.
- GitHub Actions 자체를 이용하므로 계정/저장소 정책 준수는 여전히 필요합니다.
