/**
 * 공식 출처 원문 어댑터 (CEO 모듈 전용, 읽기만).
 * - 대상 피드: 기존 수집기 목록(OFFICIAL_AND_REGULATORY_FEEDS) 중 등록 CEO가 있는 회사의 공식 피드만 (수정·추가 없음)
 * - 대상 기사: 이미 수집된 이벤트의 출처 URL과 일치하는 피드 항목만 (새 기사 수집 아님). 기사 ID는 기존 computeUrlHash
 * - 본문: 피드가 제공하는 전체 본문(content:encoded)만 사용. 기사 페이지를 따로 내려받지 않음
 * - 저장소 쓰기·모델 호출·알림 없음. 피드별 1회 읽기, 크기·건수 상한
 */
import { OFFICIAL_AND_REGULATORY_FEEDS } from '../sources';
import { ceoUrlHash as computeUrlHash } from './urlHash';
import { SourceArticle } from './pipeline';
import { htmlToText, decodeEntities } from './htmlText';
import { createQuoteExtractor } from './quoteExtractor';
import { CEO_PERSONS } from './registry';
import type { RawStatement } from './pipeline';
import type { CeoStatement } from '../../src/ceo/types';
import { extractAbsoluteDates, statementReferenceDate, documentPublishedAt, partialToInterval } from '../../src/ceo/dates';

export interface FeedItem { link: string; title: string; html: string; pubDate: string | null }
export interface EventLike {
  id: string;
  category?: string;
  primarySource?: { url?: string; publishedAt?: string };
  relatedSources?: { url?: string; publishedAt?: string }[];
}

import type { CeoSourceReport } from '../../src/ceo/types';
export type FeedReport = CeoSourceReport;

export interface OfficialSourceDeps {
  /** 피드 원문 텍스트 가져오기 (운영: fetch, 테스트: 고정 XML) */
  fetchText: (url: string) => Promise<string>;
  /** RSS/Atom 파싱 (운영: rss-parser parseString) */
  parseFeed: (xml: string) => Promise<FeedItem[]>;
}

export const SOURCE_LIMITS = { maxFeeds: 3, maxItemsPerFeed: 50, maxBodyChars: 200_000, minBodyChars: 200 };

/** 등록 CEO 회사의 공식 피드 (기존 목록에서 고르기만) */
export function ceoFeeds(companyIds: string[]) {
  return OFFICIAL_AND_REGULATORY_FEEDS
    .filter(f => f.companyId && companyIds.includes(f.companyId) && f.type === 'official_announcement')
    .slice(0, SOURCE_LIMITS.maxFeeds);
}

export async function loadOfficialArticles(
  events: EventLike[], companyIds: string[], deps: OfficialSourceDeps,
): Promise<{ articles: SourceArticle[]; reports: FeedReport[] }> {
  // 기존 이벤트의 출처 URL → 이벤트 (기존 기사 재사용 범위)
  const existing = new Map<string, { eventId: string; category?: string }>();
  for (const e of events) {
    for (const s of [e.primarySource, ...(e.relatedSources || [])]) {
      if (s?.url) existing.set(computeUrlHash(s.url), { eventId: e.id, category: e.category });
    }
  }
  const articles: SourceArticle[] = [];
  const reports: FeedReport[] = [];
  for (const feed of ceoFeeds(companyIds)) {
    const report: FeedReport = { feedName: feed.name, feedUrl: feed.url, ok: false, itemsInFeed: 0, matchedExisting: 0, withBody: 0, kind: 'feed' };
    reports.push(report);
    try {
      const items = (await deps.parseFeed(await deps.fetchText(feed.url))).slice(0, SOURCE_LIMITS.maxItemsPerFeed);
      report.itemsInFeed = items.length;
      for (const it of items) {
        if (!it.link) continue;
        const id = computeUrlHash(it.link);
        const ev = existing.get(id);
        if (!ev) continue;
        report.matchedExisting++;
        const body = htmlToText(it.html || '').slice(0, SOURCE_LIMITS.maxBodyChars);
        if (body.length < SOURCE_LIMITS.minBodyChars) continue;
        report.withBody++;
        const t = it.pubDate ? Date.parse(it.pubDate) : NaN;
        articles.push({
          articleId: id, title: it.title || '', body, sourceName: feed.name, url: it.link,
          publishedAt: Number.isNaN(t) ? null : new Date(t).toISOString(), topicId: ev.category, eventId: ev.eventId, sourceKind: 'feed',
        });
      }
      report.ok = true;
    } catch (e: any) {
      report.error = String(e?.message || e).slice(0, 160);
    }
  }
  return { articles, reports };
}

