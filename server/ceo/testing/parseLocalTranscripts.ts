/**
 * PC 실제 원문 파일 검증 CLI (네트워크 없음). 운영 선별 목록(CURATED_TRANSCRIPTS)과 운영 파서를 그대로 사용합니다.
 * 사용: npx tsx server/ceo/testing/parseLocalTranscripts.ts <FY25.html> <FY26.html>
 *   인자 순서는 CURATED_TRANSCRIPTS 순서(FY25 Q2, FY26 Q2). 원문 내용은 출력하지 않고 결과·해시·사유만 출력합니다.
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import { CURATED_TRANSCRIPTS, extractCuratedQuotes, speakerSections, transcriptScope } from '../transcripts';
import { htmlToText } from '../htmlText';
import { normalizeForMatch } from '../../../src/ceo/text';

const files = process.argv.slice(2);
if (files.length !== CURATED_TRANSCRIPTS.length) {
  console.error(`usage: parseLocalTranscripts <${CURATED_TRANSCRIPTS.map(t => t.sourceId).join('> <')}>`);
  process.exit(2);
}
let failed = 0;
CURATED_TRANSCRIPTS.forEach((t, i) => {
  const raw = fs.readFileSync(files[i]);
  const text = htmlToText(raw.toString('utf8'));
  const sc = transcriptScope(text, t.transcriptTitle);
  const labels = sc ? speakerSections(sc.scope).map(s => s.label) : [];
  const counts: Record<string, number> = {};
  for (const l of labels) counts[l] = (counts[l] || 0) + 1;
  const r = extractCuratedQuotes(t, text);
  const out = {
    sourceId: t.sourceId,
    rawBytes: raw.length,
    rawSha256: crypto.createHash('sha256').update(raw).digest('hex'),
    titleFound: !!sc,
    scopeChars: sc?.scope.length ?? 0,
    scopeSha256: sc ? crypto.createHash('sha256').update(normalizeForMatch(sc.scope)).digest('hex') : null,
    headerHasEventDate: sc ? normalizeForMatch(sc.header).includes(normalizeForMatch(t.eventDateExcerpt)) : false,
    speakerLabelCounts: counts,
    verified: r.items.map(x => ({ quote: x.quoteText, spokenAt: x.spokenAt.value, excerptChars: x.excerpts[0].length })),
    rejected: r.rejected,
  };
  if (r.rejected.length) failed++;
  console.log(JSON.stringify(out, null, 2));
});
process.exit(failed ? 1 : 0);
