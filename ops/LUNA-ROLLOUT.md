# YouTube summaries: Luna rollout

This change affects Korean programme summaries only. News and CEO providers remain separate.

Before deploying, register an OpenAI project key as a Google Secret Manager secret and bind it to the existing Cloud Run service as `OPENAI_API_KEY`. The key needs Responses write access. Never put the value in a PR, repository, workflow, command-line argument, chat, or screenshot. Keep the existing Gemini key for the other pipelines. The OpenAI project must have API billing/credits and access to `gpt-6-luna`.

The existing deployment script preserves the service environment and secret references. It does not create this binding. Bind the secret first; retain the existing image while configuring it. Then deploy the reviewed commit using the existing manual main workflow. Do not enable automatic deployment or change service IAM as part of this migration.

The authenticated `/api/admin/wallstreet/status` reports `summaryModel` and a boolean `summaryCredentialReady`; it never returns the key. Verify both before running collection.

The pipeline uses nine-minute windows for broadcasts longer than thirty minutes, one combined semantic/counter-evidence/duplicate review, and at most one source-repair request before review. A normal 45-minute broadcast uses five extraction requests and one review; a short broadcast uses two requests. Rejecting semantic claims holds/omits them rather than adding another model loop. No external search/tool or token-count API is called.

Successful stage results are checkpointed in the existing private state under the same distributed lock. The cache key includes the transcript, title, model, version, exact prompt, schema and output cap. Changed inputs invalidate it. An in-flight/uncertain paid call is never repeated automatically. Previously successful stages are reused on a supervised retry. Transcript cleanup also removes checkpoints after three days. No raw audit output or duplicated context is stored in the new journal.

The existing daily $0.26 and monthly $2 application limits remain, as do per-video reservation ceilings ($0.03 short / $0.05 long). These are reservations, not expected charges. Preflight uses a conservative local byte bound (including schema/overhead); actual completed usage settles the reservation, including reasoning tokens once and the cached-input discount. Missing usage or uncertain outcomes retain the ceiling. API failures and rejections do not automatically restart the entire video. Budget settlement does not rewrite historical Gemini estimates.

SUMMARY_FIX_VERSION 7 permits one attempt for recent previously-held videos. Full re-summary version 3 covers the existing two targets once, using retained captions only. Existing sent summaries change on the web only if more verified points survive; Telegram is not resent. Expired captions are not refetched for this backfill.

Offline validation covers short/long call counts, >3 topics per window, evidence guards, counter-evidence, duplicates, cached resume, unknown outcomes, request shape, billing settlement and retry policy. Real saved-caption quality/cost evaluation is still required after the secret is configured: compare missing news, names/numbers, conditions, duplicate rate, usage and held reasons on representative three broadcasts. Mocks do not establish model quality.

