# Handoff

Production baseline: revision 00034-vsp. YouTube uploads API discovery; 09:00/15:00 Asia/Seoul schedule. vidIQ for Wall Street, Supadata native for the other programmes. Existing duplicate exclusions, private-recipient enforcement, quality holds and secret references must be preserved. Gemini caps: $0.02/video, $0.10/day, $2/month. Free-only provider limits remain unchanged. No runtime configuration or DB records are exported.

CEO candidate: original quotations, reviewed translations and AI summaries are separated. Confirmed spoken dates are distinct from publication dates; unknown dates do not imply chronological change. Company/person boundaries and singleton insufficient-history states are tested. Topic matching is a reviewable lexical candidate, not reliable semantic classification. Remaining work: integrate into app, full TypeScript checks, improve topic relevance and provenance/conditions, review UI before deployment. Backfill and model use require separate authorization.

Export changes: Firebase configuration replaced with placeholders; fresh env example; real-data regression tests and private evidence omitted. Runtime code otherwise copied unchanged. Full production test counts cannot be reproduced without excluded private fixtures. Synthetic candidate fixtures are explicitly fictional.


## CEO integration update
Integrated into CeoMenu using existing GET dataset API only. Existing list/source status retained in disclosure. Timeline CSS scoped to prevent other-menu regressions. Empty roles guarded; rule tuple types corrected. Full TypeScript and standard build pass; 116 offline regressions pass (9 CEO, 107 exported Wall Street tests). Desktop two-record comparison and mobile 390px iframe (375px content width, no horizontal overflow) checked using stored snapshot locally; no production data committed.

Deployment pending: Cloud Shell has no active gcloud account. No revision change attempted. Existing Cloud Build trigger state could not be read for the same reason. No automatic deployment has been activated.
Claude account is logged in, but Claude GitHub App is not installed for cocoadang. Only cocoadang/k-news selected in approval screen; installation not submitted. Requests read administration/status/merge queues/metadata and read-write actions/checks/code/discussions/issues/PRs/hooks/workflows. Separate action-time approval required.

Automatic deployment proposal (not enabled): existing K-news service only, main only after type/build/offline tests; keyless federation restricted by repository ID and main ref, dedicated deploy identity, scoped Artifact Registry writer, Cloud Run developer on this service, actAs on runtime identity. Exact existing identities/repository resources must first be read after Cloud authentication. Do not create broad project IAM or service account keys. Stage new revision without traffic, verify Ready and read-only endpoints, then route traffic; failed validation retains prior revision.
Cloud Build default-pool e2-standard-2 published price $0.006/minute with 2,500 promotional free build minutes/billing account/month; allowance and region must be confirmed, storage and Cloud Run charges separate. No budget or billing changes authorized here. Source: https://cloud.google.com/build/pricing . GitHub runner allowance must be checked separately if selected.


## Production verification 2026-10-29
CEO UI deployed as revision 00035-jbl, Ready with 100% traffic. The five deployed UI file hashes match the patch from commit 585c10bf1cc2430e98b7935704a0b7be76c69e09. Runtime env/secret references, service account, concurrency, timeout, command/args, ports/resources match previous revision. Scheduler remains ENABLED, 0 9,15 * * *, Asia/Seoul.
Read-only verification: CEO API 200/58 records, YouTube API 200/4 summaries, news API 200/100 records, anonymous wallstreet status 401. CEO timeline renders on production. No manual collection/model/caption/Telegram run.
Deployment helper initially stopped because service latestReady still pointed to old traffic revision; new no-traffic revision itself was Ready/Retired. No redeploy: compared old/new settings, then promoted the existing ready revision. Both ledgers preserved in Cloud Shell validation folder: ceo-integration-deploy-ledger-v1.json and ceo-integration-traffic-verification.json.
Claude GitHub App installation verified: only cocoadang/k-news selected; Claude access diagnostic passed. No Claude coding session started.
Deployment (updated 2026-10-30): GitHub Actions + keyless WIF deploy is connected (run 40892432713 succeeded; last confirmed revision 00038-wzp; https://news.dsoom.com via Firebase Hosting). Deploy is MANUAL: push/PR to main only runs validation; production deploy runs only via 'Run workflow' (workflow_dispatch) on main, pressed by the owner. ops/deploy.py refuses any other event. AI agents must not trigger workflow_dispatch or merge PRs. Free GitHub plan: no branch protection on this private repo.

## 2026-10-30 (Claude)
Deploy flow now: Claude opens PR → CI validate → owner-approved merge → workflow_dispatch deploy (owner has delegated merge+deploy to Claude in chat; report results after). WIF provider github-main attribute condition: repository_id 1438422736, ref main, event workflow_dispatch.
YouTube: 10/30 Wall Street (KNn5AQQu7ag) and 10/29 crypto (npCgb7sMj_0) were held as summary_failed_or_uncertain (grounded items 4 < 5). Delivery floor now acceptMinimumItems=3 (request still 5-8); one automatic retry within 48h only when all journal calls completed. Failure code stored as r.summaryFailure.
CEO: src/components/ceo/timeline/companyQuestions.mjs holds per-company questions; timeline ordered by spoken > released > written date with basis label. Only 6/63 statements have reviewed Korean translations and 25 have AI titles; remaining show original English. Tesla has 0 statements; xAI has no role yet. Korean backfill needs model cost approval.
Known: server/wallstreet/discoveryError.test.mjs fails locally without full deps (passes in CI). /api/jobs/poll hit a 300s timeout (504) on 10/30 07:00; not yet investigated.
