# K-news (미국주식 모니터링)

https://news.dsoom.com 운영 소스. 운영 현황·배포 절차는 HANDOFF.md를 보세요.

## 홈 화면에 설치
- Android Chrome 메뉴에서 **앱 설치** 또는 **홈 화면에 추가**를 선택합니다.
- iPhone Safari의 공유 메뉴에서 **홈 화면에 추가**를 선택하고 **웹 앱으로 열기**를 켭니다.

설치 아이콘을 누르면 주소창 없이 시작합니다. 화면과 데이터는 운영 사이트에서 불러옵니다.

## Local development
Node.js 22; `npm install`, `npm run dev`. Configure your own local environment and replace Firebase configuration placeholders first. Never use production credentials for local tests.

Checks: `npm run lint`, `npm run build`, and the test steps in `.github/workflows/deploy.yml` (run automatically on every push and PR).

No credentials, operational ledgers, transcripts, actual summary datasets or generated build output are included. 운영 변경은 `main`의 배포 워크플로를 실행하고 news.dsoom.com에서 확인한 뒤 결과를 보고합니다. 현재 배포 위임 범위는 HANDOFF.md를 확인하세요.

## OpenAI analysis (2026-11-15)
Active text analysis uses OpenAI Responses, `gpt-6-luna`, reasoning none, no tools or automatic retries. `OPENAI_API_KEY` must be bound server-side; `OPENAI_MODEL` optionally overrides the model. Legacy Gemini-named internal fields remain for stored-data/API compatibility; public `aiProvider` and `aiModel` report the actual provider. Existing collection, fact validation, dispatch rules and budget ceilings are preserved. Input reservations include a conservative local UTF-8 bound; output usage includes reasoning once. Gemini keys are retained only for rollback and inactive legacy paths.
