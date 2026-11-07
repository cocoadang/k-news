/**
 * 공식 출처 원문 어댑터 (CEO 모듈 전용, 읽기만).
 * - 대상 피드: 기존 수집기 목록(OFFICIAL_AND_REGULATORY_FEEDS) 중 등록 CEO가 있는 회사의 공식 피드만 (수정·추가 없음)
 * - 대상 기사: 이미 수집된 이벤트의 출처 URL과 일치하는 피드 항목만 (새 기사 수집 아님). 기사 ID는 기존 computeUrlHash
 * - 본문: 피드가 제공하는 전체 본문(content:encoded)만 사용. 기사 페이지를 따로 내려받지 않음
 * - 저장소 쓰기·모델 호출·알림 없음. 피드별 1회 읽기, 크기·건수 상한
 */
import { COMPANY_QUESTIONS } from '../../src/components/ceo/timeline/companyQuestions.mjs';
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
export const DISCOVERY_LIMITS = { articlesPerCompany: 3, indexesPerStream: 2, pendingPerStream: 180, checkedPerStream: 2000, quotesPerArticle: 6, seconds: 45 };
/** 수집 범위: 최근 6년 (사용자 요청 2026-11-07, 이전: 3년/비교 부족 시 5년) */
export const DISCOVERY_YEARS = 6;
/** 본인 블로그·에세이·주주서한 수집 범위 */
export const AUTHORED_YEARS = 10;

export interface DiscoveryProvider { id: string; companyId: string; personId: string; name: string; index: string; mode: 'sitemap' | 'feed' | 'archive' | 'pdf-list'; host: string; articlePath: RegExp;
  /** pdf-list: 자료실 목록(index)의 PDF가 올라가는 호스트 */
  assetHost?: string;
  /** 본인 공식 채널(사이트 전체가 본인 글): 작성자 = 이 인물. 문단을 본인 작성 발언으로 씀 */
  authored?: boolean;
  /** 수집 범위(년). 없으면 DISCOVERY_YEARS(6). 본인 블로그·에세이·서한은 10년(사용자 요청 2026-11-08) */
  years?: number }
