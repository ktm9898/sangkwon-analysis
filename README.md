# 🏪 상권분석 웹앱

업종별 상권 범위를 자동으로 시각화하고, 경쟁 업체의 상권 중첩도를 분석하여 **최적 창업 입지**를 추천하는 웹앱입니다.

## 주요 기능

- 📍 **지도 클릭** → 분석 기준점 설정
- 🗂️ **업종 선택** → 편의점, 미용실, 세탁소, 음식점, 카페, 학원
- 🔵 **등시선 분석** → 도보 시간 기반 1차/2차/3차 상권 범위 (OpenRouteService)
- 🏪 **경쟁업체 탐색** → 네이버 지역검색 API 연동
- 🔴 **상권 중첩 히트맵** → Turf.js 기반 격자 분석
- ⭐ **최적 입지 Top 3** → 경쟁 밀도 + 접근성 기반 추천

## 사전 준비

### API 키 발급

| API | 발급처 | 용도 |
|-----|--------|------|
| 네이버 Maps Client ID | [네이버 클라우드 플랫폼](https://console.ncloud.com) | 지도 표시 |
| 네이버 검색 API (ID + Secret) | [네이버 개발자센터](https://developers.naver.com) | 경쟁업체 검색 |
| OpenRouteService API Key | [openrouteservice.org](https://openrouteservice.org) | 등시선 분석 |

### API 키 설정

1. **네이버 Maps**: `index.html`의 `ncpKeyId=YOUR_NAVER_MAP_CLIENT_ID` 부분 교체
2. **네이버 검색 + ORS**: 프록시 서버 실행 시 환경변수로 설정

## 실행 방법

### 1. 프록시 서버 실행

```bash
cd server
npm install
set NAVER_CLIENT_ID=your_id
set NAVER_CLIENT_SECRET=your_secret
set ORS_API_KEY=your_key
npm start
```

### 2. 프론트엔드 실행

`index.html`을 브라우저로 열기 (또는 VS Code Live Server 사용)

## 기술 스택

- **프론트엔드**: HTML/CSS/JS (Vanilla), 네이버 Maps JS v3, Turf.js
- **프록시 서버**: Node.js Express
- **API**: 네이버 검색 API, OpenRouteService Isochrone API
