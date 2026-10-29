export type SourceTier = 'tier1' | 'tier2' | 'tier3';

export interface SourceEvaluation {
  tier: SourceTier;
  reliabilityScore: number; // 1 - 10
  isOfficial: boolean;
  isSpecialist: boolean;
  isBlocked: boolean;
  matchedRule: string;
  detectedOriginalSource?: string;
  domain: string;
}

// ----------------------------------------------------
// 1. Tier 1 Sources (Official, Regulatory, Major Global Financial Wires)
// ----------------------------------------------------
export const TIER1_KEYWORDS: string[] = [
  // Major Global Financial & Wire Media
  'reuters',
  'bloomberg',
  'wall street journal',
  'wsj',
  'financial times',
  'ft.com',
  'associated press',
  'ap news',
  'dow jones',
  'barron\'s',

  // Official Agencies & Regulatory Bodies
  'sec.gov',
  'edgar',
  'nasa',
  'nasa.gov',
  'faa.gov',
  'defense.gov',
  'pentagon',
  'whitehouse.gov',
  'ftc.gov',
  'fcc.gov',
  'nhtsa.gov',
  'justice.gov',
  'ec.europa.eu',

  // 1st-Party Corporate Official Newsrooms & IR Domains
  'spacex.com',
  'starlink.com',
  'ir.tesla.com',
  'tesla.com',
  'blog.google',
  'abc.xyz',
  'blogs.microsoft.com',
  'microsoft.com',
  'blogs.nvidia.com',
  'nvidia.com',
];

// ----------------------------------------------------
// 2. Tier 2 Sources (Trusted Specialist Media & Major Tech/Business Outlets)
// ----------------------------------------------------
export const TIER2_KEYWORDS: string[] = [
  'cnbc',
  'the verge',
  'techcrunch',
  'ars technica',
  'the information',
  'semafor',
  'marketwatch',
  'forbes',
  'fortune',
  'bloomberg law',
  'defense one',
  'aviation week',
  'payload space',
  'payload',
  'spacenews',
  'tom\'s hardware',
  'anandtech',
  'semianalysis',
  'servethehome',
  'digitimes',
  'electrek',
  'teslarati',
  'clean technica',
  'cleanTechnica',
  'wired',
  'venturebeat',
  'business insider',
  'yahoo finance',
  'seeking alpha',
  'wccftech',
  'hpcwire',
  '9to5google',
  'windows central',
  'nasaspaceflight',
  'everyday astronaut',
  'space.com',
  'not a tesla app',
  'insideevs',
  'autoevolution',
];

// ----------------------------------------------------
// 3. Specialist Whitelists by Company / Domain
// ----------------------------------------------------
export const COMPANY_SPECIALIST_SOURCES: Record<string, string[]> = {
  spacex: [
    'spacenews',
    'ars technica',
    'payload space',
    'payload',
    'nasaspaceflight',
    'everyday astronaut',
    'aviation week',
    'space.com',
    'defense one',
  ],
  tsla: [
    'electrek',
    'teslarati',
    'clean technica',
    'not a tesla app',
    'insideevs',
    'autoevolution',
  ],
  nvda: [
    'tom\'s hardware',
    'anandtech',
    'semianalysis',
    'servethehome',
    'digitimes',
    'wccftech',
    'hpcwire',
  ],
  googl: [
    '9to5google',
    'the verge',
    'techcrunch',
    'the information',
    'android authority',
    'android police',
  ],
  msft: [
    'windows central',
    'the verge',
    'the information',
    'thurrott',
    'geekwire',
    'zdnet',
  ],
};

// ----------------------------------------------------
// 4. Blocked / Low-Quality Junk Scraper & SEO Farm Patterns
// ----------------------------------------------------
export const BLOCKED_SOURCE_PATTERNS: string[] = [
  'fuentitech',
  'technotrenz',
  'cryptonews',
  'investingcube',
  'koreaboo',
  'gizchina',
  'finbold',
  'marketbeat',
  'themotleyfool',
  'investorplace',
  '247wallst',
  'barchart',
  'benzinga.com/pressreleases',
  'globenewswire.com/news-release', // pure uncurated PR blast wire if not matched by company
  'prnewswire.com/news-releases',
  'businesswire.com/news/home',
];

// ----------------------------------------------------
// Helper: Extract domain from URL
// ----------------------------------------------------
export function extractDomainFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

