# K-news (미국주식 모니터링)

https://news.dsoom.com 운영 소스. 운영 현황·배포 절차는 HANDOFF.md를 보세요.

## Local development
Node.js 22; `npm install`, `npm run dev`. Configure your own local environment and replace Firebase configuration placeholders first. Never use production credentials for local tests.

Checks: `npm run lint`, `npm run build`, and the test steps in `.github/workflows/deploy.yml` (run automatically on every push and PR).

No credentials, operational ledgers, transcripts, actual summary datasets or generated build output are included. Production deployment runs only via the deploy workflow on main (see HANDOFF.md).

## OpenAI analysis (2026-11-15)
Active text analysis uses OpenAI Responses, `gpt-6-luna`, reasoning none, no tools or automatic retries. `OPENAI_API_KEY` must be bound server-side; `OPENAI_MODEL` optionally overrides the model. Legacy Gemini-named internal fields remain for stored-data/API compatibility; public `aiProvider` and `aiModel` report the actual provider. Existing collection, fact validation, dispatch rules and budget ceilings are preserved. Input reservations include a conservative local UTF-8 bound; output usage includes reasoning once. Gemini keys are retained only for rollback and inactive legacy paths.