export const DISCOVERY_PROVIDERS: DiscoveryProvider[] = [
  { id: 'google', companyId: 'googl', personId: 'sundar-pichai', name: 'Google 공식 블로그', index: 'https://blog.google/en-us/sitemap.xml', mode: 'sitemap', host: 'blog.google', articlePath: /\/(?:company-news|inside-google|technology|products)\// },
  { id: 'microsoft', companyId: 'msft', personId: 'satya-nadella', name: 'Microsoft 공식 블로그', index: 'https://blogs.microsoft.com/sitemap_index.xml', mode: 'sitemap', host: 'blogs.microsoft.com', articlePath: /\/blog\/\d{4}\/\d{2}\/\d{2}\// },
  { id: 'nvidia', companyId: 'nvda', personId: 'jensen-huang', name: 'NVIDIA 공식 뉴스룸', index: 'https://nvidianews.nvidia.com/sitemap.xml', mode: 'sitemap', host: 'nvidianews.nvidia.com', articlePath: /^\/news\// },
  { id: 'tesla', companyId: 'tsla', personId: 'elon-musk', name: 'Tesla 공식 IR', index: 'https://ir.tesla.com/press', mode: 'archive', host: 'ir.tesla.com', articlePath: /^\/press-release\// },
  { id: 'tesla-sec', companyId: 'tsla', personId: 'elon-musk', name: 'Tesla 공식 공시 목록', index: 'https://ir.tesla.com/sec-filings', mode: 'archive', host: 'ir.tesla.com', articlePath: /^\/Archives\/edgar\/data\/1318605\// },
  { id: 'spacex-nasa', companyId: 'spacex', personId: 'elon-musk', name: 'NASA 공식 SpaceX 발표', index: 'https://www.nasa.gov/feed/', mode: 'feed', host: 'www.nasa.gov', articlePath: /^\/(?:news-release|missions)\// },
  // 애크먼: Pershing Square Holdings 공식 자료실의 주주서한(연차보고서 서한·반기 운용사 보고서). 서명(William A. Ackman) 확인된 서한 본문만
  { id: 'pershing-letters', companyId: 'pershing', personId: 'bill-ackman', name: 'Pershing Square 주주서한', index: 'https://pershingsquareholdings.com/wp-json/wp/v2/media?search=Pershing%20Square%20Holdings&mime_type=application%2Fpdf&per_page=100&orderby=date&order=desc', mode: 'pdf-list', host: 'pershingsquareholdings.com', assetHost: 'assets.pershingsquareholdings.com', articlePath: /^\/wp-content\/uploads\/[\w/.-]+\.pdf$/i, authored: true, years: AUTHORED_YEARS },
  // 올트먼 개인 블로그(Posthaven, ?page=N 목록), 아모데이 개인 에세이 사이트(sitemap). 본인 글만
  { id: 'altman-blog', companyId: 'openai', personId: 'sam-altman', name: '샘 올트먼 개인 블로그', index: 'https://blog.samaltman.com/', mode: 'archive', host: 'blog.samaltman.com', articlePath: /^\/[a-z0-9][a-z0-9-]{2,}$/, authored: true, years: AUTHORED_YEARS },
  { id: 'amodei-essays', companyId: 'anthropic', personId: 'dario-amodei', name: '다리오 아모데이 개인 에세이', index: 'https://darioamodei.com/sitemap.xml', mode: 'sitemap', host: 'darioamodei.com', articlePath: /^\/(?:essay|post|essays|posts)\/[a-z0-9-]+$/, authored: true, years: AUTHORED_YEARS },
];
export const discoveryAllowedHosts = () => [...new Set(DISCOVERY_PROVIDERS.flatMap(p => p.mode === 'pdf-list' ? [p.host] : [p.host]))];
export const discoveryPdfHosts = () => [...new Set(DISCOVERY_PROVIDERS.flatMap(p => p.assetHost ? [p.assetHost] : []))];

function normalizedUrl(value: string, base: string): string | null {
  try { const u = new URL(decodeEntities(value), base); if (u.protocol !== 'https:' || u.username || u.password || u.port) return null; u.hash = ''; return u.href; } catch { return null; }
}
export function discoveryArticleAllowed(p: DiscoveryProvider, url: string): boolean {
  try {
    const u = new URL(url);
    if (p.mode === 'pdf-list') return u.protocol === 'https:' && !u.username && !u.password && !u.port && u.hostname === p.assetHost && p.articlePath.test(u.pathname);
    const host = p.id === 'tesla-sec' ? 'www.sec.gov' : p.host;
    return u.protocol === 'https:' && !u.username && !u.password && !u.port && u.hostname === host && p.articlePath.test(u.pathname) && !/\.(?:pdf|jpg|png|zip)$/i.test(u.pathname);
  } catch { return false; }
}
function indexAllowed(p: DiscoveryProvider, value: string): boolean {
  try {
    const u = new URL(value);
    if (u.protocol !== 'https:' || u.hostname !== p.host || u.username || u.password || u.port) return false;
    if (p.mode === 'sitemap') return (/sitemap[^/]*\.xml$/.test(u.pathname) || (p.authored === true && /^\/sitemap\/\d{4}(?:\/\d{1,2})?$/.test(u.pathname))) && (p.id !== 'google' || u.pathname.startsWith('/en-us/')) && !/(?:author|page)-sitemap/.test(u.pathname);
    if (p.mode === 'pdf-list') return false;
    if (p.mode === 'archive') return u.pathname === new URL(p.index).pathname && [...u.searchParams.keys()].every(k => ['page', 'items_per_page'].includes(k));
    return u.pathname === '/feed/' && [...u.searchParams.keys()].every(k => k === 'paged');
  } catch { return false; }
}

/** 주주서한으로 볼 자료 제목 (팩트시트·공지·발표 슬라이드 제외) */
export const LETTER_TITLE = /\b(?:Letter to Shareholders|Investment Manager['’]s Report|Annual Report|Interim(?: Report)?)\b/i;
const NOT_LETTER = /\b(?:Fact Sheet|Articles of|Notice|Slides|Presentation|Portfolio Review|Proxy|Circular|Prospectus)\b/i;

/** 공식 자료실(materials) 목록의 실제 게시일. 2025-02 사이트 이전 때 옛 파일 업로드일이 바뀌어서, 업로드일이 보고 기간과 맞지 않으면 이 표를 씀 */
const PERSHING_LISTED: Record<string, string> = {
  'annual 2021': '2022-03-29', 'interim 2022': '2022-08-19', 'annual 2022': '2023-03-29', 'interim 2023': '2023-08-18',
  'annual 2023': '2024-03-22', 'interim 2024': '2024-08-15', 'annual 2024': '2025-03-14', 'interim 2025': '2025-08-20', 'annual 2025': '2026-02-18', 'interim 2026': '2026-08-12',
};
/** 보고서 제목의 기간으로 게시일 확인: 연차(Y) → Y+1년 1~6월, 반기(June Y) → Y년 7~10월 업로드일만 인정, 아니면 공식 목록 표, 그래도 없으면 버림 */
export function pershingLetterDate(title: string, uploaded?: string): string | null {
  const a = /\b(20\d\d)\b[^]*?Annual Report|Annual Report[^]*?\b(20\d\d)\b/i.exec(title); const i = /June (20\d\d)[^]*?Interim|Interim[^]*?June (20\d\d)/i.exec(title);
  const key = i ? `interim ${i[1] || i[2]}` : a ? `annual ${a[1] || a[2]}` : null; if (!key) return null;
  const y = Number(key.slice(-4));
  const ok = uploaded && (i ? uploaded >= `${y}-07-01` && uploaded <= `${y}-10-31` : uploaded >= `${y + 1}-01-01` && uploaded <= `${y + 1}-06-30`);
  return ok ? uploaded! : PERSHING_LISTED[key] || null;
}

/** 자료실 목록: PDF 링크마다 링크 글자(제목)와 바로 앞 날짜를 읽음 */
function parsePdfList(p: DiscoveryProvider, html: string, base: string): DiscoveryCandidate[] {
  const out = new Map<string, DiscoveryCandidate>();
  // 공식 사이트 미디어 목록(WordPress REST JSON): 파일 제목·업로드일. 같은 보고서의 재업로드(-1 등)는 최신 1개만
  if (/^\s*\[/.test(html)) {
    let items: any[] = []; try { items = JSON.parse(html); } catch { return []; }
    const byName = new Map<string, DiscoveryCandidate>();
    for (const it of Array.isArray(items) ? items : []) {
      const u = normalizedUrl(String(it?.source_url || ''), base); if (!u || !discoveryArticleAllowed(p, u)) continue;
      const title = htmlToText(String(it?.title?.rendered || '')).replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
      if (!LETTER_TITLE.test(title) || NOT_LETTER.test(title) || /Fact-?Sheet|Presentation|Slides/i.test(u)) continue;
      const day = pershingLetterDate(title, /^\d{4}-\d\d-\d\d/.exec(String(it?.date || ''))?.[0]); if (!day) continue;
      const key = title.replace(/\s+\d+$/, '').toLowerCase();
      const prev = byName.get(key);
      if (!prev || day > (prev.filedAt || '')) byName.set(key, { url: u, title, filedAt: day, modified: day });
    }
    return [...byName.values()];
  }
  for (const m of html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+\.pdf(?:#[^"']*)?)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const u = normalizedUrl(m[1], base); if (!u || !discoveryArticleAllowed(p, u)) continue;
    const before = htmlToText(html.slice(Math.max(0, (m.index || 0) - 1500), m.index || 0));
    const title = htmlToText(m[2]).replace(/\s+/g, ' ').trim() || htmlToText(before.split('\n').slice(-2).join(' '));
    const context = (title + ' ' + before.split('\n').slice(-3).join(' '));
    if (!LETTER_TITLE.test(context) || NOT_LETTER.test(title) || /Fact-?Sheet|Presentation|Slides/i.test(u)) continue;
    const dates = extractAbsoluteDates(before.split('\n').slice(-6).join('\n')).filter(d => d.precision === 'day');
    const filedAt = dates.length ? dates[dates.length - 1].value : undefined;
    const prev = out.get(u);
    if (!prev || (!prev.filedAt && filedAt) || /Letter/i.test(title)) out.set(u, { url: u, title, ...(filedAt ? { filedAt, modified: filedAt } : prev?.filedAt ? { filedAt: prev.filedAt, modified: prev.filedAt } : {}) });
  }
  return [...out.values()];
}

/** 서한 PDF 텍스트 → 서한 본문(인사말 ~ 서명). 서명이 확인되지 않으면 null (다른 사람 글로 오귀속 방지) */
export function pershingLetterArticle(p: DiscoveryProvider, c: DiscoveryCandidate, text: string, now: number): SourceArticle | null {
  if (!discoveryArticleAllowed(p, c.url) || !c.filedAt || !partialToInterval(c.filedAt)) return null;
  const publishedAt = `${c.filedAt}T00:00:00.000Z`;
  if (Date.parse(publishedAt) > now + 86400000) return null;
  const start = text.search(/(?:To the Shareholders of Pershing Square Holdings|Dear (?:Fellow )?(?:Shareholders|Investors))/i);
  if (start < 0) return null;
  const rest = text.slice(start);
  const sign = /Sincerely,?\s*(?:\n\s*)?(William A\. Ackman|Bill Ackman)/i.exec(rest);
  if (!sign) return null;
  const body = `${c.title || 'Pershing Square 주주서한'}\n${rest.slice(0, sign.index).trim()}`.slice(0, 90000);
  if (body.length < 300) return null;
  return { articleId: computeUrlHash(c.url), title: c.title || 'Pershing Square 주주서한', body, sourceName: p.name, url: c.url, publishedAt, sourceKind: 'discovered',
    discoveryCompanyId: p.companyId, discoveryPersonId: p.personId,
    publishedAtBasis: { kind: 'written', excerpt: c.filedAt, basis: `공식 자료실 목록의 게시일 · 서한 서명 '${sign[1]}' 확인` },
    discoveryAuthor: { name: 'Bill Ackman', excerpt: `Pershing Square 공식 자료실 서한 (서명: ${sign[1]})` } };
}

export function parseDiscoveryIndex(p: DiscoveryProvider, html: string, base: string): { articles: DiscoveryCandidate[]; indexes: string[] } {
  if (p.mode === 'pdf-list') return { articles: parsePdfList(p, html, base), indexes: [] };
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

/** 본인 채널 글에 게시 메타데이터가 없을 때: <time datetime> 또는 제목 바로 아래(800자 안) 날짜가 정확히 1개일 때만 */
export function authoredDate(html: string): string | null {
  const t = /<time\b[^>]*datetime=["'](\d{4}-\d\d-\d\d)/i.exec(html);
  if (t && partialToInterval(t[1])) return `${t[1]}T00:00:00.000Z`;
  // Posthaven(올트먼 블로그): 글 게시 시각이 data-unix-time(초)로만 있음 → 첫 번째 값(본문 글)
  const u = /class=["'][^"']*posthaven-formatted-date[^"']*["'][^>]*data-unix-time=["'](\d{9,11})["']/i.exec(html);
  if (u) { const d = new Date(Number(u[1]) * 1000); if (Number.isFinite(d.getTime())) return `${d.toISOString().slice(0, 10)}T00:00:00.000Z`; }
  const h = html.search(/<h1\b/i); if (h < 0) return null;
  const near = htmlToText(html.slice(h, h + 4000)).slice(0, 800);
  const ds = [...new Set(extractAbsoluteDates(near).filter(d => d.precision === 'day').map(d => d.value))];
  return ds.length === 1 ? `${ds[0]}T00:00:00.000Z` : null;
}

export function discoveredArticle(p: DiscoveryProvider, url: string, html: string, now: number, filedAt?: string): SourceArticle | null {
  if (!discoveryArticleAllowed(p, url)) return null;
  // 이미지 전사 속 흰색 OCR 텍스트는 범용 추출에서 제외하고 기존 SEC 전용 검증기에만 맡깁니다.
  if (p.id === 'tesla-sec' && /font-size\s*:\s*1pt|color\s*:\s*(?:white|#fff(?:fff)?)\b/i.test(html) && /<img\b/i.test(html)) return null;
  const title = htmlToText((p.authored ? metaValue(html, ['og:title'])?.replace(/^(?:Dario Amodei|Sam Altman|Ray Dalio)\s*[—–-]\s*/, '') : '') || /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1] || metaValue(html, ['og:title']) || (p.id === 'tesla-sec' ? /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] : '') || '');
  const publishedAt = p.id === 'tesla-sec' && filedAt && /^\d{4}-\d\d-\d\d$/.test(filedAt) && partialToInterval(filedAt) ? `${filedAt}T00:00:00.000Z` : (discoveryPublishedAt(html) || (p.authored ? authoredDate(html) : null));
  if (!title || !publishedAt || Date.parse(publishedAt) > now + 86400000) return null;
  const articleBlocks = [...html.matchAll(/<article\b[^>]*>([\s\S]*?)<\/article>/gi)].map(m => m[1]);
  const mainBlocks = [...html.matchAll(/<main\b[^>]*>([\s\S]*?)<\/main>/gi)].map(m => m[1]);
  const main = [...articleBlocks, ...mainBlocks].find(block => (p.authored || /<h1\b/i.test(block)) && htmlToText(block).includes(title)) || html;
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
  // 본인 공식 채널: 사이트 자체가 본인 글이므로 작성자 확인 = 공식 채널 주소
  if (!author && p.authored) author = `${p.name} (${p.host})`;
  if (!author && authorMeta === english && !otherNames.some(n => header.includes(n))) author = lines.find(l => l.trim() === english);
  // Google 단일 CEO 발언문: 이름·직함 단독 줄과 발언 기록 편집자 주를 모두 확인합니다.
  if (!author && lines.some(l => l.trim() === english) && /CEO of Google and Alphabet/.test(header) && /(?:transcript of (?:his|the) remarks|remarks from today)/i.test(header) && !otherNames.some(n => header.includes(n))) author = lines.find(l => l.trim() === english);
  const dateLine = body.slice(0, 1000).split('\n').find(line => { const ds = extractAbsoluteDates(line); return ds.length === 1 && ds[0].precision === 'day' && ds[0].value === publishedAt.slice(0, 10); });
  return { articleId: computeUrlHash(url), title, body, sourceName: p.name, url, publishedAt, sourceKind: 'discovered', discoveryCompanyId: p.companyId, discoveryPersonId: p.personId,
    ...(p.authored ? { publishedAtBasis: { kind: 'written' as const, excerpt: dateLine || publishedAt.slice(0, 10), basis: '본인 공식 채널 글의 게시일(게시 메타데이터)' } } :
      dateLine && p.id !== 'tesla-sec' ? { publishedAtBasis: { kind: author ? 'written' as const : 'released' as const, excerpt: dateLine, basis: '공식 원문의 게시 날짜 요소와 날짜 값을 대조' } } : {}),
    ...(author ? { discoveryAuthor: { name: english, excerpt: author } } : {}) };
}

/** 사전에 고정한 문장 대신 귀속이 명확한 여러 인용을 추출하고 회사·주제를 기록별로 지정합니다. */
export async function extractDiscoveredQuotes(a: SourceArticle): Promise<RawStatement[]> {
  const person = CEO_PERSONS.find(p => p.personId === a.discoveryPersonId);
  if (!person || !a.discoveryCompanyId) return [];
  let rows = await createQuoteExtractor([person]).extract(a);
  if (a.discoveryAuthor) {
    const marker = a.body.indexOf(a.discoveryAuthor.excerpt);
    // 본인 공식 채널 글은 작성자 표지가 본문에 없음(채널 주소로 확인) → 제목 이후 본문 전체가 본인 글
    const authored = marker < 0;
    const after = (authored ? a.body.slice(a.title.length) : a.body.slice(marker + a.discoveryAuthor.excerpt.length)).replace(/^[\s\S]*?(?:Below is (?:an edited |a )?transcript of his remarks\.)/i, '');
    // 본인 글의 긴 문단(서한 등)은 문장 경계에서 650자 이하 묶음으로 나눔
    const splitLong = (x: string) => x.length <= 650 || !authored ? [x] : (x.match(/[^.!?]+[.!?]+(?:\s|$)/g) || [x]).reduce((acc: string[], s) => { const last = acc[acc.length - 1]; if (last !== undefined && (last + s).length <= 650) acc[acc.length - 1] = last + s; else acc.push(s); return acc; }, []).map(s => s.trim());
    const paragraphs = after.split('\n').map(x => x.trim()).flatMap(splitLong).filter(x => x.length >= 90 && x.length <= 650 && !/[“”"]|\b(?:said|says|told|wrote|according to)\b/i.test(x) && !/^(?:[A-Z ]{3,}:|Related|Share|Read more|Listen|Watch|Image|Photo)/.test(x));
    const englishNames = CEO_PERSONS.filter(p => p.personId !== person.personId).flatMap(p => p.nameVariants).filter(n => /[A-Za-z]/.test(n));
    if (authored || (!englishNames.some(n => after.includes(n)) && !/\n[A-Z][A-Z ]{3,}(?: MESSAGE|:)/.test(after))) {
      const name = a.discoveryAuthor.name;
      // 본인 채널 글: 질문 목록 단어가 들어간 문단을 먼저(많이 맞는 순), 나머지는 원문 순서
      const defs: any[] = (COMPANY_QUESTIONS as any)[a.discoveryCompanyId] || [];
      const score = (t: string) => defs.reduce((n, d) => n + ((t.match(d.re) || []).length ? 1 : 0), 0);
      const picked = authored ? paragraphs.map((t, i) => ({ t, i, s: score(t) })).sort((x, y) => y.s - x.s || x.i - y.i).slice(0, DISCOVERY_LIMITS.quotesPerArticle).sort((x, y) => x.i - y.i).map(x => x.t) : paragraphs.slice(0, 4);
      rows = [...rows, ...picked.map(text => ({ speaker: { name }, topicId: discoveryTopic(text), spokenAt: { value: null, precision: 'unknown' as const, basisType: 'none' as const, basis: '본인 작성·발표문, 실제 구두 발언일은 별도 확인되지 않음' }, kind: 'direct_quote' as const, quoteText: text, quoteLanguage: 'en', summaryKo: '', excerpts: [text], sourceType: 'authored_post' as const, provenance: [{ label: '공식 원문 작성·발표자', excerpt: a.discoveryAuthor!.excerpt }] }))];
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
  /** pdf-list 출처: PDF 바이트를 읽어 텍스트로 (허용 호스트만) */
  fetchPdfText?: (url: string, deadline: number) => Promise<string>;
  parseFeed: OfficialSourceDeps['parseFeed']; now: () => number; deadline: number;
  previous?: DiscoveryState; existing: CeoStatement[]; knownUrls?: Set<string>; providers?: DiscoveryProvider[];
}): Promise<{ articles: SourceArticle[]; reports: FeedReport[]; state: DiscoveryState; removed: string[] }> {
  const now = o.now(); const five = new Date(now); five.setUTCHours(0, 0, 0, 0); five.setUTCFullYear(five.getUTCFullYear() - DISCOVERY_YEARS); // 출처별 범위(p.years)는 아래 반복문에서
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
    const years = p.years ?? DISCOVERY_YEARS;
    const cutoff = new Date(now); cutoff.setUTCHours(0, 0, 0, 0); cutoff.setUTCFullYear(cutoff.getUTCFullYear() - years);
    const report: FeedReport = { feedName: `${p.name} · 최근 ${years}년`, feedUrl: p.index, ok: true, itemsInFeed: 0, matchedExisting: 0, withBody: 0, kind: 'discovery' }; reports.push(report);
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
          if (feed.length && dates.length && Math.min(...dates) >= cutoff.getTime()) {
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
        if (p.mode === 'pdf-list') {
          if (!o.fetchPdfText) throw new Error('PDF 요청기 없음');
          const text = await o.fetchPdfText(c.url, Math.min(deadline, o.now() + 25000));
          const a = pershingLetterArticle(p, c, text, now);
          if (!a || Date.parse(a.publishedAt!) < cutoff.getTime()) { stream.checked[c.url] = { at: now, modified: c.modified || '', ok: true }; continue; }
          const rows = await extractDiscoveredQuotes(a);
          if (rows.length) { a.discoveryTopics = [...new Set(rows.map(r => r.topicId))]; articles.push(a); report.withBody++; }
          stream.checked[c.url] = { at: now, modified: c.modified || '', ok: true };
          continue;
        }
        let html: string;
        if (p.id === 'tesla-sec') { if (!o.fetchSecText) throw new Error('SEC 전용 요청기 없음'); html = await o.fetchSecText(c.url, Math.min(deadline, o.now() + 6000)); }
        else html = await request(c.url);
        const a = discoveredArticle(p, c.url, html, now, c.filedAt);
        if (!a) { stream.checked[c.url] = { at: now, modified: c.modified || '', ok: true }; continue; }
        const date = Date.parse(a.publishedAt!); if (date < cutoff.getTime()) { stream.checked[c.url] = { at: now, modified: c.modified || '', ok: true }; continue; }
        const rows = await extractDiscoveredQuotes(a);
        const eligibleTopics = new Set(rows.filter(r => date >= cutoff.getTime() || (coverage.get(p.companyId + '|' + r.topicId)?.size || 0) < 2).map(r => r.topicId));
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