// ----------------------------------------------------
// Helper: Detect Re-syndicated / Cited Original Sources in Title/Content
// ----------------------------------------------------
export function detectOriginalSource(text: string): string | undefined {
  if (!text) return undefined;
  const lower = text.toLowerCase();

  if (lower.includes('according to reuters') || lower.includes('reuters reported') || lower.includes('reported by reuters') || lower.includes('via reuters')) {
    return 'Reuters';
  }
  if (lower.includes('according to bloomberg') || lower.includes('bloomberg reported') || lower.includes('reported by bloomberg') || lower.includes('via bloomberg')) {
    return 'Bloomberg';
  }
  if (lower.includes('according to the wall street journal') || lower.includes('according to wsj') || lower.includes('wsj reported') || lower.includes('wall street journal reported')) {
    return 'Wall Street Journal';
  }
  if (lower.includes('according to financial times') || lower.includes('financial times reported') || lower.includes('ft reported')) {
    return 'Financial Times';
  }
  if (lower.includes('according to cnbc') || lower.includes('cnbc reported')) {
    return 'CNBC';
  }
  if (lower.includes('sec filing') || lower.includes('filed with the sec') || lower.includes('8-k filing') || lower.includes('form 10-q') || lower.includes('form 10-k')) {
    return 'SEC Official Filing';
  }
  if (lower.includes('nasa announced') || lower.includes('according to nasa') || lower.includes('nasa contract')) {
    return 'NASA Official';
  }
  if (lower.includes('faa license') || lower.includes('faa approved') || lower.includes('faa stated') || lower.includes('according to the faa')) {
    return 'FAA Official';
  }
  if (lower.includes('in an official blog post') || lower.includes('company statement') || lower.includes('official press release')) {
    return 'Company Official Statement';
  }

  return undefined;
}

// ----------------------------------------------------
// Main Classifier: Evaluate Source Tier & Credibility
// ----------------------------------------------------
export function evaluateSourceTier(
  sourceName: string,
  url: string,
  contentOrSnippet?: string,
  matchedCompanyIds?: string[]
): SourceEvaluation {
  const sName = (sourceName || '').toLowerCase().trim();
  const domain = extractDomainFromUrl(url);
  const combined = `${sName} ${domain} ${url}`.toLowerCase();
  const detectedOriginal = detectOriginalSource(`${sName} ${contentOrSnippet || ''}`);

  // 1. Check Blocked List
  for (const blocked of BLOCKED_SOURCE_PATTERNS) {
    if (combined.includes(blocked)) {
      return {
        tier: 'tier3',
        reliabilityScore: 1,
        isOfficial: false,
        isSpecialist: false,
        isBlocked: true,
        matchedRule: `Blocked source pattern: ${blocked}`,
        detectedOriginalSource: detectedOriginal,
        domain,
      };
    }
  }

  // 2. Check Tier 1 (Official & Major Financial Wire)
  for (const t1 of TIER1_KEYWORDS) {
    if (combined.includes(t1)) {
      const isOfficial = t1.includes('.gov') || t1.includes('nasa') || t1.includes('faa') || t1.includes('sec') || combined.includes('.gov') || combined.includes('spacex.com') || combined.includes('blog.google') || combined.includes('ir.tesla.com') || combined.includes('blogs.microsoft.com') || combined.includes('blogs.nvidia.com');
      return {
        tier: 'tier1',
        reliabilityScore: isOfficial ? 10 : 10,
        isOfficial,
        isSpecialist: false,
        isBlocked: false,
        matchedRule: `Tier 1: ${t1}`,
        detectedOriginalSource: detectedOriginal,
        domain,
      };
    }
  }

  // 3. Check Company Specialist Whitelists (Upgrades matching company source to Tier 2 with high score)
  if (matchedCompanyIds && matchedCompanyIds.length > 0) {
    for (const compId of matchedCompanyIds) {
      const whitelist = COMPANY_SPECIALIST_SOURCES[compId];
      if (whitelist) {
        for (const spec of whitelist) {
          if (combined.includes(spec)) {
            return {
              tier: 'tier2',
              reliabilityScore: 9,
              isOfficial: false,
              isSpecialist: true,
              isBlocked: false,
              matchedRule: `Company Specialist (${compId}): ${spec}`,
              detectedOriginalSource: detectedOriginal,
              domain,
            };
          }
        }
      }
    }
  }

  // 4. Check Tier 2 (General Specialist & Trusted Tech/Business Media)
  for (const t2 of TIER2_KEYWORDS) {
    if (combined.includes(t2)) {
      return {
        tier: 'tier2',
        reliabilityScore: 9,
        isOfficial: false,
        isSpecialist: true,
        isBlocked: false,
        matchedRule: `Tier 2: ${t2}`,
        detectedOriginalSource: detectedOriginal,
        domain,
      };
    }
  }

  // 5. Default Tier 3 (Discovery / General RSS / Aggregators / Unknown)
  return {
    tier: 'tier3',
    reliabilityScore: 6,
    isOfficial: false,
    isSpecialist: false,
    isBlocked: false,
    matchedRule: 'Tier 3: Discovery / General RSS',
    detectedOriginalSource: detectedOriginal,
    domain,
  };
}
