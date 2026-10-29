import Parser from 'rss-parser';
import { RawArticle, CompanyProfile } from './types';
import { db } from './db';
import { firestoreRepo, getIsFirestoreAvailable, computeUrlHash, computeNormalizedTitle } from './firestore';
import { OFFICIAL_AND_REGULATORY_FEEDS, getCompanyOfficialQueries, evaluateSourceTier } from './sources';
import { isNoiseNewsArticle, classifyNoiseBySource } from './newsNoiseFilter';

const parser = new Parser({
  timeout: 8000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36 InvestmentIntel/3.0',
    'Accept': 'application/rss+xml, application/xml, text/xml, */*',
  },
});

interface FeedItemTarget {
  name: string;
  url: string;
  defaultCredibility: number;
  sourceType: 'official_announcement' | 'agency_regulatory' | 'investor_relations' | 'news_aggregator';
  companyId?: string;
}

// Calculate credibility score using tiered evaluation
export function getCredibilityScore(sourceName: string, url: string = ''): number {
  const evalResult = evaluateSourceTier(sourceName, url);
  return evalResult.reliabilityScore;
}

// Clean HTML tags and formatting
function cleanHtmlText(text: string = ''): string {
  return text
    .replace(/<[^>]*>?/gm, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Detects technical documentation, API guides, job postings, and forum noise
 * to prevent wasting Gemini tokens on non-investment content.
 */
export function isTechnicalDocOrNoise(
  title: string,
  snippet: string,
  sourceType?: string
): { isNoise: boolean; reason?: string } {
  const isOfficial =
    sourceType === 'official_announcement' ||
    sourceType === 'agency_regulatory' ||
    sourceType === 'investor_relations';

  const fullText = `${title} ${snippet}`.toLowerCase();
  const cleanTitleLower = title.toLowerCase();

  // First apply shared noise filter (job postings, customer support, API docs)
  if (isNoiseNewsArticle(title)) {
    return { isNoise: true, reason: '공유 잡음 필터 (채용/지원/API 문서)' };
  }

  // Safe pass for critical investment & corporate keywords
  const investmentSafelist = [
    'earnings', 'revenue', 'quarterly', 'guidance', 'ipo', 'capex', 'contract',
    'merger', 'acquisition', 'sec filing', 'investor', 'financial result',
    'antitrust', 'lawsuit', 'billion', 'million', 'defense contract', 'pentagon',
    'profit', 'dividend', 'partnership', 'deal', 'valuation', 'sales'
  ];
  if (investmentSafelist.some(kw => cleanTitleLower.includes(kw))) {
    return { isNoise: false };
  }

  // 1. Technical Documentation & Function-level Guides / API Reference
  const techDocPatterns = [
    /\b(api reference|api doc|api docs|api documentation)\b/i,
    /\b(release notes|changelog|cheat sheet)\b/i,
    /\b(developer guide|user guide|quickstart guide|troubleshooting guide)\b/i,
    /\b(sdk reference|sdk guide|c\+\+ api|python api|rest api reference)\b/i,
    / - nvidia docs\b/i,
    /\b(nvidia docs|google cloud docs|aws documentation|azure docs)\b/i,
    // Specific function-level technical manuals (e.g. ORC, reshape, edit_distance, cuda runtime, etc.)
    /\b(reshape|edit_distance|\.reshape\(|torch\.|cuda\.|cufft|cublas|tensorrt api|onnx runtime)\b/i,
    /\b(documentation overview|code samples|class reference|function reference)\b/i,
  ];

  for (const pattern of techDocPatterns) {
    if (pattern.test(title) || (!isOfficial && pattern.test(snippet))) {
      return { isNoise: true, reason: `기술 문서 / API 레퍼런스 (${pattern.source})` };
    }
  }

  // Standalone docs / guide in title unless official press release
  if (!isOfficial) {
    if (/\b(docs|documentation)\b/i.test(cleanTitleLower) && !cleanTitleLower.includes('doctors')) {
      return { isNoise: true, reason: '제목 내 문서/API 키워드 (docs/documentation)' };
    }
    if (/\b(cheat sheet|code snippet|sample code)\b/i.test(fullText)) {
      return { isNoise: true, reason: '코드 치트시트 / 스니펫' };
    }
    if (/\bguide\b/i.test(cleanTitleLower) && !cleanTitleLower.includes('guidance')) {
      return { isNoise: true, reason: '단순 가이드 / 매뉴얼 (guide)' };
    }
  }

  // 2. Careers, Recruiting & Job Postings
  const jobPatterns = [
    /\bjobs in \w+/i,
    /\b(careers at|career opportunities|we are hiring|now hiring|job opening|job openings|hiring for)\b/i,
    /\b(internship|job listing|job listings|apply now for|open roles at|positions available)\b/i,
  ];

  for (const pattern of jobPatterns) {
    if (pattern.test(title) || pattern.test(snippet)) {
      return { isNoise: true, reason: `채용 / 구인 공고 (${pattern.source})` };
    }
  }

  // 3. Simple Forum Inquiries / Consumer Hardware Troubleshooting
  const forumTroubleshootPatterns = [
    /\b(how to fix|how do i fix|fans not spinning|screen flickering|pc crashing)\b/i,
    /\b(community hub|community forum|user discussion|reddit thread|support ticket)\b/i,
    /\b(blue screen of death|bsod error|error code \w+|driver crash fix)\b/i,
  ];

  for (const pattern of forumTroubleshootPatterns) {
    if (pattern.test(title) || pattern.test(snippet)) {
      return { isNoise: true, reason: `단순 포럼 질의 / 하드웨어 고장 문의 (${pattern.source})` };
    }
  }

  return { isNoise: false };
}

// Extract source publisher from Google News title (e.g. "Headline Here - Reuters")
function extractSourceFromTitle(fullTitle: string, defaultSource: string): { cleanTitle: string; sourceName: string } {
  const parts = fullTitle.split(' - ');
  if (parts.length > 1) {
    const possibleSource = parts[parts.length - 1].trim();
    if (possibleSource.length < 35 && !possibleSource.includes('.')) {
      const cleanTitle = parts.slice(0, -1).join(' - ').trim();
      return { cleanTitle, sourceName: possibleSource };
    }
  }
  return { cleanTitle: fullTitle, sourceName: defaultSource };
}

// Set of generic financial, corporate, and macro stopwords that should NOT trigger standalone company matching
const GENERIC_MATCH_STOPWORDS = new Set([
  // Financial & corporate metrics
  'ipo', '상장', 'valuation', '기업가치', 'funding', '자금조달',
  'revenue', 'earnings', 'capex', 'deal', 'contract', 'antitrust', '반독점',
  'lawsuit', '소송', '실적', '매출', '영업이익', '투자', 'partnership', '파트너십',
  'm&a', '인수합병', 'acquisition', 'merger', 'dividend', '배당', 'profit',
  'margin', '마진', 'sales', '점유율', 'market share', '생산시설', '규제',
  '승인', '공급망', 'supply chain', 'quarterly', '분기', 'guidance', '가이던스',
  'defense contract', 'pentagon', 'government contract', 'sec filing', 'investor',
  'financial result', 'billion', 'million', '경쟁력', '전략', 'strategy',
  'stocks', 'stock', 'shares', 'share', 'investing', 'investor', 'investors',
  // Overly broad single-word technology/market tags
  'ai', 'ev', 'it', 'tech', 'technology', 'chips', 'chip', 'semiconductor',
  'software', 'hardware', 'cloud', 'pc', 'app', 'apps', 'data', 'mobile',
  'service', 'services', 'platform', 'system', 'systems', 'solution', 'solutions',
  'digital', 'network', 'internet', 'online', 'model', 'models', 'product',
  'products', 'market', 'markets', 'industry', 'global', 'security', 'enterprise',
  'infrastructure', '인공지능', '소프트웨어', '하드웨어', '클라우드', '반도체',
  // Common verbs / fillers / status words
  'update', 'updates', 'report', 'reports', 'review', 'reviews', 'news',
  'launch', 'launches', 'release', 'releases', 'feature', 'features',
  'general', 'summary', 'growth', 'loss', 'gains', '주요 사업', '핵심 사업'
]);

/**
 * Checks if article text mentions sub-brands, products, or core business lines of a company
 * even if the company corporate name is omitted (e.g., Apple's 'Vision Pro' / 'Apple Intelligence',
 * TSMC's 'Foundry' / 'N2' / 'CoWoS', SpaceX's 'Starlink' / 'Starship', Google's 'Waymo' / 'Gemini',
 * Tesla's 'Cybercab' / 'FSD', NVIDIA's 'Blackwell' / 'B200').
 */
function matchesCompanyProductOrBusiness(text: string, company: CompanyProfile): boolean {
  const candidateTerms: string[] = [];

  // 1. From coreBusinesses
  for (const raw of company.coreBusinesses || []) {
    if (!raw) continue;
    candidateTerms.push(raw.trim());

    // Split compound items like 'Gemini / DeepMind' -> 'Gemini', 'DeepMind'
    if (raw.includes('/') || raw.includes('&')) {
      const parts = raw.split(/[/&]/).map(p => p.trim());
      for (const p of parts) {
        if (p.length >= 2) candidateTerms.push(p);
      }
    }

    // Extract terms inside parentheses, e.g. 'EV (Model 3/Y/Cybercab)' -> 'Model 3', 'Cybercab'
    const parenMatches = raw.match(/\(([^)]+)\)/g);
    if (parenMatches) {
      for (const pm of parenMatches) {
        const inside = pm.replace(/[()]/g, '');
        inside.split(/[/,]/).forEach(item => {
          const trimmed = item.trim();
          if (trimmed.length >= 2) candidateTerms.push(trimmed);
        });
      }
    }
  }

  // 2. From importantKeywords
  for (const kw of company.importantKeywords || []) {
    if (kw && kw.trim().length >= 2) {
      candidateTerms.push(kw.trim());
    }
  }

  // 3. From searchKeywords (strip company name prefix/suffix if present, e.g. "Apple Vision Pro" -> "Vision Pro")
  for (const kw of company.searchKeywords || []) {
    if (!kw) continue;
    candidateTerms.push(kw.trim());
    const stripped = kw.replace(new RegExp(company.name, 'gi'), '').trim();
    if (stripped.length >= 2) {
      candidateTerms.push(stripped);
    }
  }

  // 4. Backward-compatible known alias safeguards for legacy 5 core companies
  if (company.id === 'spacex') {
    candidateTerms.push('starship', 'starlink', 'starshield', 'falcon 9', 'falcon heavy', 'artemis', 'starbase');
  } else if (company.id === 'googl') {
    candidateTerms.push('gemini', 'deepmind', 'waymo', 'google cloud', 'tpu');
  } else if (company.id === 'tsla') {
    candidateTerms.push('cybercab', 'robotaxi', 'optimus', 'gigafactory', 'megapack', 'fsd', 'supercharger');
  } else if (company.id === 'msft') {
    candidateTerms.push('azure', 'copilot', 'm365');
  } else if (company.id === 'nvda') {
    candidateTerms.push('blackwell', 'b200', 'gb200', 'h100', 'rubin', 'nvlink', 'cuda');
  }

  // Deduplicate and filter out generic stopwords
  const validTerms = Array.from(new Set(candidateTerms)).filter(term => {
    const lower = term.toLowerCase().trim();
    if (lower.length < 2) return false;
    if (GENERIC_MATCH_STOPWORDS.has(lower)) return false;
    if (/^\d+$/.test(lower)) return false;
    return true;
  });

  // Check matching in article text
  for (const term of validTerms) {
    const lowerTerm = term.toLowerCase().trim();

    // Korean / CJK characters: substring matching is natural and accurate
    if (/[\u3131-\uD79D\u4E00-\u9FFF]/.test(term)) {
      if (text.includes(lowerTerm)) {
        return true;
      }
      continue;
    }

    // Multi-word English phrases (e.g. "vision pro", "apple intelligence", "falcon 9")
    if (lowerTerm.includes(' ')) {
      if (text.includes(lowerTerm)) {
        return true;
      }
      continue;
    }

    // Single-word English terms: use word boundary regex to avoid substring collisions
    try {
      const escaped = lowerTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`\\b${escaped}\\b`, 'i');
      if (regex.test(text)) {
        return true;
      }
    } catch {
      if (text.includes(lowerTerm)) {
        return true;
      }
    }
  }

  return false;
}

// Detect which companies are mentioned/relevant in an article
export function matchCompaniesForArticle(
  title: string,
  snippet: string,
  companies: CompanyProfile[]
): { matchedCompanyIds: string[]; matchedCompanyNames: string[] } {
  const text = (title + ' ' + snippet).toLowerCase();
  const matchedIds: string[] = [];
  const matchedNames: string[] = [];

  for (const company of companies) {
    if (!company.enabled) continue;

    // 1. Direct company name & ticker match
    const nameMatch = text.includes(company.name.toLowerCase()) || 
      (company.ticker && company.ticker.length >= 2 && text.includes(company.ticker.toLowerCase()));

    // 2. Direct search keywords match
    const keywordMatch = (company.searchKeywords || []).some(kw => {
      const cleanKw = kw.toLowerCase().trim();
      return cleanKw.length >= 2 && text.includes(cleanKw);
    });

    // 3. Generalized Sub-brand / Core Business / Distinct Product match
    // Allows matching articles where corporate name is omitted (e.g. "Vision Pro", "N2 Foundry", "Starlink")
    const productOrBusinessMatch = matchesCompanyProductOrBusiness(text, company);

    if (nameMatch || keywordMatch || productOrBusinessMatch) {
      matchedIds.push(company.id);
      matchedNames.push(company.name);
    }
  }

  return {
    matchedCompanyIds: matchedIds,
    matchedCompanyNames: matchedNames,
  };
}

/**
 * Generates high-yield compound investment queries dynamically for any company profile
 * combining searchKeywords and coreBusinesses with strategic investment triggers.
 * (e.g. `Apple ("Vision Pro" OR "Apple Intelligence" OR Services) (revenue OR earnings OR capex OR deal OR contract OR antitrust) when:2d`)
 */
function buildCompanyInvestmentQuery(comp: CompanyProfile): string {
  // 1. Company Identity Clause
  let companyClause: string;
  if (comp.id === 'googl' || comp.name.toLowerCase().includes('google') || comp.name.toLowerCase().includes('alphabet')) {
    companyClause = '(Google OR Alphabet)';
  } else if (comp.name.includes('/')) {
    const parts = comp.name.split('/').map(p => p.trim()).filter(Boolean);
    companyClause = `(${parts.join(' OR ')})`;
  } else if (comp.ticker && comp.ticker.length <= 6 && !comp.ticker.includes('(') && comp.ticker.toLowerCase() !== comp.name.toLowerCase()) {
    companyClause = `(${comp.name} OR ${comp.ticker})`;
  } else {
    companyClause = comp.name.trim();
  }

  // 2. Focus Terms (Combining coreBusinesses & top searchKeywords)
  const focusItems: string[] = [];

  // Extract clean sub-terms from coreBusinesses
  for (const b of comp.coreBusinesses || []) {
    if (!b) continue;
    // Clean parenthetical details
    const cleaned = b.replace(/\([^)]*\)/g, '').trim();
    const subParts = cleaned.split(/[/&]/).map(p => p.trim()).filter(p => p.length >= 2);
    for (const p of subParts) {
      if (!focusItems.includes(p)) {
        focusItems.push(p);
      }
      if (focusItems.length >= 3) break;
    }
    if (focusItems.length >= 3) break;
  }

  // If fewer than 3 terms, supplement from searchKeywords
  if (focusItems.length < 3) {
    for (const kw of comp.searchKeywords || []) {
      if (!kw) continue;
      const stripped = kw.replace(new RegExp(comp.name, 'gi'), '').trim();
      if (stripped.length >= 2 && !focusItems.includes(stripped)) {
        focusItems.push(stripped);
      }
      if (focusItems.length >= 3) break;
    }
  }

  let focusClause = '';
  if (focusItems.length > 0) {
    const formattedTerms = focusItems.map(term => term.includes(' ') ? `"${term}"` : term).join(' OR ');
    focusClause = `(${formattedTerms}) `;
  }

  // 3. Investment Core Triggers (high-yield financial and strategic triggers)
  let triggers = 'revenue OR earnings OR capex OR deal OR contract OR antitrust';
  if (comp.id === 'spacex' || comp.name.toLowerCase().includes('spacex')) {
    triggers += ' OR NASA OR Pentagon OR IPO';
  }

  return `${companyClause} ${focusClause}(${triggers}) when:2d`;
}

