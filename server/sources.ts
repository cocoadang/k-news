import { CompanyProfile } from './types';
import { evaluateSourceTier, SourceTier, SourceEvaluation, TIER1_KEYWORDS, TIER2_KEYWORDS, COMPANY_SPECIALIST_SOURCES, BLOCKED_SOURCE_PATTERNS } from './sourceTiers';

export {
  evaluateSourceTier,
  TIER1_KEYWORDS,
  TIER2_KEYWORDS,
  COMPANY_SPECIALIST_SOURCES,
  BLOCKED_SOURCE_PATTERNS
};
export type { SourceTier, SourceEvaluation };

export interface OfficialFeedSource {
  id: string;
  name: string;
  url: string;
  type: 'official_announcement' | 'agency_regulatory' | 'investor_relations' | 'news_aggregator';
  companyId?: string;
  credibilityScore: number;
  description: string;
}

// Curated 1st-Party Official & Agency Feed Endpoints
export const OFFICIAL_AND_REGULATORY_FEEDS: OfficialFeedSource[] = [
  // 1. Space & Aviation Agencies
  {
    id: 'nasa-breaking',
    name: 'NASA Breaking News & Missions',
    url: 'https://www.nasa.gov/news-release/feed/',
    type: 'agency_regulatory',
    companyId: 'spacex',
    credibilityScore: 10,
    description: 'NASA 공식 보도자료 및 아르테미스/우주정거장 임무 계약 발표',
  },
  {
    id: 'faa-news',
    name: 'FAA Press Releases & Licensing',
    url: 'https://www.faa.gov/newsroom/press_releases/rss.xml',
    type: 'agency_regulatory',
    companyId: 'spacex',
    credibilityScore: 10,
    description: 'FAA 상업 우주 발사 면허 및 규제 승인 공식 피드',
  },

  // 2. SEC EDGAR Official Filings & Regulatory
  {
    id: 'sec-edgar-press',
    name: 'SEC Official Press Releases',
    url: 'https://www.sec.gov/news/pressreleases.rss',
    type: 'agency_regulatory',
    credibilityScore: 10,
    description: '미국 증권거래위원회(SEC) 주요 공시 및 규제 조치 공식 피드',
  },

  // 3. BigTech Investor Relations & Official Corporate Newsrooms
  {
    id: 'google-ir-news',
    name: 'Alphabet / Google Official Newsroom',
    url: 'https://blog.google/rss/',
    type: 'official_announcement',
    companyId: 'googl',
    credibilityScore: 10,
    description: 'Alphabet/Google 공식 블로그 (Gemini, DeepMind, Cloud 신제품 발표)',
  },
  {
    id: 'microsoft-official',
    name: 'Microsoft Official Newsroom',
    url: 'https://blogs.microsoft.com/feed/',
    type: 'official_announcement',
    companyId: 'msft',
    credibilityScore: 10,
    description: 'Microsoft 공식 블로그 (Azure, Copilot, 인프라 투자 발표)',
  },
  {
    id: 'nvidia-official',
    name: 'NVIDIA Official Newsroom & AI Blog',
    url: 'https://blogs.nvidia.com/feed/',
    type: 'official_announcement',
    companyId: 'nvda',
    credibilityScore: 10,
    description: 'NVIDIA 공식 블로그 (Blackwell, AI 반도체, GTC 키노트 발표)',
  },
];

