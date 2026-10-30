/**
 * Tesla 공식 사이트가 서버 접속을 막아(HTTP 403) 직접 인용을 모을 수 없을 때 쓰는 보조 자료.
 * K-news가 이미 수집한 기사 중 '머스크가 말했다'고 보도한 테슬라 관련 헤드라인만 골라 '언론 보도'로 표시합니다.
 * - 직접 인용이 아닙니다(kind='reported_headline'). 화면에서 공식 원문과 구분해 표시합니다.
 * - 모델 호출·외부 요청·DB 쓰기 없음. 조회 응답을 만들 때 계산만 합니다.
 * - 같은 헤드라인이 여러 매체에 실리면 하나로 묶고 가장 이른 보도일을 씁니다.
 */
import crypto from 'node:crypto';

export interface HeadlineEvent {
  id?: string;
  sourceTier?: string;
  primarySource?: { name?: string; url?: string; title?: string; publishedAt?: string };
}

// '머스크가 말했다'는 귀속이 헤드라인에 명시된 경우만. "Musk's Tesla claims"처럼 회사 주장은 제외.
const ATTRIBUTION = /\b(?:Elon\s+)?Musk\s+(?:says|said|confirms|hints|warns|predicts|expects|tells|told|claims|admits|reveals|calls)\b|\bMusk:\s|\b(?:says|said)(?:\s+CEO)?(?:\s+Elon)?\s+Musk\b|\bas\s+(?:Elon\s+)?Musk\s+(?:hints|confirms|says|warns)\b/i;
const TESLA = /\b(?:Tesla|Optimus|Cybercab|Robotaxi|FSD|Full Self-Driving|Megapacks?|Cybertruck)\b/i;
const BLOCKED_TIERS = new Set(['blocked', 'spam']);

/** "Title - Outlet" 꼬리를 떼고 공백을 정리 */
export function cleanHeadline(title: string): string {
  return String(title || '').replace(/\s+[-–—]\s+[^-–—]{2,60}$/, '').replace(/\s+/g, ' ').trim();
}

const key = (t: string) => cleanHeadline(t).toLowerCase().replace(/[’']/g, "'").replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim();

export function reportedMuskTeslaStatements(events: HeadlineEvent[], { limit = 60 } = {}) {
  const groups = new Map<string, { title: string; date: string; sources: { name: string; url: string; publishedAt: string; tier?: string }[] }>();
  for (const e of events || []) {
    const ps = e.primarySource;
    const title = cleanHeadline(ps?.title || '');
    const at = ps?.publishedAt && !Number.isNaN(Date.parse(ps.publishedAt)) ? new Date(ps.publishedAt).toISOString() : null;
    if (!title || !at || !ps?.url || BLOCKED_TIERS.has(String(e.sourceTier || ''))) continue;
    if (!ATTRIBUTION.test(title) || !TESLA.test(title)) continue;
    const k = key(title);
    const g = groups.get(k) || { title, date: at, sources: [] };
    if (at < g.date) { g.date = at; g.title = title; }
    if (!g.sources.some(s => s.url === ps.url)) g.sources.push({ name: String(ps.name || '언론 보도'), url: ps.url, publishedAt: at, tier: e.sourceTier });
    groups.set(k, g);
  }
  return [...groups.values()]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, limit)
    .map(g => {
      // 한국시간 날짜 기준
      const day = new Date(Date.parse(g.date) + 9 * 3600_000).toISOString().slice(0, 10);
      return {
        statementId: 'rh_' + crypto.createHash('sha256').update(key(g.title)).digest('hex').slice(0, 16),
        personId: 'elon-musk', companyId: 'tsla', roleTitleAtTime: 'CEO', roleStatusAtTime: 'current',
        topicId: '기타', kind: 'reported_headline', quoteText: g.title, quoteLanguage: 'en',
        sourceType: 'news_headline',
        referenceDate: { value: day, basis: 'reported', precision: 'day' },
        evidence: g.sources.slice(0, 5).map(s => ({ url: s.url, sourceName: s.name, articlePublishedAt: s.publishedAt, excerpt: g.title })),
        reportedSourceCount: g.sources.length,
        verification: { status: 'not_rechecked' },
        isExample: false,
      };
    });
}
