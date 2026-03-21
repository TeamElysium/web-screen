# web-screen 작업 계획

## 현재 상태

**마지막 커밋**: `f26b8fc` — Set up project: CLAUDE.md, vitest, core dependencies
**브랜치**: `main`

### 완료된 작업
- [x] Next.js 16 프로젝트 생성 (App Router, TypeScript, Tailwind CSS 4)
- [x] 핵심 의존성 설치 (socket.io, node-pty, xterm.js, addon-fit)
- [x] vitest + testing-library 설정 및 smoke test 통과
- [x] CLAUDE.md 작성 (아키텍처, 원칙, 구조 문서화)
- [x] .env.example 추가 (PASSWORD, ALLOWED_IPS, PORT)

### 현재 파일 구조
```
web-screen/
├── CLAUDE.md
├── .env.example
├── package.json
├── vitest.config.ts
├── tsconfig.json
├── next.config.ts
├── eslint.config.mjs
├── postcss.config.mjs
├── src/
│   ├── __tests__/setup.test.ts   # vitest smoke test
│   └── app/
│       ├── layout.tsx            # Next.js 기본 레이아웃
│       ├── page.tsx              # Next.js 기본 페이지 (교체 예정)
│       ├── globals.css
│       └── favicon.ico
└── public/                       # 기본 에셋 (정리 예정)
```

---

## 작업 계획

총 6단계. 각 단계는 독립 브랜치에서 TDD로 진행 → main 머지.

### Phase 1: screen-manager (백엔드 핵심)
**브랜치**: `feat/screen-manager`

screen 세션을 관리하는 순수 로직 모듈.

**구현 파일**:
- `src/lib/screen-manager.ts`
- `src/__tests__/screen-manager.test.ts`

**기능**:
1. `listSessions()` — `screen -ls` 실행 후 파싱하여 세션 목록 반환
   - 반환: `{ name: string, id: string, status: 'attached' | 'detached' }[]`
2. `createSession(name: string)` — `screen -dmS <name>` 으로 새 세션 생성
3. `sessionExists(name: string)` — 세션 존재 여부 확인

**테스트 전략**:
- `screen -ls` 출력 파싱 유닛 테스트 (다양한 출력 형식 커버)
- 실제 screen 명령 실행 통합 테스트 (create → list → exists)
- Mutation test: 파싱 정규식을 깨뜨려서 테스트가 잡는지 확인

---

### Phase 2: auth 미들웨어
**브랜치**: `feat/auth`

IP 제한 + 비밀번호 인증.

**구현 파일**:
- `src/lib/auth.ts`
- `src/__tests__/auth.test.ts`

**기능**:
1. `checkIP(ip: string)` — ALLOWED_IPS 환경변수 기반 IP 허용 체크
2. `verifyPassword(input: string)` — PASSWORD 환경변수와 비교
3. `validateSession(cookie: string)` — 쿠키 기반 세션 검증
4. 쿠키 생성/검증 (단순 토큰, httpOnly)

**테스트 전략**:
- 허용/차단 IP 케이스
- 올바른/잘못된 비밀번호
- 유효/만료/변조 쿠키
- Mutation test: IP 체크 조건을 반전시켜 테스트가 잡는지 확인

---

### Phase 3: Custom Server + Socket Handler
**브랜치**: `feat/server`

Next.js Custom Server에 Socket.io를 올리고 PTY 연결.

**구현 파일**:
- `server.ts` (프로젝트 루트)
- `src/lib/socket-handler.ts`
- `src/__tests__/socket-handler.test.ts`

**기능**:
1. `server.ts` — HTTP 서버 생성, Next.js + Socket.io attach
2. Socket.io 연결 시 auth 미들웨어 적용
3. `terminal:attach` — screen 세션에 node-pty로 연결 (`screen -x <session>`)
4. `terminal:input` — PTY에 입력 전달
5. `terminal:output` — PTY 출력을 클라이언트로 전송
6. `terminal:resize` — PTY 크기 변경
7. 연결 해제 시 PTY 정리 (screen 세션은 유지)

