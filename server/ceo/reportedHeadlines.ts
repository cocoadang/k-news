/**
 * 공식 원문을 보완하는 '언론 보도' 자료. K-news가 이미 수집한 기사에서 CEO 발언을 보도한 부분만 고릅니다.
 * - 수집 기사는 헤드라인과 짧은 요약(snippet)만 저장하고 본문은 저장하지 않습니다. 그래서
 *   (1) 헤드라인에 'CEO가 말했다'가 명시된 경우, (2) 요약문 안에 CEO 이름과 따옴표 인용이 함께 있는 경우만 씁니다.
 * - 직접 인용(공식 원문)이 아닙니다. kind='reported_headline' | 'reported_excerpt'로 구분해 화면에 표시합니다.
 * - 모델 호출·외부 요청·DB 쓰기 없음. 조회 응답을 만들 때 계산만 합니다.
 * - 같은 헤드라인이 여러 매체에 실리면 하나로 묶고 가장 이른 보도일을 씁니다.
 */
import crypto from 'node:crypto';

export interface HeadlineEvent {
  id?: string;
  sourceTier?: string;
  primarySource?: { name?: string; url?: string; title?: string; publishedAt?: string; snippet?: string };
}

const VERBS = '(?:says|said|confirms|hints|warns|predicts|expects|tells|told|claims|admits|reveals|calls|sees|touts|insists|vows|urges|argues)';
const KO_VERBS = '(?:말했|밝혔|밝혀|강조|언급|예고|전망|자신|경고|발언|답했|"|“|‘)';

interface Speaker { personId: string; names: string; koNames: string; company: (text: string) => string | null }

const TESLA = /\b(?:Tesla|Optimus|Cybercab|Robotaxi|FSD|Full Self-Driving|Megapacks?|Cybertruck)\b|테슬라|로보택시|옵티머스/i;
const SPACEX = /\b(?:SpaceX|Starship|Starlink|Starshield|xAI|Grok)\b|스페이스X|스타링크|스타십/i;

export const SPEAKERS: Speaker[] = [
  { personId: 'elon-musk', names: '(?:Elon\\s+)?Musk', koNames: '(?:일론\\s*)?머스크', company: t => (TESLA.test(t) ? 'tsla' : SPACEX.test(t) ? 'spacex' : null) },
  { personId: 'jensen-huang', names: '(?:Jensen\\s+)?Huang', koNames: '젠슨\\s*황', company: t => (/\bNvidia\b|엔비디아|\bJensen\b|젠슨/i.test(t) ? 'nvda' : null) },
  { personId: 'satya-nadella', names: '(?:Satya\\s+)?Nadella', koNames: '(?:사티아\\s*)?나델라', company: () => 'msft' },
  { personId: 'sundar-pichai', names: '(?:Sundar\\s+)?Pichai', koNames: '(?:순다르\\s*)?피차이', company: () => 'googl' },
];

const attribution = (sp: Speaker) => new RegExp(
  `\\b${sp.names}\\s+${VERBS}\\b|\\b${sp.names}:\\s|\\b(?:says|said)(?:\\s+CEO)?\\s+${sp.names}\\b|\\bas\\s+${sp.names}\\s+${VERBS}\\b|${sp.koNames}[^.]{0,12}${KO_VERBS}`, 'i');
// "After Musk said ..."처럼 다른 사람의 반응을 다룬 기사는 제외
const REACTION = /\b(?:after|when|since)\s+(?:Elon\s+|Jensen\s+|Satya\s+|Sundar\s+)?(?:Musk|Huang|Nadella|Pichai)\s+(?:said|says)\b/i;
const BLOCKED_TIERS = new Set(['blocked', 'spam']);