/** 독립 공식 원문 탐색. 진행 위치만 저장하며 본문 전체·모델 출력은 저장하지 않습니다. */
export interface DiscoveryCandidate { url: string; modified?: string; title?: string; filedAt?: string }
export interface DiscoveryStream { pending: DiscoveryCandidate[]; indexes: string[]; indexChecked?: Record<string, number>; checked: Record<string, { at: number; modified: string; ok: boolean }>; updatedAt: number }
export interface DiscoveryState { version: 1; streams: Record<string, DiscoveryStream>; nextProvider?: number }
export const DISCOVERY_VERSION = '1';
export const DISCOVERY_LIMITS = { articlesPerCompany: 3, indexesPerStream: 2, pendingPerStream: 180, checkedPerStream: 700, quotesPerArticle: 6, seconds: 45 };

export interface DiscoveryProvider { id: string; companyId: string; personId: string; name: string; index: string; mode: 'sitemap' | 'feed' | 'archive'; host: string; articlePath: RegExp }
export const DISCOVERY_PROVIDERS: DiscoveryProvider[] = [
  { id: 'google', companyId: 'googl', personId: 'sundar-pichai', name: 'Google 공식 블로그', index: 'https://blog.google/en-us/sitemap.xml', mode: 'sitemap', host: 'blog.google', articlePath: /\/(?:company-news|inside-google|technology|products)\// },
  { id: 'microsoft', companyId: 'msft', personId: 'satya-nadella', name: 'Microsoft 공식 블로그', index: 'https://blogs.microsoft.com/sitemap_index.xml', mode: 'sitemap', host: 'blogs.microsoft.com', articlePath: /\/blog\/\d{4}\/\d{2}\/\d{2}\// },
  { id: 'nvidia', companyId: 'nvda', personId: 'jensen-huang', name: 'NVIDIA 공식 뉴스룸', index: 'https://nvidianews.nvidia.com/sitemap.xml', mode: 'sitemap', host: 'nvidianews.nvidia.com', articlePath: /^\/news\// },
  { id: 'tesla', companyId: 'tsla', personId: 'elon-musk', name: 'Tesla 공식 IR', index: 'https://ir.tesla.com/press', mode: 'archive', host: 'ir.tesla.com', articlePath: /^\/press-release\// },
  { id: 'tesla-sec', companyId: 'tsla', personId: 'elon-musk', name: 'Tesla 공식 공시 목록', index: 'https://ir.tesla.com/sec-filings', mode: 'archive', host: 'ir.tesla.com', articlePath: /^\/Archives\/edgar\/data\/1318605\// },
  { id: 'spacex-nasa', companyId: 'spacex', personId: 'elon-musk', name: 'NASA 공식 SpaceX 발표', index: 'https://www.nasa.gov/feed/', mode: 'feed', host: 'www.nasa.gov', articlePath: /^\/(?:news-release|missions)\// },
];
export const discoveryAllowedHosts = () => [...new Set(DISCOVERY_PROVIDERS.map(p => p.host))];

function normalizedUrl(value: string, base: string): string | null {
  try { const u = new URL(decodeEntities(value), base); if (u.protocol !== 'https:' || u.username || u.password || u.port) return null; u.hash = ''; return u.href; } catch { return null; }
}
export function discoveryArticleAllowed(p: DiscoveryProvider, url: string): boolean {
  try {
    const u = new URL(url);
    const host = p.id === 'tesla-sec' ? 'www.sec.gov' : p.host;
    return u.protocol === 'https:' && !u.username && !u.password && !u.port && u.hostname === host && p.articlePath.test(u.pathname) && !/\.(?:pdf|jpg|png|zip)$/i.test(u.pathname);
  } catch { return false; }
}
function indexAllowed(p: DiscoveryProvider, value: string): boolean {
  try {
    const u = new URL(value);
    if (u.protocol !== 'https:' || u.hostname !== p.host || u.username || u.password || u.port) return false;
    if (p.mode === 'sitemap') return /sitemap[^/]*\.xml$/.test(u.pathname) && (p.id !== 'google' || u.pathname.startsWith('/en-us/')) && !/(?:author|page)-sitemap/.test(u.pathname);
    if (p.mode === 'archive') return u.pathname === new URL(p.index).pathname && [...u.searchParams.keys()].every(k => ['page', 'items_per_page'].includes(k));
    return u.pathname === '/feed/' && [...u.searchParams.keys()].every(k => k === 'paged');
  } catch { return false; }
}

export function parseDiscoveryIndex(p: DiscoveryProvider, html: string, base: string): { articles: DiscoveryCandidate[]; indexes: string[] } {
  const articles: DiscoveryCandidate[] = [], indexes: string[] = [];
  const add = (value: string, modified?: string) => { const u = normalizedUrl(value, base); if (!u) return; if (discoveryArticleAllowed(p, u)) articles.push({ url: u, modified }); else if (indexAllowed(p, u) && u !== base) indexes.push(u); };
  if (/<(?:sitemapindex|urlset)\b/.test(html)) {
    for (const m of html.matchAll(/<(?:sitemap|url)\b[^>]*>([\s\S]*?)<\/(?:sitemap|url)>/g)) {
      const loc = /<loc>\s*(?:<!\[CDATA\[)?([^<]+)(?:\]\]>)?\s*<\/loc>/.exec(m[1])?.[1];
      if (loc) add(loc, /<lastmod>([^<]+)<\/lastmod>/.exec(m[1])?.[1]);
    }
  } else {
    for (const m of html.matchAll(/\bhref\s*=\s*["']([^"']+)["']/gi)) add(m[1]);
    if (p.id === 'tesla-sec') {
      for (const row of html.match(/<div class="quarterly-disclosures__quarterly-disclosure\b[\s\S]*?(?=<div class="quarterly-disclosures__quarterly-disclosure\b|$)/g) || []) {
        const date = /<time\b[^>]*datetime=["'](\d{4}-\d\d-\d\d)T/.exec(row)?.[1];
        const links = [...row.matchAll(/href=["'](https:\/\/www\.sec\.gov\/[^"']+\.htm(?:l)?)["']/g)].map(m => m[1]);
        if (date && new Set(links).size === 1) for (const a of articles) if (a.url === links[0]) a.filedAt = date;
      }
    }
  }
  return { articles: [...new Map(articles.map(x => [x.url, x])).values()], indexes: [...new Set(indexes)] };
}

const attr = (tag: string, key: string) => new RegExp(`\\b${key}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, 'i').exec(tag)?.[2];
function metaValue(html: string, keys: string[]): string | null {
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) if (keys.includes((attr(tag, 'property') || attr(tag, 'name') || '').toLowerCase())) return decodeEntities(attr(tag, 'content') || '');
  return null;
}
/** lastmod·수정일·수집일은 발행일로 쓰지 않습니다. 게시 메타데이터만 확인합니다. */
export function discoveryPublishedAt(html: string): string | null {
  const dates = new Set<string>();
  const meta = metaValue(html, ['article:published_time', 'datepublished', 'pubdate']);
  const add = (v: unknown) => { if (typeof v !== 'string' || !/^\d{4}-\d\d-\d\d(?:T|$)/.test(v) || !partialToInterval(v.slice(0, 10))) return; if (Number.isFinite(Date.parse(v))) dates.add(v.slice(0, 10)); };
  if (meta) add(meta);
  // NVIDIA 등 공식 뉴스룸의 제목 주변 날짜 단독 요소. 관련 글·분기 종료일은 사용하지 않습니다.
  const headingAt = html.search(/<h1\b/i);
  if (headingAt >= 0) {
    const header = html.slice(Math.max(0, headingAt - 2500), headingAt + 2500);
    for (const m of header.matchAll(/<(?:div|span|time)\b[^>]*class=["'][^"']*\b(?:article-date|uni-article-hero__date|article-meta__date)\b[^"']*["'][^>]*>([^<]{1,120})<\/(?:div|span|time)>/gi)) {
      const ds = extractAbsoluteDates(htmlToText(m[1]));
      if (ds.length === 1 && ds[0].precision === 'day') add(ds[0].value);
    }
  }
  for (const m of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { const visit = (x: any): void => { if (!x || typeof x !== 'object') return; if (Array.isArray(x)) { x.forEach(visit); return; } const types = [x['@type']].flat(); if (types.some(t => /^(?:NewsArticle|Article|BlogPosting)$/.test(t))) add(x.datePublished); if (x['@graph']) visit(x['@graph']); }; visit(JSON.parse(m[1])); } catch { /* 손상된 메타데이터는 사용하지 않음 */ }
  }
  return dates.size === 1 ? `${[...dates][0]}T00:00:00.000Z` : null;
}
export function discoveryTopic(text: string): string {
  if (/robotaxi|self.driv|autonom(?:y|ous)|\bFSD\b/i.test(text)) return '자율주행 / Robotaxi';
  if (/starship|rocket|orbital|spacecraft|astronaut/i.test(text)) return 'Starship / 우주인프라';
  if (/starlink|satellite|telecom/i.test(text)) return 'Starlink / 통신';
  if (/battery|solar|energy|megapack|powerwall/i.test(text)) return '에너지 / 배터리';
  if (/revenue|earnings|profit|margin|quarter|financial/i.test(text)) return '실적 / 재무';
  if (/chip|GPU|Blackwell|Rubin|semiconductor|accelerat/i.test(text)) return 'AI 가속기 / 반도체';
  if (/cloud|data.cent(?:er|re)|infrastructure/i.test(text)) return '클라우드 / 데이터센터';
  if (/\bAI\b|artificial intelligence|model|agent|copilot|gemini/i.test(text)) return 'AI 모델 / Agent';
  if (/investment|capacity|supply.chain|manufactur/i.test(text)) return '공급망 / CAPEX';
  return '기타';
}

export function discoveredArticle(p: DiscoveryProvider, url: string, html: string, now: number, filedAt?: string): SourceArticle | null {
  if (!discoveryArticleAllowed(p, url)) return null;
  // 이미지 전사 속 흰색 OCR 텍스트는 범용 추출에서 제외하고 기존 SEC 전용 검증기에만 맡깁니다.
  if (p.id === 'tesla-sec' && /font-size\s*:\s*1pt|color\s*:\s*(?:white|#fff(?:fff)?)\b/i.test(html) && /<img\b/i.test(html)) return null;
  const title = htmlToText(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1] || metaValue(html, ['og:title']) || (p.id === 'tesla-sec' ? /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] : '') || '');
  const publishedAt = p.id === 'tesla-sec' && filedAt && /^\d{4}-\d\d-\d\d$/.test(filedAt) && partialToInterval(filedAt) ? `${filedAt}T00:00:00.000Z` : discoveryPublishedAt(html);
  if (!title || !publishedAt || Date.parse(publishedAt) > now + 86400000) return null;
  const articleBlocks = [...html.matchAll(/<article\b[^>]*>([\s\S]*?)<\/article>/gi)].map(m => m[1]);
  const mainBlocks = [...html.matchAll(/<main\b[^>]*>([\s\S]*?)<\/main>/gi)].map(m => m[1]);
  const main = [...articleBlocks, ...mainBlocks].find(block => /<h1\b/i.test(block) && htmlToText(block).includes(title)) || html;
  let body = htmlToText(main).slice(0, 90000);
  const at = body.indexOf(title); if (at >= 0) body = body.slice(at);
  const end = body.search(/\n(?:Related (?:posts|stories|articles)|Read (?:more|next)|Media Contacts|About NVIDIA|About Tesla|Tags|Share this (?:post|story))\b/i);
  if (end >= 0) body = body.slice(0, end);
  if (body.length < 150) return null;
  const h1 = html.search(/<h1\b/i);
  const headerDate = h1 >= 0 ? htmlToText(html.slice(Math.max(0, h1 - 2500), h1 + 600)).split('\n').find(line => { const d = extractAbsoluteDates(line); return line.length < 100 && d.length === 1 && d[0].precision === 'day' && d[0].value === publishedAt.slice(0, 10); }) : undefined;
  if (headerDate && !body.includes(headerDate)) body = `${title}\n${headerDate}\n${body.slice(title.length).trimStart()}`;
  if (p.companyId === 'spacex' && !/\bSpaceX\b/.test(body)) return null;
  const person = CEO_PERSONS.find(x => x.personId === p.personId)!;
  const english = person.nameVariants.find(n => /[A-Za-z]/.test(n)) || '';
  const header = body.slice(0, 1200), lines = header.split('\n');
  const escaped = english.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const communication = new RegExp(`^${escaped}, (?:Chairman and CEO|Chief Executive Officer), (?:shared|posted) the (?:below|following) (?:communication|remarks|message)`, 'i');
  const authorMeta = metaValue(html, ['author']);
  const otherNames = CEO_PERSONS.filter(x => x.personId !== p.personId).flatMap(x => x.nameVariants).filter(n => /[A-Za-z]/.test(n));
  let author = lines.find(l => communication.test(l));
  if (!author && authorMeta === english && !otherNames.some(n => header.includes(n))) author = lines.find(l => l.trim() === english);
  // Google 단일 CEO 발언문: 이름·직함 단독 줄과 발언 기록 편집자 주를 모두 확인합니다.
  if (!author && lines.some(l => l.trim() === english) && /CEO of Google and Alphabet/.test(header) && /(?:transcript of (?:his|the) remarks|remarks from today)/i.test(header) && !otherNames.some(n => header.includes(n))) author = lines.find(l => l.trim() === english);
  const dateLine = body.slice(0, 1000).split('\n').find(line => { const ds = extractAbsoluteDates(line); return ds.length === 1 && ds[0].precision === 'day' && ds[0].value === publishedAt.slice(0, 10); });
  return { articleId: computeUrlHash(url), title, body, sourceName: p.name, url, publishedAt, sourceKind: 'discovered', discoveryCompanyId: p.companyId, discoveryPersonId: p.personId,
    ...(dateLine && p.id !== 'tesla-sec' ? { publishedAtBasis: { kind: author ? 'written' as const : 'released' as const, excerpt: dateLine, basis: '공식 원문의 게시 날짜 요소와 날짜 값을 대조' } } : {}),
    ...(author ? { discoveryAuthor: { name: english, excerpt: author } } : {}) };
}

/** 사전에 고정한 문장 대신 귀속이 명확한 여러 인용을 추출하고 회사·주제를 기록별로 지정합니다. */
export async function extractDiscoveredQuotes(a: SourceArticle): Promise<RawStatement[]> {
  const person = CEO_PERSONS.find(p => p.personId === a.discoveryPersonId);
  if (!person || !a.discoveryCompanyId) return [];
  let rows = await createQuoteExtractor([person]).extract(a);
  if (a.discoveryAuthor) {
    const marker = a.body.indexOf(a.discoveryAuthor.excerpt);
    const after = a.body.slice(marker + a.discoveryAuthor.excerpt.length).replace(/^[\s\S]*?(?:Below is (?:an edited |a )?transcript of his remarks\.)/i, '');
    const paragraphs = after.split('\n').map(x => x.trim()).filter(x => x.length >= 90 && x.length <= 650 && !/[“”"]|\b(?:said|says|told|wrote|according to)\b/i.test(x) && !/^(?:[A-Z ]{3,}:|Related|Share|Read more|Listen|Watch|Image|Photo)/.test(x));
    const englishNames = CEO_PERSONS.filter(p => p.personId !== person.personId).flatMap(p => p.nameVariants).filter(n => /[A-Za-z]/.test(n));
    if (!englishNames.some(n => after.includes(n)) && !/\n[A-Z][A-Z ]{3,}(?: MESSAGE|:)/.test(after)) {
      const name = a.discoveryAuthor.name;
      rows = [...rows, ...paragraphs.slice(0, 4).map(text => ({ speaker: { name }, topicId: discoveryTopic(text), spokenAt: { value: null, precision: 'unknown' as const, basisType: 'none' as const, basis: '본인 작성·발표문, 실제 구두 발언일은 별도 확인되지 않음' }, kind: 'direct_quote' as const, quoteText: text, quoteLanguage: 'en', summaryKo: '', excerpts: [text], sourceType: 'authored_post' as const, provenance: [{ label: '공식 원문 작성·발표자', excerpt: a.discoveryAuthor!.excerpt }] }))];
    }
  }
  const seen = new Set<string>();
  return rows.filter(r => {
    const q = r.quoteText || ''; if (seen.has(q)) return false; seen.add(q);
    // 회사가 달라질 수 있는 Musk의 타사 발언은 자동 귀속하지 않습니다.
    if (person.personId === 'elon-musk') { const ev = r.excerpts.join(' '); if (a.discoveryCompanyId === 'tsla' && /\bSpaceX\b/.test(ev)) return false; if (a.discoveryCompanyId === 'spacex' && /\bTesla\b/.test(ev)) return false; }
    return true;
  }).slice(0, DISCOVERY_LIMITS.quotesPerArticle).map(r => ({ ...r, speaker: { ...r.speaker, companyId: a.discoveryCompanyId }, topicId: discoveryTopic(r.quoteText || ''),
    ...(new URL(a.url).hostname === 'www.sec.gov' ? { sourceType: 'filed_transcript' as const } : a.publishedAtBasis?.kind === 'released' ? { sourceType: 'press_release' as const } : {}),
  }));
}

export async function loadDiscoveredArticles(o: {
  fetchText: (url: string, opts?: { deadline?: number }) => Promise<string>;
  fetchSecText?: (url: string, deadline: number) => Promise<string>;
  parseFeed: OfficialSourceDeps['parseFeed']; now: () => number; deadline: number;
  previous?: DiscoveryState; existing: CeoStatement[]; knownUrls?: Set<string>; providers?: DiscoveryProvider[];
}): Promise<{ articles: SourceArticle[]; reports: FeedReport[]; state: DiscoveryState; removed: string[] }> {
  const now = o.now(); const three = new Date(now); three.setUTCHours(0, 0, 0, 0); three.setUTCFullYear(three.getUTCFullYear() - 3); const five = new Date(now); five.setUTCHours(0, 0, 0, 0); five.setUTCFullYear(five.getUTCFullYear() - 5);
  const deadline = Math.min(o.deadline - 12000, now + DISCOVERY_LIMITS.seconds * 1000);
  const state: DiscoveryState = o.previous?.version === 1 && o.previous.streams && typeof o.previous.streams === 'object' ? JSON.parse(JSON.stringify(o.previous)) : { version: 1, streams: {} };
  const articles: SourceArticle[] = [], reports: FeedReport[] = [], removed: string[] = [];
  const providers = o.providers || DISCOVERY_PROVIDERS;
  const offset = Number.isInteger(state.nextProvider) ? Math.max(0, state.nextProvider! % Math.max(1, providers.length)) : 0;
  const ordered = [...providers.slice(offset), ...providers.slice(0, offset)];
  const coverage = new Map<string, Set<string>>();
  const addCoverage = (key: string, day: string) => { if (!coverage.has(key)) coverage.set(key, new Set()); coverage.get(key)!.add(day); };
  for (const s of o.existing) { const day = statementReferenceDate(s)?.value || s.evidence.map(e => documentPublishedAt(e)?.slice(0, 10)).find(Boolean); if (day && (Date.parse(day) || 0) >= five.getTime() && Date.parse(day) <= now + 86400000) addCoverage(s.companyId + '|' + s.topicId, day); }
  const usedByCompany = new Map<string, number>();
  for (const p of ordered) {
    if (o.now() >= deadline) break;
    const old = state.streams[p.id];
    const stream: DiscoveryStream = old && Array.isArray(old.pending) && Array.isArray(old.indexes) && old.checked && typeof old.checked === 'object' ? old : { pending: [], indexes: [], checked: {}, updatedAt: 0 };
    state.streams[p.id] = stream;
    stream.checked = Object.fromEntries(Object.entries(stream.checked).filter(([, v]) => v && Number.isFinite(v.at) && typeof v.modified === 'string' && typeof v.ok === 'boolean'));
    stream.indexChecked = stream.indexChecked && typeof stream.indexChecked === 'object' ? Object.fromEntries(Object.entries(stream.indexChecked).filter(([, v]) => Number.isFinite(v))) : {};
    if (!Number.isFinite(stream.updatedAt)) stream.updatedAt = 0;
    stream.pending = stream.pending.filter(x => x && discoveryArticleAllowed(p, x.url)); stream.indexes = stream.indexes.filter(u => indexAllowed(p, u));
    const report: FeedReport = { feedName: `${p.name} · 최근 3년 / 비교 부족 시 5년`, feedUrl: p.index, ok: true, itemsInFeed: 0, matchedExisting: 0, withBody: 0, kind: 'discovery' }; reports.push(report);
    const request = (url: string) => o.fetchText(url, { deadline: Math.min(deadline, o.now() + 6000) });
    const indexes = stream.updatedAt < now - 20 * 3600000 ? [p.index, ...stream.indexes] : [...stream.indexes];
    let indexFailed = false;
    for (const url of [...new Set(indexes)].slice(0, DISCOVERY_LIMITS.indexesPerStream)) {
      if (o.now() >= deadline) break;
      try {
        const html = await request(url);
        let parsed = parseDiscoveryIndex(p, html, url);
        if (p.mode === 'feed') {
          const feed = await o.parseFeed(html);
          parsed.articles = feed.filter(it => /SpaceX|Elon Musk/i.test(it.title)).filter(it => discoveryArticleAllowed(p, it.link)).map(it => ({ url: it.link, title: it.title, modified: it.pubDate || undefined }));
          const dates = feed.map(it => Date.parse(it.pubDate || '')).filter(Number.isFinite);
          if (feed.length && dates.length && Math.min(...dates) >= five.getTime()) {
            const next = new URL(url); next.searchParams.set('paged', String(Number(next.searchParams.get('paged') || 1) + 1));
            parsed.indexes.push(next.href);
          }
        }
        stream.indexes = stream.indexes.filter(u => u !== url);
        stream.indexChecked[url] = now;
        for (const next of parsed.indexes) if (!stream.indexes.includes(next) && (stream.indexChecked[next] || 0) < now - 7 * 86400000) stream.indexes.push(next);
        const entries = new Map(stream.pending.map(x => [x.url, x]));
        for (const c of parsed.articles) {
          const checked = stream.checked[c.url];
          if (!o.knownUrls?.has(c.url) && (!checked || (!checked.ok && now - checked.at >= 86400000) || (checked.modified !== (c.modified || '') && now - checked.at >= 86400000))) entries.set(c.url, c);
        }
        // 신규·과거 후보를 상한 안에서 차례로 처리합니다. lastmod는 순위에만 쓰며 발행일로 쓰지 않습니다.
        const priority = (c: DiscoveryCandidate) => /message-ceo|sundar|pichai|earnings|financial-results|satya|nadella|coreai|core-ai|why-what|prioritizing-security/i.test(c.url) ? 1 : 0;
        stream.pending = [...entries.values()].sort((a, b) => priority(b) - priority(a) || (Date.parse(b.modified || '') || 0) - (Date.parse(a.modified || '') || 0)).slice(0, DISCOVERY_LIMITS.pendingPerStream);
        if (url === p.index) stream.updatedAt = now;
      } catch (e: any) { indexFailed = true; report.ok = false; report.error = String(e?.message || e).slice(0, 150); }
    }
    let read = 0;
    while (stream.pending.length && read < DISCOVERY_LIMITS.articlesPerCompany && (usedByCompany.get(p.companyId) || 0) < DISCOVERY_LIMITS.articlesPerCompany * (p.companyId === 'tsla' ? 2 : 1) && o.now() < deadline) {
      const c = stream.pending.shift()!; read++; usedByCompany.set(p.companyId, (usedByCompany.get(p.companyId) || 0) + 1);
      if (o.knownUrls?.has(c.url)) continue;
      try {
        let html: string;
        if (p.id === 'tesla-sec') { if (!o.fetchSecText) throw new Error('SEC 전용 요청기 없음'); html = await o.fetchSecText(c.url, Math.min(deadline, o.now() + 6000)); }
        else html = await request(c.url);
        const a = discoveredArticle(p, c.url, html, now, c.filedAt);
        if (!a) { stream.checked[c.url] = { at: now, modified: c.modified || '', ok: true }; continue; }
        const date = Date.parse(a.publishedAt!); if (date < five.getTime()) { stream.checked[c.url] = { at: now, modified: c.modified || '', ok: true }; continue; }
        const rows = await extractDiscoveredQuotes(a);
        const eligibleTopics = new Set(rows.filter(r => date >= three.getTime() || (coverage.get(p.companyId + '|' + r.topicId)?.size || 0) < 2).map(r => r.topicId));
        const wanted = rows.filter(r => eligibleTopics.has(r.topicId));
        if (wanted.length) {
          // 재추출 시에도 5년 확장 조건을 유지하도록 채택한 주제를 필터로 전달합니다.
          a.discoveryTopics = [...new Set(wanted.map(r => r.topicId))];
          articles.push(a); report.withBody++;
          for (const r of wanted) addCoverage(p.companyId + '|' + r.topicId, a.publishedAt!.slice(0, 10));
        }
        stream.checked[c.url] = { at: now, modified: c.modified || '', ok: true };
      } catch (e: any) {
        stream.checked[c.url] = { at: now, modified: c.modified || '', ok: false }; report.ok = false; report.error = String(e?.message || e).slice(0, 150);
        if (e?.httpStatus === 404 || e?.httpStatus === 410) removed.push(computeUrlHash(c.url));
        // 차단된 호스트의 남은 자료는 다음 갱신에서 처리합니다. 재시도나 UA 위장을 하지 않습니다.
        if (e?.httpStatus === 403 || e?.httpStatus === 429) break;
      }
    }
    stream.checked = Object.fromEntries(Object.entries(stream.checked).sort((a, b) => b[1].at - a[1].at).slice(0, DISCOVERY_LIMITS.checkedPerStream));
    stream.indexes = [...new Set(stream.indexes)].slice(0, 50);
    stream.indexChecked = Object.fromEntries(Object.entries(stream.indexChecked).sort((a, b) => b[1] - a[1]).slice(0, 100));
    report.itemsInFeed = stream.pending.length;
    report.matchedExisting = read;
    if (!indexFailed && !report.withBody && report.ok) report.error = `새로 확인된 인용 0건 · 대기 원문 ${stream.pending.length}건`;
    state.nextProvider = o.now() >= deadline && read === 0 ? providers.indexOf(p) : (providers.indexOf(p) + 1) % providers.length;
  }
  return { articles, reports, state, removed };
}
