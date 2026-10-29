/**
 * PC 실제 SEC 원문 파일 검증 CLI (네트워크 없음, 이미지도 읽지 않음). 운영 고정 항목(CURATED_SEC_EXHIBITS)과 운영 검증 함수를 그대로 사용합니다.
 * 사용: npx tsx server/ceo/testing/parseLocalSec.ts <fwp_cfointerview.htm> <eu_interviewtranscript06.htm>
 *   인자 순서 = CURATED_SEC_EXHIBITS 순서. PC가 이미 받은 원본 파일 그대로(다시 받지 않음).
 * 출력(원문 전체는 출력하지 않음): 크기·SHA256·엄격 UTF-8·바이트 단계 결과·구조 단계 결과·보류 사유.
 *   --anchors: PC가 고정 문자열을 확인·전달할 수 있게 짧은 구간만 추가 출력
 *     (인용 페이지 화자 표기 목록, 인용 앞 400자, 도입 페이지에서 연도가 든 줄(각 160자), Exhibit B 시작 페이지 앞 400자).
 *     출력은 OCR 텍스트층 그대로이며 오자가 있을 수 있음 — 반드시 이미지와 대조한 뒤 고정 문자열로 전달.
 * 판정: pcConfirmed와 무관하게 검증 함수만 실행. 두 문서 모두 인용 1건이면 종료 코드 0.
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import { CURATED_SEC_EXHIBITS, extractSecQuotes, PC_TODO, secArticle, secPages, secReady } from '../secExhibits';
import { CURATED_PAGES } from '../officialPages';
import { CURATED_TRANSCRIPTS } from '../transcripts';
import { ceoUrlHash } from '../urlHash';
import { createCompositeExtractor } from '../runtime';
import { buildCeoDataset, emptyCeoCache, refreshCeoCache } from '../pipeline';
import { CEO_PERSONS, CEO_ROLES, CEO_TOPICS } from '../registry';

const args = process.argv.slice(2);
const anchors = args.includes('--anchors');
const files = args.filter(a => a !== '--anchors');
if (files.length !== CURATED_SEC_EXHIBITS.length) {
  console.error(`usage: parseLocalSec [--anchors] ${CURATED_SEC_EXHIBITS.map(e => `<${e.secId}: ${e.url}>`).join(' ')}`);
  process.exit(2);
}
const cut = (s: string, n: number) => s.replace(/\s+/g, ' ').trim().slice(0, n);

(async () => {
  let failed = 0;
  for (const [i, e] of CURATED_SEC_EXHIBITS.entries()) {
    const raw = new Uint8Array(fs.readFileSync(files[i]));
    const sha = crypto.createHash('sha256').update(raw).digest('hex');
    let utf8 = true; try { new TextDecoder('utf-8', { fatal: true }).decode(raw); } catch { utf8 = false; }
    const r = secArticle(e, raw);
    let items: any[] = []; let rejected: any[] = []; let st: any = null;
    if (r.ok) {
      const x = extractSecQuotes(e, r.article.body); items = x.items; rejected = x.rejected;
      const a = { ...r.article, articleId: ceoUrlHash(e.url) };
      const ex = createCompositeExtractor(CEO_PERSONS, CURATED_TRANSCRIPTS, CURATED_PAGES, [e]);
      const { cache } = await refreshCeoCache([a], emptyCeoCache(), ex);
      st = (await buildCeoDataset([a], cache, { persons: CEO_PERSONS, roles: CEO_ROLES, topics: CEO_TOPICS }, { extractor: ex })).dataset.statements[0] || null;
    }
    const ok = r.ok && items.length === 1 && !!st;
    if (!ok) failed++;
    const out: any = {
      secId: e.secId, ok, productionReady: secReady(e), unconfirmedFields: Object.entries(e).filter(([, v]) => JSON.stringify(v).includes(PC_TODO)).map(([k]) => k),
      rawBytes: raw.byteLength, expectedBytes: e.rawBytes, rawSha256: sha, shaMatch: sha === e.rawSha256, strictUtf8: utf8,
      byteStage: r.ok === false ? r.reason : 'ok', rejected,
      statement: st ? { personId: st.personId, companyId: st.companyId, role: st.roleTitleAtTime, roleStatus: st.roleStatusAtTime, spokenAt: st.spokenAt.value,
        quote: st.quoteText, context: st.context?.sources?.[0]?.excerpt ?? null, provenance: (st.provenance || []).map((v: any) => `${v.label}: ${cut(v.excerpt, 120)}`) } : null,
    };
    if (anchors && utf8) {
      const pages = secPages(new TextDecoder('utf-8').decode(raw));
      const pg = (f: string) => pages.find(p => p.file === f.toLowerCase())?.text ?? '';
      const qp = pg(e.quoteImage); const qi = qp.replace(/[‘’]/g, "'").indexOf(e.quote.replace(/[‘’]/g, "'"));
      out.anchors = {
        imagesInOrder: pages.map(p => p.file).filter(Boolean).filter(f => [e.introImage, e.exhibitStartImage, e.quoteImage].includes(f)),
        quotePageLabels: [...qp.matchAll(/(^|[\s"“])([A-Z][A-Za-z.'’\-]*(?:[ \t]+[A-Z][A-Za-z.'’\-]*){0,3})[ \t]*:/g)].map(m => m[2]),
        quoteFoundOnQuotePage: qi >= 0, beforeQuote400: qi >= 0 ? qp.slice(Math.max(0, qi - 400), qi) : null,
        introLinesWithYear: pg(e.introImage).split('\n').filter(l => /20\d\d/.test(l)).map(l => cut(l, 160)),
        exhibitStartHead400: cut(pg(e.exhibitStartImage), 400),
      };
    }
    console.log(JSON.stringify(out, null, 2));
  }
  process.exit(failed ? 1 : 0);
})().catch(err => { console.error(err); process.exit(1); });
