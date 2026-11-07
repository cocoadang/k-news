/**
 * PDF → 문단 텍스트 (서버 전용, 모델 호출 없음). pdfjs-dist(legacy, Node용)로 글자 위치를 읽어
 * 줄을 만들고, 줄 간격이 평소보다 크게 벌어지면 문단을 나눕니다. 페이지 사이에는 빈 줄을 둡니다.
 */
// esbuild(cjs 번들)가 import()를 require로 바꾸지 않게 실제 동적 import 사용 (pdfjs는 ESM 전용)
const dynamicImport = new Function('s', 'return import(s)') as (s: string) => Promise<any>;

export interface PdfTextOptions { maxPages?: number }

type Item = { str: string; x: number; y: number; h: number; eol: boolean };

/** 한 페이지의 글자 조각들을 문단 문자열 배열로 */
export function itemsToParagraphs(items: Item[]): string[] {
  const rows: { y: number; h: number; parts: { x: number; s: string }[] }[] = [];
  for (const it of items) {
    if (!it.str) continue;
    const row = rows.find(r => Math.abs(r.y - it.y) <= Math.max(1.5, it.h * 0.3));
    if (row) row.parts.push({ x: it.x, s: it.str }); else rows.push({ y: it.y, h: it.h || 10, parts: [{ x: it.x, s: it.str }] });
  }
  rows.sort((a, b) => b.y - a.y); // PDF 좌표는 아래에서 위로
  const lines = rows.map(r => ({ y: r.y, h: r.h, text: r.parts.sort((a, b) => a.x - b.x).map(p => p.s).join('').replace(/\s+/g, ' ').trim() })).filter(l => l.text);
  const gaps = lines.slice(1).map((l, i) => lines[i].y - l.y).filter(g => g > 0).sort((a, b) => a - b);
  const typical = gaps.length ? gaps[Math.floor((gaps.length - 1) / 4)] : 12; // 하위 25% = 보통 줄 간격
  const paras: string[] = [];
  let cur: string[] = [];
  lines.forEach((l, i) => {
    const gap = i ? lines[i - 1].y - l.y : 0;
    if (i && (gap > typical * 1.45 || gap < 0)) { if (cur.length) paras.push(cur.join(' ')); cur = []; }
    cur.push(l.text);
  });
  if (cur.length) paras.push(cur.join(' '));
  // 줄 끝 하이픈으로 나뉜 단어 잇기
  return paras.map(p => p.replace(/(\w)- (\w)/g, '$1$2').replace(/\s+/g, ' ').trim()).filter(Boolean);
}

export async function pdfToText(bytes: Uint8Array, opts: PdfTextOptions = {}): Promise<string> {
  const pdfjs = await dynamicImport('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: bytes, isEvalSupported: false, disableFontFace: true, useSystemFonts: false, verbosity: 0 }).promise;
  try {
    const pages: string[] = [];
    const n = Math.min(doc.numPages, opts.maxPages ?? 80);
    for (let i = 1; i <= n; i++) {
      const page = await doc.getPage(i);
      const tc = await page.getTextContent();
      const items: Item[] = tc.items.filter((x: any) => typeof x.str === 'string').map((x: any) => ({ str: x.str, x: x.transform[4], y: x.transform[5], h: Math.abs(x.height || x.transform[3] || 10), eol: !!x.hasEOL }));
      pages.push(itemsToParagraphs(items).join('\n'));
      page.cleanup();
    }
    return pages.join('\n\n');
  } finally { await doc.destroy(); }
}