// Generate comprehensive dynamic feed list combining 1st-party official feeds and Google News queries
function buildDynamicFeedList(companies: CompanyProfile[]): FeedItemTarget[] {
  const feeds: FeedItemTarget[] = [];

  // 1. Primary Official & Agency Feeds (NASA, FAA, SEC, Official Newsrooms)
  for (const officialFeed of OFFICIAL_AND_REGULATORY_FEEDS) {
    if (!officialFeed.companyId || companies.some(c => c.id === officialFeed.companyId && c.enabled)) {
      feeds.push({
        name: officialFeed.name,
        url: officialFeed.url,
        defaultCredibility: officialFeed.credibilityScore,
        sourceType: officialFeed.type,
        companyId: officialFeed.companyId,
      });
    }
  }

  // 2. Company-specific Official IR queries & Dynamic High-Yield Google News Feeds
  for (const comp of companies) {
    if (!comp.enabled) continue;

    // Official IR Query (generalized for all companies in sources.ts)
    const irFeeds = getCompanyOfficialQueries(comp);
    for (const ir of irFeeds) {
      feeds.push({
        name: ir.name,
        url: ir.url,
        defaultCredibility: ir.credibilityScore,
        sourceType: ir.type,
        companyId: comp.id,
      });
    }

    // Comprehensive Dynamic Google News Query for Major Investment Coverage
    const query = buildCompanyInvestmentQuery(comp);
    feeds.push({
      name: `Google News - ${comp.name} High-Yield Intelligence`,
      url: `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`,
      defaultCredibility: 9,
      sourceType: 'news_aggregator',
      companyId: comp.id,
    });
  }

  // 3. Global BigTech Cross-Industry Macro Feeds
  const topCompanyNames = companies.slice(0, 6).map(c => {
    if (c.id === 'googl') return 'Google';
    return c.name.split('/')[0].trim();
  }).filter(Boolean);
  const macroCompanyClause = topCompanyNames.length > 0 ? `(${topCompanyNames.join(' OR ')})` : '(SpaceX OR Google OR Tesla OR Microsoft OR Nvidia)';

  feeds.push({
    name: 'Top-tier Technology Deal & Financial Wire',
    url: `https://news.google.com/rss/search?q=${encodeURIComponent(`${macroCompanyClause} (revenue OR earnings OR deal OR capex OR AI) when:2d`)}&hl=en-US&gl=US&ceid=US:en`,
    defaultCredibility: 10,
    sourceType: 'news_aggregator',
  });

  return feeds;
}

