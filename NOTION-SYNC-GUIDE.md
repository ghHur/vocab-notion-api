# Notion 동기화 설정 가이드 (Next.js + Vercel)

Vocabulary 단어장 앱을 Notion DB와 연동해서 기기 간 동기화를 구현하는 가이드입니다.

## 전체 구조

```
갤럭시 탭 (앱)  ──┐
                   ├──→  Next.js API (Vercel)  ──→  Notion API  ──→  Notion DB
랩탑 (앱)      ──┘       (무료 서버리스)
```

---

## 1단계: Notion 데이터베이스 만들기

### 1-1. 새 데이터베이스 생성
1. Notion에서 새 페이지 생성
2. `/table` 입력 → **Table - Full page** 선택
3. 페이지 제목: `Vocabulary DB`

### 1-2. 컬럼(속성) 설정

기존 "Name" 컬럼의 이름을 `term`으로 변경하고, 나머지 컬럼을 추가:

| 컬럼명 | 타입 (Property type) | 설명 |
|--------|---------------------|------|
| `term` | **Title** (기본) | 영어 단어 |
| `meaning` | **Text** | 한국어 뜻 |
| `example` | **Text** | 예문 |
| `notes` | **Text** | 메모 |
| `tags` | **Multi-select** | 태그 |
| `difficulty` | **Number** | 난이도 (0~3) |
| `createdAt` | **Date** | 등록 날짜 |

> ⚠️ **컬럼명은 정확히 위와 같아야 합니다** (대소문자 구분)

### 1-3. 데이터베이스 ID 확인
URL에서 복사:
```
https://www.notion.so/XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX?v=YYYY
                      ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
                      이 부분이 Database ID (32자)
```

---

## 2단계: Notion Integration 만들기

1. https://www.notion.so/my-integrations 접속
2. **+ New integration** 클릭
3. 이름: `Vocabulary App`, Type: **Internal**
4. **Submit** → **Internal Integration Secret** 복사해서 메모
5. Notion에서 Vocabulary DB 페이지 → **···** → **Connect to** → `Vocabulary App` 선택

---

## 3단계: Next.js 프로젝트를 Vercel에 배포

### 방법 A: GitHub에서 바로 배포 (추천, 가장 간단)

#### 3-A-1. GitHub 저장소 만들기
1. https://github.com/new 에서 새 저장소 생성
2. 이름: `vocab-notion-api`
3. **Public** 선택 → **Create repository**

#### 3-A-2. 파일 업로드
**Add file → Upload files**로 다음 파일/폴더 구조를 업로드:

```
vocab-notion-api/
├── app/
│   ├── api/
│   │   └── words/
│   │       ├── route.js          ← 전체 조회 & 추가
│   │       └── [id]/
│   │           └── route.js      ← 수정 & 삭제
│   ├── layout.js
│   └── page.js
├── lib/
│   └── notion.js                 ← Notion 클라이언트
├── .gitignore
├── next.config.js
└── package.json
```

> 💡 GitHub 웹에서 폴더 구조 만드는 법:
> **Add file → Create new file** → 파일명에 `app/api/words/route.js`처럼 `/`를 넣으면 자동으로 폴더가 생김

#### 3-A-3. Vercel에 배포
1. https://vercel.com 에 GitHub 계정으로 가입 & 로그인
2. **Add New → Project** 클릭
3. `vocab-notion-api` 저장소 선택 → **Import**
4. **Environment Variables** 섹션에 두 개 추가:

| Name | Value |
|------|-------|
| `NOTION_API_KEY` | 2단계에서 복사한 Integration Secret |
| `NOTION_DB_ID` | 1-3에서 복사한 Database ID |

5. **Deploy** 클릭
6. 배포 완료 후 URL 확인:
```
https://vocab-notion-api.vercel.app
```

### 방법 B: 로컬에서 개발 & 배포 (개발자용)

```bash
# 프로젝트 클론
git clone https://github.com/YOUR_USERNAME/vocab-notion-api.git
cd vocab-notion-api

# 패키지 설치
npm install

# 환경변수 설정 (.env.local 파일 편집)
# NOTION_API_KEY=ntn_xxxxx
# NOTION_DB_ID=xxxxx

# 로컬 테스트
npm run dev
# → http://localhost:3000/api/words 접속해서 확인

# Vercel에 배포
npm install -g vercel
vercel
# → 프롬프트 따라 진행, 환경변수는 Vercel 대시보드에서 설정
```

---

## 4단계: 단어장 앱에서 연결

1. Vocabulary 앱 열기 (갤럭시 탭 또는 랩탑)
2. 상단 데이터 바에서 **⚙ Notion 연결** 클릭
3. Vercel URL 입력:
```
https://vocab-notion-api.vercel.app
```
4. 확인 → 자동으로 Notion에서 단어를 가져옴!

### 기존 단어 업로드
- 로컬에 이미 단어가 있으면 **↑ 전체 업로드** 버튼 클릭
- 이후 추가/수정/삭제는 자동으로 Notion에 반영

### 다른 기기에서 사용
- 같은 단어장 앱 URL 접속 → **⚙ Notion 연결** → 같은 Vercel URL 입력
- **↻ 동기화** 버튼으로 최신 데이터 가져오기

---

## API 테스트

배포 후 브라우저에서 확인:

```
https://vocab-notion-api.vercel.app/api/words
```

JSON 응답이 오면 성공! `{ "success": true, "words": [...] }`

---

## 무료 사용 한도

| 서비스 | 무료 한도 | 단어장 사용 시 |
|--------|----------|---------------|
| Vercel (Hobby) | 월 100GB 대역폭, 무제한 요청 | 충분 |
| Notion API | 초당 3 요청 | 충분 |
| GitHub Pages | 월 100GB 트래픽 | 충분 |

전부 무료로 사용 가능!

---

## 문제 해결

### "동기화 실패" 메시지
- Vercel URL이 정확한지 확인 (끝에 `/` 없이)
- Vercel 대시보드 → Deployments → 최신 배포가 성공인지 확인
- Environment Variables에 `NOTION_API_KEY`, `NOTION_DB_ID`가 올바른지 확인
- Notion DB에 Integration이 연결되었는지 확인

### 404 에러
- `/api/words` 경로가 정확한지 확인
- Vercel에 재배포: 저장소에 push하면 자동 재배포됨

### Notion에 데이터가 안 보일 때
- 컬럼명이 정확히 `term`, `meaning`, `example`, `notes`, `tags`, `difficulty`, `createdAt`인지 확인

### 로컬 테스트에서 에러
- `.env.local` 파일이 프로젝트 루트에 있는지 확인
- `npm install`을 실행했는지 확인
- Node.js 18 이상인지 확인: `node --version`
