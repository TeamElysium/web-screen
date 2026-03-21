# web-screen

웹 브라우저에서 screen 세션을 관리하고 접속할 수 있는 웹 터미널.
xterm.js + Socket.io + node-pty 기반, Next.js Custom Server로 구동.

## 아키텍처

```
Browser(xterm.js) <-> WebSocket(Socket.io) <-> Custom Server(Node.js) <-> node-pty <-> screen
```

- **Custom Server** (`server.ts`): HTTP(Next.js) + WebSocket(Socket.io) 통합 서버
- **screen-manager**: screen 세션 목록 조회, 생성, attach 관리
- **Frontend**: xterm.js 터미널 렌더링, Socket.io로 I/O 전송

## 개발 원칙

- **KISS**: 최소 구현, 불필요한 추상화 금지
- **E2E TDD**: 테스트 먼저 작성 → 최소 구현 → 리팩터
- **Mutation Testing**: 자동 도구 대신 수동으로 핵심 fail 케이스를 만들어 테스트 품질 검증
- **Unit 단위 브랜치/커밋**: 기능 단위로 브랜치 생성, 완료 시 main에 머지

## 커맨드

```bash
npm run dev          # 개발 서버 (Next.js + Socket.io)
npm run build        # 프로덕션 빌드
npm run start        # 프로덕션 서버
npm run test         # vitest 실행
npm run test:watch   # vitest watch 모드
npm run lint         # ESLint
```

## 기술 스택

- Next.js 16 (App Router, Custom Server)
- TypeScript strict mode
- Socket.io 4 (WebSocket)
- node-pty (PTY 관리)
- xterm.js 5 (터미널 렌더링)
- vitest + @testing-library/react (테스트)
- Tailwind CSS 4

## 프로젝트 구조

```
server.ts                    # Custom server (HTTP + Socket.io)
src/
  app/                       # Next.js App Router pages
    page.tsx                 # 세션 목록 + 새 세션 생성
    terminal/[session]/
      page.tsx               # 터미널 뷰
    login/page.tsx           # 비밀번호 입력
  lib/
    screen-manager.ts        # screen 세션 관리 로직
    socket-handler.ts        # Socket.io 이벤트 핸들링
    auth.ts                  # IP 제한 + 비밀번호 인증
  components/
    Terminal.tsx             # xterm.js 래퍼 (client component)
```

## 인증

- IP 허용 목록: `ALLOWED_IPS` 환경변수
- 비밀번호: `PASSWORD` 환경변수, httpOnly 쿠키 기반
- 개인용이므로 최소 보안

## Socket.io 이벤트

| 이벤트 | 방향 | 데이터 |
|--------|------|--------|
| `terminal:attach` | C->S | `{ session: string }` |
| `terminal:input` | C->S | `string` |
| `terminal:output` | S->C | `string` |
| `terminal:resize` | C->S | `{ cols, rows }` |
| `terminal:exit` | S->C | — |
