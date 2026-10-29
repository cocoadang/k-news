# K-news

Private source snapshot corresponding to production revision `00034-vsp` (2026-10-29), with export-only sanitization. The eight files in the deployment patch manifest match the verified local source. This is not a claim that AI Studio editor contents match production.

## Local development
Node.js 22; `npm install`, `npm run dev`. Configure your own local environment and replace Firebase configuration placeholders first. Never use production credentials for local tests. Starting the application can connect configured services; use isolated test settings.

Checks: `npm run lint`, `npm run build`, `npm run test:wallstreet`. Some source-review regressions requiring private local transcripts/results were intentionally omitted. CEO candidate checks: `node --test candidates/ceo-timeline/*.test.mjs`.

## Undeployed candidate
`candidates/ceo-timeline/` is separate from the app entry point. It adds question-based chronology and two-record comparison. The candidate is preserved for reference. Its integrated version is in src/components/ceo/timeline and is type-checked and built; production deployment is pending Cloud Shell authentication. No production data snapshot or local preview bundle is included.

No GitHub Actions, deployment hooks/configuration, credentials, operational ledgers, transcripts, actual summary datasets or generated build output are included. Pushing this snapshot is not a deployment request.
