/**
 * PC 실제 원문 파일 검증 CLI (네트워크 없음). 운영 선별 목록(CURATED_PAGES)과 운영 파서·검증·번역 사전을 그대로 사용합니다.
 * 사용: npx tsx server/ceo/testing/parseLocalPages.ts <파일1> … <파일7>
 *   ceo7: 7곳(Google Q2 2026 추가). 보류(hold) Tesla 2곳도 이미 저장한 파일로 파서만 검사합니다(운영 요청은 0).
 *   Google Q2 2026은 정적 검토 번역이 없으므로 번역 기대값 = missing(새 정적 번역을 만들지 않음).
 *   인자 순서 = CURATED_PAGES 순서(아래 usage 출력). 각 URL을 한 번씩 받아 저장한 HTML 파일을 넘깁니다.
 *   원문 본문은 출력하지 않고 결과·해시·짧은 근거(작성자·날짜·연결 문구, 각 120자 이하)·사유만 출력합니다.
 * 판정: 모든 곳 인용 1건 확인 + 기대 날짜 종류(작성일/게시일/발언일)가 확인 + 번역 기대값(기존 6곳 reviewed·Q2 missing)이면 종료 코드 0.
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import { CURATED_PAGES, extractPageQuotes, pageArticle, pageScope } from '../officialPages';
import { CURATED_TRANSCRIPTS } from '../transcripts';
import { htmlToText } from '../htmlText';
import { ceoUrlHash } from '../urlHash';
import { createCompositeExtractor } from '../runtime';
import { buildCeoDataset, emptyCeoCache, refreshCeoCache } from '../pipeline';
import { CEO_PERSONS, CEO_ROLES, CEO_TOPICS } from '../registry';
import { translationFor } from '../translations';
import { normalizeForMatch } from '../../../src/ceo/text';

const files = process.argv.slice(2);
if (files.length !== CURATED_PAGES.length) {
  console.error(`usage: parseLocalPages ${CURATED_PAGES.map(p => `<${p.sourceId}: ${p.url}>`).join(' ')}`);
  process.exit(2);
}
const short = (s: string | undefined | null) => (s ? s.slice(0, 120) : s);

(async () => {
  let failed = 0;
  const ex = createCompositeExtractor(CEO_PERSONS, CURATED_TRANSCRIPTS, CURATED_PAGES);
  for (const [i, p] of CURATED_PAGES.entries()) {
    const raw = fs.readFileSync(files[i]);
    const text = htmlToText(raw.toString('utf8'));
    const sc = pageScope(text, p);
    const r = extractPageQuotes(p, text);
    const art = pageArticle(p, text);
    let st: any = null;
    if (art) {
      const a = { ...art, articleId: ceoUrlHash(p.url) };
      const { cache } = await refreshCeoCache([a], emptyCeoCache(), ex);
      const built = await buildCeoDataset([a], cache, { persons: CEO_PERSONS, roles: CEO_ROLES, topics: CEO_TOPICS }, { extractor: ex });
      st = built.dataset.statements[0] || null;
    }
    const tr = st ? translationFor(st) : undefined;
    const expectTr = p.sourceId === 'googl-q2-2026-remarks' ? 'missing' : 'reviewed';
    const expectSpoken = p.kind === 'call_remarks';
    const ok = r.items.length === 1 && !!st && !!art?.publishedAt
      && (expectSpoken ? st.spokenAt.value === p.date : st.spokenAt.precision === 'unknown')
      && tr?.status === expectTr;
    if (!ok) failed++;
    console.log(JSON.stringify({
      sourceId: p.sourceId, kind: p.kind, ok, held: p.hold ? `운영 요청 0 (${p.hold.since})` : null,
      rawBytes: raw.length, rawSha256: crypto.createHash('sha256').update(raw).digest('hex'),
      titleFound: !!sc, scopeChars: sc?.body.length ?? 0,
      scopeSha256: art ? crypto.createHash('sha256').update(normalizeForMatch(art.body)).digest('hex') : null,
      publishedAt: art?.publishedAt ?? null, publishedBasis: short(art?.publishedAtBasis?.excerpt),
      verified: r.items.map(x => ({ quote: x.quoteText, spokenAt: x.spokenAt.value, provenance: (x.provenance || []).map(v => `${v.label}: ${short(v.excerpt)}`) })),
      rejected: r.rejected,
      statement: st ? { personId: st.personId, role: st.roleTitleAtTime, roleStatus: st.roleStatusAtTime, roleNote: st.roleNoteAtTime ?? null, roleDateBasis: st.roleDateBasis ?? 'spoken' } : null,
      translation: tr ? { status: tr.status, sourceHash: tr.sourceHash } : null,
    }, null, 2));
  }
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