// Fallback search-targeted official queries on Google News for IR & Filings
export function getCompanyOfficialQueries(company: CompanyProfile): OfficialFeedSource[] {
  const list: OfficialFeedSource[] = [];

  if (company.id === 'spacex') {
    list.push({
      id: 'spacex-official-query',
      name: 'SpaceX Official & Starship Flight Updates',
      url: 'https://news.google.com/rss/search?q=(site:spacex.com+OR+"SpaceX"+(Starship+OR+Starlink+OR+Starshield+OR+Falcon+OR+FAA+OR+NASA+OR+Pentagon))+when:3d&hl=en-US&gl=US&ceid=US:en',
      type: 'official_announcement',
      companyId: 'spacex',
      credibilityScore: 10,
      description: 'SpaceX 공식 발표 및 주요 항공우주 기관 계약',
    });
  } else if (company.id === 'tsla') {
    list.push({
      id: 'tesla-ir-query',
      name: 'Tesla Investor Relations & Regulatory',
      url: 'https://news.google.com/rss/search?q=(site:ir.tesla.com+OR+"Tesla"+(FSD+OR+Robotaxi+OR+Cybercab+OR+Deliveries+OR+Optimus+OR+Megapack+OR+NHTSA+OR+SEC))+when:3d&hl=en-US&gl=US&ceid=US:en',
      type: 'investor_relations',
      companyId: 'tsla',
      credibilityScore: 10,
      description: 'Tesla IR 공식 발표 및 자율주행 규제 인허가',
    });
  } else if (company.id === 'googl') {
    list.push({
      id: 'alphabet-ir-query',
      name: 'Alphabet IR & Cloud Regulatory',
      url: 'https://news.google.com/rss/search?q=(site:abc.xyz+OR+"Alphabet"+OR+"Google"+(Gemini+OR+DeepMind+OR+Cloud+OR+TPU+OR+Waymo+OR+DOJ+OR+Antitrust))+when:3d&hl=en-US&gl=US&ceid=US:en',
      type: 'investor_relations',
      companyId: 'googl',
      credibilityScore: 10,
      description: 'Alphabet IR 및 Google AI/클라우드/반독점 주요 동향',
    });
  } else if (company.id === 'msft') {
    list.push({
      id: 'msft-ir-query',
      name: 'Microsoft IR & Azure Datacenter CAPEX',
      url: 'https://news.google.com/rss/search?q=(site:microsoft.com+OR+"Microsoft"+(Azure+OR+Copilot+OR+OpenAI+OR+Capex+OR+Datacenter+OR+Earnings))+when:3d&hl=en-US&gl=US&ceid=US:en',
      type: 'investor_relations',
      companyId: 'msft',
      credibilityScore: 10,
      description: 'Microsoft IR 실적 및 클라우드 AI CAPEX',
    });
  } else if (company.id === 'nvda') {
    list.push({
      id: 'nvidia-ir-query',
      name: 'NVIDIA IR & Blackwell Supply Chain',
      url: 'https://news.google.com/rss/search?q=(site:nvidia.com+OR+"Nvidia"+(Blackwell+OR+GPU+OR+Datacenter+OR+HBM+OR+TSMC+OR+Capex+OR+Rubin))+when:3d&hl=en-US&gl=US&ceid=US:en',
      type: 'investor_relations',
      companyId: 'nvda',
      credibilityScore: 10,
      description: 'NVIDIA IR 실적 및 차세대 GPU 공급망/고객사 발주',
    });
  } else {
    // Generalized IR & Corporate Announcement query for any newly registered company (e.g. Apple, TSMC)
    const tickerOrName = company.ticker && company.ticker.length <= 6 && !company.ticker.includes('(')
      ? `"${company.name}" OR "${company.ticker}"`
      : `"${company.name}"`;
    const focus = (company.coreBusinesses || []).slice(0, 3).map(t => `"${t}"`).join(' OR ');
    const focusClause = focus ? `(${focus}) ` : '';
    list.push({
      id: `${company.id}-ir-query`,
      name: `${company.name} IR & Corporate Announcements`,
      url: `https://news.google.com/rss/search?q=(${tickerOrName})+${focusClause}(earnings+OR+revenue+OR+SEC+OR+filing+OR+capex+OR+contract)+when:3d&hl=en-US&gl=US&ceid=US:en`,
      type: 'investor_relations',
      companyId: company.id,
      credibilityScore: 9,
      description: `${company.name} 공식 IR 및 기업 공시/투자 발표`,
    });
  }

  return list;
}
