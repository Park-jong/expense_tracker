# 가계부 (Expense Tracker)

🔗 **배포 주소: [https://park-jong.github.io/expense_tracker/](https://park-jong.github.io/expense_tracker/)**

수입과 지출을 기록하고, 월별 합계와 달력으로 한눈에 확인할 수 있는 간단한 가계부 웹 앱입니다.
Google Drive에 `가계부.csv` 파일로 데이터를 저장하기 때문에 별도의 서버 없이도 어디서나 같은 내역을 확인할 수 있습니다.

## 주요 기능

- **거래 내역 관리** : 날짜, 수입/지출 유형, 카테고리, 내용, 금액을 입력해 거래를 추가하고 삭제할 수 있습니다.
- **월별 요약** : 선택한 달의 수입 · 지출 · 잔액을 카드로 보여 줍니다.
- **달력 보기** : 날짜별 수입/지출 합계를 달력에서 확인하고, 날짜를 누르면 해당 일의 상세 내역을 볼 수 있습니다.
- **Google Drive 연동** : 로그인하면 Drive에 저장된 데이터를 불러오고, 변경 사항은 자동으로 저장됩니다.

## 사용 화면

> 아래 화면은 예시 데이터를 넣어 캡처한 것입니다.

### 목록 화면

월을 선택하면 해당 월의 수입 · 지출 · 잔액 요약과 거래 내역이 최신 날짜순으로 표시됩니다.

<img src="docs/01-list.png" alt="목록 화면" width="360">

### 거래 추가

**+ 거래 추가** 버튼을 누르면 입력 폼이 열립니다. 유형(수입/지출)에 따라 선택 가능한 카테고리가 달라집니다.

<img src="docs/02-add-form.png" alt="거래 추가 화면" width="360">

| 유형 | 카테고리 |
| --- | --- |
| 수입 | 급여, 부업, 투자, 기타수입 |
| 지출 | 식비, 교통, 주거, 의료, 쇼핑, 문화, 기타지출 |

### 달력 화면

날짜별로 그날의 수입/지출 합계가 표시되며, 오늘 날짜는 강조됩니다. 좌우 화살표로 달을 이동할 수 있습니다.

<img src="docs/03-calendar.png" alt="달력 화면" width="360">

### 날짜별 상세 내역

달력에서 날짜를 누르면 하단에 그날의 거래 내역이 나타납니다.

<img src="docs/04-calendar-detail.png" alt="날짜별 상세 내역 화면" width="360">

## Google Drive 연동

1. 우측 상단의 **Google Drive 연결** 버튼을 눌러 Google 계정으로 로그인합니다.
2. 처음 로그인하면 Drive 파일 접근 권한 동의 화면이 나타납니다. (`drive.file` 범위 : 이 앱이 만든 파일만 접근)
3. 로그인 후에는 Drive의 `가계부.csv`를 불러오며, 거래를 추가/삭제하면 약 0.8초 뒤 자동으로 저장됩니다.
4. 저장 상태는 헤더에 `저장 중...` / `✓ 저장됨` / `⚠ 저장 실패`로 표시됩니다.

로그인 상태는 브라우저 탭(sessionStorage) 동안 유지되며, **로그아웃**을 누르면 토큰이 해제됩니다.

## 기술 스택

- React 19 (Create React App)
- Google Identity Services + Google Drive API v3
- GitHub Pages 배포

## 실행 방법

```bash
npm install
npm start
```

프로젝트 루트에 `.env` 파일을 만들고 Google OAuth 클라이언트 ID를 설정해야 Drive 연동이 동작합니다.

```
REACT_APP_GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
```

### 빌드 및 배포

```bash
npm run build    # 빌드
npm run deploy   # GitHub Pages 배포 (gh-pages)
```

## 프로젝트 구조

```
src/
├── App.js           # 앱 진입 컴포넌트 (탭, 인증, 자동 저장)
├── ListPage.js      # 목록 화면 (요약, 거래 추가/삭제)
├── CalendarPage.js  # 달력 화면
└── googleDrive.js   # Google 로그인 및 Drive CSV 읽기/쓰기
```
