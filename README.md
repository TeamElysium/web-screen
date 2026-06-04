# web-screen

`web-screen`은 GNU screen 세션을 웹 브라우저에서 관리하고 접속하기 위한
모바일 친화 웹 터미널입니다.

주 사용 목적은 사용자 PC에서 실행 중인 Claude/Codex 같은 TUI 도구를
스마트폰 브라우저로 비동기 확인하고, 필요할 때 짧게 메시지를 보내는 것입니다.
PC와 스마트폰은 Tailscale 같은 VPN으로 같은 사설 네트워크에 연결되어 있다고
가정합니다.

```
Smartphone Browser
  <-> web-screen (Next.js + Socket.IO)
  <-> node-pty
  <-> GNU screen
  <-> Claude / Codex / shell
```
<table>
  <tr>
    <td width="50%">
      <img src="https://github.com/user-attachments/assets/2a568fa6-bec1-44aa-bda0-ab6296bbb77a" alt="image1" style="height: 400px; width: auto; object-fit: contain; display: block; margin: 0 auto;"/>
    </td>
    <td width="50%">
      <img src="https://github.com/user-attachments/assets/d05420c2-b21a-4f80-983b-dd46f80ef049" alt="image2" style="height: 400px; width: auto; object-fit: contain; display: block; margin: 0 auto;"/>
    </td>
  </tr>
</table>

## 주요 기능

- 브라우저에서 screen 세션 목록 확인, 생성, 삭제
- xterm.js 기반 터미널 접속
- 브라우저를 닫거나 연결이 끊겨도 screen 세션 유지
- 모바일 입력 보조 키 제공: Ctrl, Shift, Alt, Tab, Esc, Enter, 방향키
- 폰트 크기 조절, 스크롤, 버퍼 선택 모드
- HTTP 요청과 Socket.IO 연결 모두 IP allowlist로 차단

## 사용 시나리오

1. PC와 스마트폰을 Tailscale 같은 VPN에 연결합니다.
2. 스마트폰의 VPN IP를 `ALLOWED_IPS`에 넣어 PC에서 `web-screen`을 실행합니다.
3. 스마트폰 브라우저에서 `http://<PC의 VPN IP>:3000`에 접속합니다.
4. 세션을 만들거나 기존 screen 세션에 접속합니다.
5. 세션 안에서 `claude`, `codex` 같은 TUI를 실행합니다.
6. 이동 중에는 브라우저를 다시 열어 진행 상황을 확인하고, 필요할 때 입력합니다.

브라우저 연결은 screen에 attach하는 역할만 합니다. 브라우저를 닫으면 서버가
screen에서 detach하고, 세션과 그 안의 프로세스는 계속 실행됩니다.

## 설치

필요한 것:

- Node.js와 npm
- GNU screen
- 스마트폰 접속용 VPN, 예: Tailscale
- Claude/Codex를 사용할 경우 해당 CLI가 PC에 설치되어 있어야 함

Ubuntu:

```bash
sudo apt install screen
npm install
```

macOS:

```bash
screen -version
npm install
```

macOS에서 `screen`이 없거나 다른 버전이 필요하면 Homebrew 등으로 설치합니다.

## 실행

개발 중 로컬 확인:

```bash
ALLOWED_IPS=127.0.0.1 npm run dev
```

Tailscale 같은 VPN을 통한 스마트폰 접속처럼 실제로 사용할 때는 프로덕션
빌드로 실행하는 것을 권장합니다.

```bash
# PC의 VPN IP 확인: 스마트폰 브라우저에서 접속할 주소에 사용
tailscale ip -4

# 한 번 빌드한다.
npm run build

# 스마트폰의 VPN IP를 허용한다.
# 로컬 브라우저 테스트가 필요하면 127.0.0.1도 같이 추가한다.
ALLOWED_IPS=127.0.0.1,<PHONE_VPN_IP> npm run start
```

스마트폰에서는 다음 주소로 접속합니다.

```text
http://<PC의 VPN IP>:3000
```

`server.ts`는 기본적으로 `PORT=3000`을 사용합니다. 다른 포트를 쓰려면:

```bash
PORT=4000 ALLOWED_IPS=127.0.0.1,<PHONE_VPN_IP> npm run start
```

`.env` 파일을 사용할 수도 있습니다.

```env
PORT=3000
ALLOWED_IPS=127.0.0.1,<PHONE_VPN_IP>
```

## 세션 사용

웹 UI에서 `+ Session`을 눌러 새 screen 세션을 만들 수 있습니다. 세션 이름은
영문, 숫자, 하이픈, 밑줄만 허용됩니다.

이미 터미널에서 만든 screen 세션도 목록에 나타납니다.

```bash
screen -S claude
claude
# detach: Ctrl-a, d
```

이후 스마트폰 브라우저에서 `claude` 세션에 접속하면 같은 TUI를 이어서 볼 수
있습니다.

## 보안 모델

이 프로젝트는 VPN 내부 사용을 전제로 합니다.

- 인증은 `ALLOWED_IPS`의 IP allowlist만 사용합니다.
- 비밀번호, 사용자 계정, 세션별 권한, TLS는 제공하지 않습니다.
- `ALLOWED_IPS`가 비어 있거나 설정되지 않으면 모든 요청을 차단합니다.
- allowlist는 정확한 IP 문자열 매칭입니다. CIDR/range 매칭은 지원하지 않습니다.
- HTTP와 Socket.IO 연결 모두 같은 allowlist 검사를 통과해야 합니다.
- 신뢰할 수 있는 reverse proxy 뒤에서만 `TRUST_PROXY=true`를 사용하세요.
  이 경우 `x-real-ip` 또는 `x-forwarded-for`를 클라이언트 IP로 사용합니다.

인터넷에 직접 노출하지 않는 것을 권장합니다. Tailscale 같은 VPN의 사설 IP만
허용하는 방식으로 사용하는 것이 이 프로젝트의 기본 보안 전제입니다.

## 테스트된 환경과 알려진 이슈

- macOS와 Ubuntu에서 Claude/Codex TUI 접속을 테스트했습니다.
- Claude는 일반적인 확인/입력 흐름에서 동작했습니다.
- Codex는 일부 화면에서 글자 업데이트가 약간 잘못 보이는 버그가 있습니다.
  입력 자체보다 화면의 부분 redraw가 어긋나는 유형의 문제입니다.

## 테스트 주의사항

테스트는 실제 터미널 입력, screen 세션 생성, screen 세션 삭제를 수행할 수
있습니다. Claude/Codex 등 실제 작업이 진행 중인 컴퓨터에서는 테스트 실행이나
테스트를 동반한 수정 작업을 하지 마세요.

## 개발 명령

```bash
npm run dev          # 개발 서버: Next.js + Socket.IO custom server
npm run build        # 프로덕션 빌드
npm run start        # 프로덕션 서버
npm run test         # vitest 실행 후 next build
npm run test:watch   # vitest watch 모드
npm run lint         # ESLint
```

## 프로젝트 구조

```text
server.ts                    # HTTP + Socket.IO custom server
src/app/page.tsx             # 세션 목록, 생성, 삭제
src/app/terminal/[session]   # 터미널 뷰
src/lib/screen-manager.ts    # GNU screen 세션 관리
src/lib/socket-handler.ts    # 터미널 attach/input/resize/detach 처리
src/lib/terminal-client.ts   # xterm.js 클라이언트 연결
src/lib/auth.ts              # IP allowlist 검사
```