export async function collectNewArticles(): Promise<{ totalFetched: number; newRelevantArticles: RawArticle[] }> {
  const companies = db.getCompanies();
  const enabledCompanies = companies.filter(c => c.enabled);
  const feeds = buildDynamicFeedList(enabledCompanies);
  const newRelevantArticles: RawArticle[] = [];
  const seenThisCycle = new Set<string>();
  let totalFetched = 0;

  db.addLog(
    'Collector',
    'info',
    `Initiating news collection across ${feeds.length} primary official feeds & major wire channels.`
  );

  const feedPromises = feeds.map(async (feed) => {
    try {
      const feedResult = await parser.parseURL(feed.url);
      const items = feedResult.items || [];
      totalFetched += items.length;

      for (const item of items) {
        const rawTitle = item.title || '';
        const link = item.link || item.guid || '';
        if (!rawTitle || !link) continue;

        const { cleanTitle, sourceName } = extractSourceFromTitle(rawTitle, feed.name);
        const snippet = cleanHtmlText(item.contentSnippet || item.content || item.summary || '');
        const pubDate = item.pubDate || item.isoDate || new Date().toISOString();

        // 1. In-cycle deduplication (prevent duplicate entries across parallel feeds in the same run)
        const normalizedLink = link.split('?')[0].trim().toLowerCase().replace(/\/+$/, '');
        const normalizedTitle = computeNormalizedTitle(cleanTitle);
        if (seenThisCycle.has(normalizedLink) || (normalizedTitle.length > 5 && seenThisCycle.has(normalizedTitle))) {
          continue;
        }
        seenThisCycle.add(normalizedLink);
        if (normalizedTitle.length > 5) {
          seenThisCycle.add(normalizedTitle);
        }

        // 2. Check Local DB Cache
        if (db.isArticleProcessed(link, cleanTitle)) {
          continue;
        }

        // 3. Check Cloud Firestore Permanent Duplicate Index
        if (getIsFirestoreAvailable()) {
          try {
            const isProcessedInCloud = await firestoreRepo.isArticleProcessed(link, cleanTitle);
            if (isProcessedInCloud) {
              continue;
            }
          } catch (err) {
            // Gracefully fallback to local DB check result if Firestore check has network issue
          }
        }

        // 4-0. 매체명·URL·제목 형식 기반 비뉴스 문서 제외 (포럼 질문, 기술 문서, 마켓플레이스, 채용 페이지)
        const sourceNoise = classifyNoiseBySource({ sourceName, url: link, title: cleanTitle });
        if (sourceNoise.isNoise) {
          db.addLog(
            'SourceFilter',
            'info',
            `[NoiseFilter] 비뉴스 문서 제외(Drop): "${cleanTitle.slice(0, 40)}..." (${sourceName}, ${sourceNoise.kind})`
          );
          continue;
        }

        // 4. Pre-Gemini Noise & Technical Documentation Filter
        const noiseCheck = isTechnicalDocOrNoise(cleanTitle, snippet, feed.sourceType);
        if (noiseCheck.isNoise) {
          db.addLog(
            'SourceFilter',
            'info',
            `[NoiseFilter] 사전 기술문서/노이즈 제외(Drop): "${cleanTitle.slice(0, 40)}..." (${noiseCheck.reason})`
          );
          continue;
        }

        // Match against enabled companies
        const { matchedCompanyIds } = matchCompaniesForArticle(cleanTitle, snippet, enabledCompanies);

        // If feed is company-specific, ensure it is matched
        if (feed.companyId && !matchedCompanyIds.includes(feed.companyId)) {
          matchedCompanyIds.push(feed.companyId);
        }

        // Skip if no company matches and not an official agency feed
        if (matchedCompanyIds.length === 0 && feed.sourceType === 'news_aggregator') {
          continue;
        }

        // Evaluate source reliability tier
        const evaluation = evaluateSourceTier(
          sourceName,
          link,
          `${cleanTitle} ${snippet} ${cleanHtmlText(item.content || '')}`,
          matchedCompanyIds
        );

        // Block low-quality content farms / scrapers
        if (evaluation.isBlocked) {
          db.addLog(
            'SourceFilter',
            'info',
            `[SourceFilter] 저품질/스팸성 매체 필터링 차단: "${sourceName}" ("${cleanTitle.slice(0, 35)}...")`
          );
          continue;
        }

        const rawArticle: RawArticle = {
          id: `art-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
          title: cleanTitle,
          link,
          source: sourceName,
          publishedAt: new Date(pubDate).toISOString(),
          snippet: snippet.slice(0, 700),
          content: cleanHtmlText(item.content || snippet),
          firstSeenAt: new Date().toISOString(),
          categories: item.categories || [],
          matchedCompanyIds: matchedCompanyIds.length > 0 ? matchedCompanyIds : ['spacex'],
          sourceType: feed.sourceType,
          sourceTier: evaluation.tier,
          sourceReliability: evaluation.reliabilityScore,
          detectedOriginalSource: evaluation.detectedOriginalSource,
        };

        newRelevantArticles.push(rawArticle);
      }
    } catch (err: unknown) {
      // Gracefully handle RSS timeout/offline
    }
  });

  await Promise.allSettled(feedPromises);

  // Store new raw articles in DB & Firestore
  if (newRelevantArticles.length > 0) {
    await db.addRawArticles(newRelevantArticles);
    db.addLog(
      'Collector',
      'success',
      `Collection completed. Found ${newRelevantArticles.length} new unseen articles across official and news sources.`
    );
  } else {
    db.addLog('Collector', 'info', `Collection completed. No new unseen articles found.`);
  }

  return { totalFetched, newRelevantArticles };
}