/** "Title - Outlet" 꼬리를 떼고 공백을 정리 */
export function cleanHeadline(title: string): string {
  return String(title || '').replace(/\s+[-–—]\s+[^-–—]{2,60}$/, '').replace(/\s+/g, ' ').trim();
}
const key = (t: string) => cleanHeadline(t).toLowerCase().replace(/[’']/g, "'").replace(/[^a-z0-9가-힣' ]+/g, ' ').replace(/\s+/g, ' ').trim();

/** 요약문에서 화자 이름 근처(앞뒤 120자)의 따옴표 인용 하나 */
function snippetQuote(snippet: string, title: string, sp: Speaker): string | null {
  const s = String(snippet || '').replace(/\s+/g, ' ').trim();
  if (!s || key(s).startsWith(key(title))) return null; // 헤드라인만 반복된 요약은 본문 정보가 아님
  const name = new RegExp(`\\b${sp.names}\\b|${sp.koNames}`, 'i');
  const m = name.exec(s);
  if (!m) return null;
  const window = s.slice(Math.max(0, m.index - 120), m.index + 240);
  const q = /[“"]([^”"]{25,300})[”"]/.exec(window);
  return q ? q[1].trim() : null;
}

export function reportedCeoStatements(events: HeadlineEvent[], { limitPerScope = 40 } = {}) {
  type G = { personId: string; companyId: string; kind: 'reported_headline' | 'reported_excerpt'; text: string; context?: string; date: string; sources: { name: string; url: string; publishedAt: string }[] };
  const groups = new Map<string, G>();
  for (const e of events || []) {
    const ps = e.primarySource;
    const title = cleanHeadline(ps?.title || '');
    const at = ps?.publishedAt && !Number.isNaN(Date.parse(ps.publishedAt)) ? new Date(ps.publishedAt).toISOString() : null;
    if (!title || !at || !ps?.url || BLOCKED_TIERS.has(String(e.sourceTier || ''))) continue;
    for (const sp of SPEAKERS) {
      const companyId = sp.company(`${title} ${ps.snippet || ''}`);
      if (!companyId) continue;
      let kind: G['kind'] | null = null, text = '', context: string | undefined;
      if (attribution(sp).test(title) && !REACTION.test(title)) { kind = 'reported_headline'; text = title; }
      else { const q = snippetQuote(ps.snippet || '', title, sp); if (q) { kind = 'reported_excerpt'; text = q; context = title; } }
      if (!kind) continue;
      const k = `${sp.personId}|${companyId}|${key(text)}`;
      const g = groups.get(k) || { personId: sp.personId, companyId, kind, text, context, date: at, sources: [] };
      if (at < g.date) g.date = at;
      if (!g.sources.some(s => s.url === ps.url)) g.sources.push({ name: String(ps.name || '언론 보도'), url: ps.url, publishedAt: at });
      groups.set(k, g);
    }
  }
  const perScope = new Map<string, number>();
  return [...groups.values()]
    .sort((a, b) => b.date.localeCompare(a.date))
    .filter(g => { const s = g.personId + '|' + g.companyId, n = perScope.get(s) || 0; perScope.set(s, n + 1); return n < limitPerScope; })
    .map(g => {
      const day = new Date(Date.parse(g.date) + 9 * 3600_000).toISOString().slice(0, 10); // 한국시간
      return {
        statementId: 'rh_' + crypto.createHash('sha256').update(`${g.personId}|${g.companyId}|${key(g.text)}`).digest('hex').slice(0, 16),
        personId: g.personId, companyId: g.companyId, roleTitleAtTime: 'CEO', roleStatusAtTime: 'current',
        topicId: '기타', kind: g.kind, quoteText: g.text, quoteLanguage: /[가-힣]/.test(g.text) ? 'ko' : 'en',
        ...(g.context ? { context: g.context } : {}),
        sourceType: 'news_report',
        referenceDate: { value: day, basis: 'reported', precision: 'day' },
        evidence: g.sources.slice(0, 5).map(s => ({ url: s.url, sourceName: s.name, articlePublishedAt: s.publishedAt, excerpt: g.text })),
        reportedSourceCount: g.sources.length,
        verification: { status: 'not_rechecked' },
        isExample: false,
      };
    });
}

/** 이전 이름 호환 */
export const reportedMuskTeslaStatements = (events: HeadlineEvent[]) => reportedCeoStatements(events).filter(s => s.personId === 'elon-musk' && s.companyId === 'tsla');