**테스트 전략**:
- socket-handler 유닛: mock PTY로 이벤트 흐름 검증
- 통합 테스트: 실제 Socket.io 클라이언트로 연결 → 입출력 확인
- Mutation test: disconnect 시 PTY kill을 제거해서 리소스 누수 감지 테스트

**package.json 스크립트 변경**:
```json
"dev": "ts-node --esm server.ts"
"start": "node dist/server.js"
```

---

### Phase 4: 로그인 페이지
**브랜치**: `feat/login-page`

비밀번호 입력 UI + API Route.

**구현 파일**:
- `src/app/login/page.tsx`
- `src/app/api/auth/route.ts`
- `src/__tests__/login.test.ts`

**기능**:
1. 비밀번호 입력 폼 (서버 컴포넌트 + 클라이언트 폼)
2. POST `/api/auth` — 비밀번호 확인 → 쿠키 설정 → 리다이렉트
3. 미인증 시 `/login`으로 리다이렉트 (middleware.ts)

**테스트 전략**:
- API Route 유닛: 올바른/잘못된 비밀번호 응답 확인
- 컴포넌트 렌더링: 폼 존재 확인
- Mutation test: 쿠키 설정을 제거해서 로그인 후에도 미인증 상태인지 확인

---

### Phase 5: 세션 목록 페이지 (메인)
**브랜치**: `feat/session-list`

screen 세션 목록 표시 + 새 세션 생성.

**구현 파일**:
- `src/app/page.tsx` (기존 파일 교체)
- `src/app/api/sessions/route.ts`
- `src/__tests__/session-list.test.ts`

**기능**:
1. GET `/api/sessions` — screen-manager.listSessions() 호출 → JSON 반환
2. POST `/api/sessions` — screen-manager.createSession() 호출
3. 메인 페이지: 세션 목록 테이블 + "새 세션" 버튼
4. 세션 클릭 시 `/terminal/[session]`으로 이동

**테스트 전략**:
- API Route: 목록 반환 / 세션 생성 응답 검증
- 컴포넌트: 세션 목록 렌더링, 빈 목록 상태
- Mutation test: createSession 호출을 제거해서 버튼 클릭 후 세션 미생성 확인

---

### Phase 6: 터미널 페이지
**브랜치**: `feat/terminal-page`

xterm.js로 screen 세션에 연결하는 터미널 뷰.

**구현 파일**:
- `src/components/Terminal.tsx`
- `src/app/terminal/[session]/page.tsx`
- `src/__tests__/terminal.test.ts`

**기능**:
1. `Terminal.tsx` — xterm.js 초기화, FitAddon, Socket.io 연결
   - 마운트 시 `terminal:attach` 이벤트로 세션 연결
   - `onData` → `terminal:input` 전송
   - `terminal:output` 수신 → `term.write()`
   - 리사이즈 감지 → `terminal:resize` 전송
2. `[session]/page.tsx` — URL 파라미터에서 세션명 추출 → Terminal 컴포넌트 렌더링
3. 새로고침 시 동일 세션 자동 재연결

**테스트 전략**:
- Terminal 컴포넌트: mount/unmount 시 소켓 연결/해제 확인 (mock socket)
- 페이지: URL 파라미터 → Terminal에 올바른 세션명 전달
- E2E 수동 테스트: 브라우저에서 실제 타이핑 → 출력 확인 → 새로고침 → 세션 유지
- Mutation test: attach 이벤트에서 세션명을 빈 문자열로 바꿔서 연결 실패 테스트

---

## 작업 흐름 (매 Phase 공통)

```
1. git checkout -b feat/<name>
2. 테스트 코드 작성 (RED)
3. 최소 구현 (GREEN)
4. 수동 mutation test (테스트 품질 검증)
5. 리팩터 (필요 시)
6. 커밋
7. git checkout main && git merge feat/<name>
```

## 우선순위 의존관계

```
Phase 1 (screen-manager)
    ↓
Phase 2 (auth)          ← 독립, Phase 1과 병렬 가능하나 순서대로 진행
    ↓
Phase 3 (server + socket) ← Phase 1, 2 필요
    ↓
Phase 4 (login page)     ← Phase 2, 3 필요
    ↓
Phase 5 (session list)   ← Phase 1, 3 필요
    ↓
Phase 6 (terminal page)  ← Phase 3, 5 필요
```
