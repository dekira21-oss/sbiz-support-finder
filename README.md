# 소상공인 지원금 찾기

업종과 지역을 고르면 소상공인이 받을 수 있는 정부·지자체 지원사업(창업, 인건비, 정책자금, 경영개선, 사회보험, 판로, 재기)을 찾아 주는 한 페이지 앱입니다.

- 주소: https://dekira21-oss.github.io/sbiz-support-finder/
- 자료 기준일: 2026.10.29
- 정부·공공기관의 공식 사이트가 아닙니다. 신청 전 각 기관의 공고문을 확인하세요.

## 실시간 공고 자동 갱신

- `.github/workflows/update-notices.yml`이 매일 한국시간 오전 6시에 `scripts/fetch-notices.mjs`를 실행해 기업마당 지원사업정보 API와 K-Startup 사업공고 API에서 진행 중인 공고를 받아 `data/notices.json`에 저장합니다.
- 인증키는 저장소 **Settings → Secrets and variables → Actions**의 Repository secrets에 등록합니다. 키를 파일에 직접 쓰지 마세요.
  - `BIZINFO_KEY`: 기업마당 지원사업정보 API 인증키
  - `DATA_GO_KR_KEY`: 공공데이터포털 인증키(창업진흥원 K-Startup 조회서비스 활용신청 필요)
- 키가 없으면 작업은 공고를 받지 않고 끝나며, 앱은 실시간 공고 없이 정리된 사업만 보여 줍니다.
