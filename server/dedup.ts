import { RawArticle, NewsEvent } from './types';
import { computeNormalizedTitle } from './firestore';
import { OpenAITextClient as GoogleGenAI, resolveOpenAIModel } from './openaiClient';
import { db } from './db';
import { areFingerprintsMatching, spaceDataCenterApprovalFingerprint } from '../shared/eventFingerprint';
export { areFingerprintsMatching, isFingerprintSpecific, spaceDataCenterApprovalFingerprint } from '../shared/eventFingerprint';

// 0. Compute normalized URL
export function computeNormalizedUrl(url: string): string {
  if (!url) return '';
  return url.trim().toLowerCase().split('?')[0].replace(/\/+$/, '');
}

export function getStoredEventFingerprint(event: NewsEvent): string {
  const title = event.originalTitle || event.primarySource?.title || event.title;
  return spaceDataCenterApprovalFingerprint(title) || event.eventFingerprint || computeEventFingerprint(
    title, (event.factualPoints || event.summaryBulletPoints || []).join(' '), event.relatedCompanies
  );
}

/**
 * Generates a deterministic event fingerprint for cross-outlet duplicate detection.
 * Combines:
 * - company (e.g. tsla, nvda, msft, googl, spacex)
 * - period (q1~q4, 1~4분기)
 * - core product / model (ai5, hw4, fsd, robotaxi, blackwell, starship, etc.)
 * - normalized event topic (deliveries, earnings, ram_reduction, launch, flight_test, capex, etc.)
 * - topic modifier/direction (beat, miss, surge, cut, etc.)
 * - key metric / percentage / numbers ($10b, 5%, etc.)
 */
export function computeEventFingerprint(
  title: string,
  snippet: string = '',
  companyHints?: string[] | string
): string {
  const approval = spaceDataCenterApprovalFingerprint(title);
  if (approval) return approval;
  const combined = `${title} ${snippet}`.toLowerCase();

  // 1. Company Detection
  let company = '';
  const hintArray = Array.isArray(companyHints)
    ? companyHints.map(h => String(h).toLowerCase())
    : typeof companyHints === 'string'
    ? [companyHints.toLowerCase()]
    : [];

  if (hintArray.some(h => h.includes('tesla') || h === 'tsla') || /tesla|테슬라|tsla|elon musk/.test(combined)) {
    company = 'tsla';
  } else if (hintArray.some(h => h.includes('nvidia') || h === 'nvda') || /nvidia|엔비디아|nvda|jensen huang/.test(combined)) {
    company = 'nvda';
  } else if (hintArray.some(h => h.includes('google') || h.includes('alphabet') || h === 'googl') || /google|alphabet|구글|알파벳|googl|waymo|deepmind/.test(combined)) {
    company = 'googl';
  } else if (hintArray.some(h => h.includes('microsoft') || h === 'msft') || /microsoft|마이크로소프트|msft|azure/.test(combined)) {
    company = 'msft';
  } else if (hintArray.some(h => h.includes('spacex')) || /spacex|스페이스x|starship|starlink|falcon 9/.test(combined)) {
    company = 'spacex';
  } else if (hintArray.length > 0) {
    company = hintArray[0].replace(/[^a-z0-9]/g, '');
  }

  // 2. Period Detection (Q1~Q4, 1분기~4분기, specific fiscal quarter)
  let period = '';
  if (/(?:q3|3분기|third\s*quarter|3rd\s*quarter)/i.test(combined)) {
    period = 'q3';
  } else if (/(?:q4|4분기|fourth\s*quarter|4th\s*quarter)/i.test(combined)) {
    period = 'q4';
  } else if (/(?:q1|1분기|first\s*quarter|1st\s*quarter)/i.test(combined)) {
    period = 'q1';
  } else if (/(?:q2|2분기|second\s*quarter|2nd\s*quarter)/i.test(combined)) {
    period = 'q2';
  }

  // 3. Product / Model / Hardware
  let product = '';
  if (/ai5|ai 5|hw5|hardware 5/.test(combined)) {
    product = 'ai5';
  } else if (/hw4|hardware 4/.test(combined)) {
    product = 'hw4';
  } else if (/robotaxi|cybercab|로보택시|사이버캡/.test(combined)) {
    product = 'robotaxi';
  } else if (/fsd|full self[- ]driving|자율주행/.test(combined)) {
    product = 'fsd';
  } else if (/optimus|옵티머스/.test(combined)) {
    product = 'optimus';
  } else if (/megapack|메가팩/.test(combined)) {
    product = 'megapack';
  } else if (/cybertruck|사이버트럭/.test(combined)) {
    product = 'cybertruck';
  } else if (/blackwell|b200|gb200|b100/.test(combined)) {
    product = 'blackwell';
  } else if (/rubin/.test(combined)) {
    product = 'rubin';
  } else if (/h100|h200|hopper/.test(combined)) {
    product = 'hopper';
  } else if (/starship|super heavy|스타십/.test(combined)) {
    if (/flight 5|flight5/.test(combined)) product = 'starship_flight5';
    else if (/flight 6|flight6/.test(combined)) product = 'starship_flight6';
    else if (/flight 7|flight7/.test(combined)) product = 'starship_flight7';
    else product = 'starship';
  } else if (/starlink|스타링크/.test(combined)) {
    product = 'starlink';
  } else if (/starshield|스타실드/.test(combined)) {
    product = 'starshield';
  } else if (/waymo|웨이모/.test(combined)) {
    product = 'waymo';
  } else if (/gemini|제미나이/.test(combined)) {
    product = 'gemini';
  } else if (/copilot|코파일럿/.test(combined)) {
    product = 'copilot';
  }

  // 4. Normalized Event Topic
  let topic = '';
  if (/ram reduction|reduce ram|memory reduction|ram\s*축소|메모리\s*감축|ram\s*삭감/.test(combined)) {
    topic = 'ram_reduction';
  } else if (/deliver(?:y|ies)|vehicle deliver(?:y|ies)|차량\s*인도(?:량)?|인도량|출하량/.test(combined)) {
    topic = 'deliveries';
  } else if (/earnings|financial results|revenue|profit|operating income|net income|실적|매출|영업이익|순이익/.test(combined)) {
    topic = 'earnings';
  } else if (/capex|capital expenditure|설비투자/.test(combined)) {
    topic = 'capex';
  } else if (/contract|procurement|deal|partnership|수주|계약|체결/.test(combined)) {
    topic = 'contract';
  } else if (/flight test|orbital flight|liftoff|발사|시험발사/.test(combined)) {
    topic = 'flight_test';
  } else if (/launch|unveil|debut|release|출시|공개|발표/.test(combined)) {
    topic = 'launch';
  } else if (/antitrust|probe|investigation|lawsuit|doj|ftc|sec|반독점|조사|기소|제재/.test(combined)) {
    topic = 'regulatory';
  } else if (/faa approval|license|permit|승인|허가|인가/.test(combined)) {
    topic = 'approval';
  }

  // 5. Modifier / Direction / Outcome
  let modifier = '';
  if (/beat(?:s|ing)?|topped|tops|exceed(?:s|ed|ing)?|surpass(?:ed|es)?|상회|서프라이즈|깜짝/.test(combined)) {
    modifier = 'beat';
  } else if (/miss(?:es|ed)?|trailed|below\s*estimates|하회|쇼크/.test(combined)) {
    modifier = 'miss';
  } else if (/shares\s*rise|surges?|jump(?:s|ed)?|rally|급등|상승/.test(combined)) {
    modifier = 'surge';
  } else if (/cut|slash(?:ed)?|delay(?:ed)?|postpone(?:d)?|삭감|인하|연기/.test(combined)) {
    modifier = 'cut';
  }

  // 6. Key Numbers / Amounts / Percentages
  let metric = '';
  const percentMatch = combined.match(/(\d+(?:\.\d+)?%)/);
  if (percentMatch) {
    metric = percentMatch[1];
  } else {
    const moneyMatch = combined.match(/\$[\d,.]+(\s*(?:billion|million|trillion|b|m))/);
    if (moneyMatch) {
      metric = moneyMatch[0].replace(/\s+/g, '');
    }
  }

  const parts = [company, product, period, topic, modifier, metric].filter(Boolean);
  if (parts.length === 0) {
    return computeNormalizedTitle(title).slice(0, 40);
  }

  return parts.join(':');
}

// 1. Calculate Jaccard similarity between two string word sets
export function calculateWordOverlap(titleA: string, titleB: string): number {
  const normA = computeNormalizedTitle(titleA);
  const normB = computeNormalizedTitle(titleB);

  if (normA === normB) return 1.0;

  const wordsA = new Set(normA.split(' ').filter(w => w.length > 2));
  const wordsB = new Set(normB.split(' ').filter(w => w.length > 2));

  if (wordsA.size === 0 || wordsB.size === 0) return 0;

  let common = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) common++;
  }

  const union = new Set([...wordsA, ...wordsB]).size;
  return common / union;
}

// 2. Extract key entities & numbers (e.g. $10B, Blackwell, Starship, Flight 6, Q3, DOJ)
export function extractKeyEntities(text: string): string[] {
  const entities: string[] = [];
  const lower = text.toLowerCase();

  // Financial values
  const moneyMatch = text.match(/\$[\d,.]+(\s*(billion|million|trillion|b|m))?/gi);
  if (moneyMatch) entities.push(...moneyMatch.map(m => m.toLowerCase()));

  // Version/Model identifiers
  const keywords = [
    'blackwell', 'b200', 'gb200', 'rubin', 'h100', 'h200', 'tpu',
    'starship', 'flight 5', 'flight 6', 'flight 7', 'super heavy', 'starlink', 'starshield', 'direct to cell',
    'fsd v13', 'fsd v14', 'robotaxi', 'cybercab', 'optimus', 'megapack',
    'gemini 1.5', 'gemini 2.0', 'gemini 2.5', 'gemini 3.0', 'gemini 3.7', 'deepmind', 'waymo',
    'copilot', 'azure ai', 'openai o1', 'openai o3'
  ];

  for (const kw of keywords) {
    if (lower.includes(kw)) {
      entities.push(kw);
    }
  }

  return entities;
}

// 3. Fallback / fast semantic comparison
export function areArticlesSameEventRuleBased(
  article: RawArticle,
  existingEvent: NewsEvent
): { isSame: boolean; confidence: number; reason: string } {
  // Step 1: URL match
  if (existingEvent.primarySource.url === article.link || existingEvent.relatedSources?.some(s => s.url === article.link)) {
    return { isSame: true, confidence: 1.0, reason: 'URL Exactly Matched' };
  }

  // Step 2: Normalized Title similarity
  const titleOverlap = Math.max(
    calculateWordOverlap(article.title, existingEvent.originalTitle || ''),
    calculateWordOverlap(article.title, existingEvent.title)
  );

  if (titleOverlap >= 0.60) {
    return { isSame: true, confidence: titleOverlap, reason: 'High Title Word Overlap (>60%)' };
  }

  // Step 3: Entity + Company match within recent 48 hours
  const eventTime = new Date(existingEvent.firstSeenAt || existingEvent.updatedAt).getTime();
  const articleTime = new Date(article.publishedAt || article.firstSeenAt).getTime();
  const hoursDiff = Math.abs(eventTime - articleTime) / (1000 * 60 * 60);

  if (hoursDiff <= 48) {
    const artEntities = extractKeyEntities(article.title + ' ' + article.snippet);
    const evtEntities = extractKeyEntities(existingEvent.title + ' ' + (existingEvent.originalTitle || '') + ' ' + (existingEvent.summaryBulletPoints || []).join(' '));

    const commonEntities = artEntities.filter(e => evtEntities.includes(e));
    if (commonEntities.length >= 2 && titleOverlap >= 0.35) {
      return { isSame: true, confidence: 0.85, reason: `Shared Key Entities (${commonEntities.join(', ')}) & Related Context` };
    }
  }

  return { isSame: false, confidence: titleOverlap, reason: 'Different Event' };
}

// Company alias map for cross-referencing
const COMPANY_ALIAS_MAP: Record<string, string[]> = {
  msft: ['microsoft', 'msft', 'azure', '마이크로소프트', 'copilot'],
  googl: ['google', 'alphabet', 'googl', 'goog', '구글', '알파벳', 'waymo', 'deepmind'],
  tsla: ['tesla', 'tsla', '테슬라', 'musk', 'robotaxi', 'cybercab'],
  spacex: ['spacex', 'starship', 'starlink', 'space x', 'starshield', 'super heavy'],
  nvda: ['nvidia', 'nvda', '엔비디아', 'blackwell', 'jensen huang', 'geforce'],
};

// Check if article and existing event share the same company
export function doArticleAndEventShareCompany(article: RawArticle, existingEvent: NewsEvent): boolean {
  // 1. Direct matchedCompanyIds check
  const artCompanyIds = (article.matchedCompanyIds || []).map(id => id.toLowerCase());
  const evtCompanyIds = (existingEvent.companyImpacts || []).map(c => c.companyId.toLowerCase());
  
  // Also check relatedCompanies string
  const evtCompanyNames = (existingEvent.relatedCompanies || []).map(n => n.toLowerCase());

  for (const [compId, aliases] of Object.entries(COMPANY_ALIAS_MAP)) {
    const artHasComp = artCompanyIds.includes(compId) || aliases.some(alias => 
      article.title.toLowerCase().includes(alias) || article.snippet.toLowerCase().includes(alias)
    );
    const evtHasComp = evtCompanyIds.includes(compId) || 
      evtCompanyNames.some(name => aliases.some(alias => name.includes(alias))) ||
      aliases.some(alias => 
        existingEvent.title.toLowerCase().includes(alias) || 
        (existingEvent.originalTitle || '').toLowerCase().includes(alias)
      );

    if (artHasComp && evtHasComp) {
      return true;
    }
  }

  return false;
}

// Related category groups for proximity check
const RELATED_CATEGORY_GROUPS: string[][] = [
  ['실적 / 재무', '기업가치 / 자금조달', '공급망 / CAPEX', 'IPO / 주식', 'financial_result', 'official_announcement'],
  ['AI 가속기 / 반도체', 'AI 모델 / Agent', '클라우드 / 데이터센터', 'product_event', 'official_announcement'],
  ['자율주행 / Robotaxi', 'product_event', 'regulatory_event'],
  ['Starship / 우주인프라', 'Starlink / 통신', '국방 / 정부계약', 'regulatory_event'],
  ['규제 / 반독점', 'regulatory_event'],
  ['에너지 / 배터리', 'product_event', '공급망 / CAPEX']
];

export function areCategoriesOrTypesRelated(
  artCategories: string[] | undefined,
  artText: string,
  evtCategory: string,
  evtContentType?: string
): boolean {
  const normEvtCat = evtCategory.toLowerCase();
  const normEvtType = (evtContentType || '').toLowerCase();
  const normArtText = artText.toLowerCase();

  // Keyword-based financial & strategic indicators
  const financialKeywords = ['revenue', 'sales', 'earnings', 'profit', 'quarterly', 'financial', 'restructuring', 'disclose', 'capex', 'guidance', '실적', '매출', '재무'];
  const productKeywords = ['launch', 'release', 'model', 'chip', 'unveil', 'announces', 'sets date', 'date', '공개', '발표', '출시'];
  const spaceKeywords = ['starship', 'launch', 'faa', 'flight', 'rocket', 'orbit', '발사', '승인'];
  const autoKeywords = ['robotaxi', 'fsd', 'cybercab', 'autonomous', '자율주행', '로보택시'];

  const isArtFinancial = financialKeywords.some(k => normArtText.includes(k));
  const isEvtFinancial = normEvtCat.includes('실적') || normEvtCat.includes('재무') || normEvtType.includes('financial');
  if (isArtFinancial && isEvtFinancial) return true;

  const isArtProduct = productKeywords.some(k => normArtText.includes(k));
  const isEvtProduct = normEvtCat.includes('모델') || normEvtCat.includes('가속기') || normEvtType.includes('product');
  if (isArtProduct && isEvtProduct) return true;

  const isArtSpace = spaceKeywords.some(k => normArtText.includes(k));
  const isEvtSpace = normEvtCat.includes('우주') || normEvtCat.includes('starship');
  if (isArtSpace && isEvtSpace) return true;

  const isArtAuto = autoKeywords.some(k => normArtText.includes(k));
  const isEvtAuto = normEvtCat.includes('자율주행') || normEvtCat.includes('robotaxi');
  if (isArtAuto && isEvtAuto) return true;

  // Group membership check
  for (const group of RELATED_CATEGORY_GROUPS) {
    const evtMatches = group.some(g => normEvtCat.includes(g.toLowerCase()) || normEvtType.includes(g.toLowerCase()));
    if (evtMatches) {
      const artMatches = group.some(g => normArtText.includes(g.toLowerCase()) || (artCategories || []).some(c => c.toLowerCase().includes(g.toLowerCase())));
      if (artMatches) return true;
    }
  }

  return false;
}

// 4. Determine if an incoming article is a valid candidate for Gemini Semantic Verification
export function isCandidateForGeminiClustering(
  article: RawArticle,
  existingEvent: NewsEvent
): { isCandidate: boolean; reason: string; priorityScore: number } {
  // Condition 1: Time window within 48 hours
  const eventTime = new Date(existingEvent.firstSeenAt || existingEvent.updatedAt).getTime();
  const articleTime = new Date(article.publishedAt || article.firstSeenAt).getTime();
  const hoursDiff = Math.abs(eventTime - articleTime) / (1000 * 60 * 60);

  if (hoursDiff > 48) {
    return { isCandidate: false, reason: `Outside 48-hour window (${hoursDiff.toFixed(1)}h)`, priorityScore: 0 };
  }

  // Condition 2: Same company matching
  const sharesCompany = doArticleAndEventShareCompany(article, existingEvent);
  if (!sharesCompany) {
    return { isCandidate: false, reason: 'Different company', priorityScore: 0 };
  }

  // Condition 3: Category or content type proximity
  const artText = `${article.title} ${article.snippet}`;
  const isRelatedTopic = areCategoriesOrTypesRelated(article.categories, artText, existingEvent.category, existingEvent.contentType);

  // Calculate lexical word overlap as priority metric (not a cutoff)
  const titleOverlap = Math.max(
    calculateWordOverlap(article.title, existingEvent.originalTitle || ''),
    calculateWordOverlap(article.title, existingEvent.title)
  );

  // Common entity count
  const artEntities = extractKeyEntities(artText);
  const evtEntities = extractKeyEntities(existingEvent.title + ' ' + (existingEvent.originalTitle || '') + ' ' + (existingEvent.summaryBulletPoints || []).join(' '));
  const commonEntities = artEntities.filter(e => evtEntities.includes(e));

  // Strict semantic candidate conditions to minimize unnecessary Gemini calls:
  // 1) Both share at least 2 common key entities (e.g. ['b200', 'gb200'] or ['$10b', 'blackwell']) OR
  // 2) Share at least 1 key entity AND title word overlap >= 15% (0.15) OR
  // 3) Title word overlap is moderately high (>= 25%, 0.25) AND topics are closely related
  const hasStrongEntityOverlap = commonEntities.length >= 2;
  const hasEntityAndModerateOverlap = commonEntities.length >= 1 && titleOverlap >= 0.15;
  const hasHighWordOverlapAndTopic = titleOverlap >= 0.25 && isRelatedTopic;

  if (hasStrongEntityOverlap || hasEntityAndModerateOverlap || hasHighWordOverlapAndTopic) {
    // Priority score: higher = checked first
    const recencyBonus = Math.max(0, (48 - hoursDiff) / 48) * 30; // up to 30 pts
    const overlapBonus = titleOverlap * 40; // up to 40 pts
    const entityBonus = commonEntities.length * 20; // up to 40 pts
    const topicBonus = isRelatedTopic ? 10 : 0;
    const priorityScore = recencyBonus + overlapBonus + entityBonus + topicBonus;

    const matchReason = hasStrongEntityOverlap
      ? `Shared Entities (${commonEntities.join(', ')})`
      : hasEntityAndModerateOverlap
      ? `Entity (${commonEntities.join(', ')}) & Title Overlap ${(titleOverlap * 100).toFixed(0)}%`
      : `Title Overlap ${(titleOverlap * 100).toFixed(0)}% with Related Topic`;

    return {
      isCandidate: true,
      reason: `${matchReason} within ${hoursDiff.toFixed(1)}h`,
      priorityScore,
    };
  }

  return {
    isCandidate: false,
    reason: `엔티티 중복 부족 (${commonEntities.length}개) 및 단어 유사도 낮음 (${(titleOverlap * 100).toFixed(0)}%) - Gemini 검증 스킵`,
    priorityScore: 0,
  };
}

// 5. Gemini-Powered Ambiguity Resolver focused on Core Investment Fact
export async function verifySameEventWithGemini(
  ai: Pick<GoogleGenAI, 'models'> | null,
  articleTitle: string,
  articleSnippet: string,
  existingEventTitle: string,
  existingEventSummary: string,
  context?: {
    existingOriginalTitle?: string;
    existingInvestmentImplications?: string;
  }
): Promise<boolean> {
  if (!ai) return false;

  const modelId = resolveOpenAIModel();

  // Truncate snippet and summary to save tokens
  const cleanSnippet = (articleSnippet || '').slice(0, 300);
  const cleanSummary = (existingEventSummary || '').slice(0, 300);
  const cleanImplications = context?.existingInvestmentImplications ? context.existingInvestmentImplications.slice(0, 200) : '';

  const prompt = `당신은 글로벌 헤지펀드의 시니어 투자 분석가입니다.
두 기사가 **투자자 관점에서 동일한 핵심 사건/공시/이슈(Core Investment Fact)**를 다루고 있는지 판단하십시오.

언론사(Reuters, Bloomberg, CNBC, WSJ, Yahoo Finance 등)마다 헤드라인 어휘, 문장 구조, 논조가 다를 수 있습니다.
단순히 문장이나 단어가 일치하는지가 아니라, **"투자자가 주시하는 실질적인 사건의 본질"**이 같은지 여부를 엄격히 판단하십시오.

----------------------------------------
[판단 기준 가이드라인]

1. SAME (동일 사건 병합):
- 동일 기업의 동일한 발표, 공시, 실적, 정책 변경, 계약 체결 등을 서로 다른 언론사가 각자의 어휘로 보도한 경우
- 동일 사건에 대한 단순 사후 해설, 후속 분석, 추가 코멘트, 사설 기사

2. DIFFERENT (별개의 독립 사건):
- 명백히 다른 별개의 프로젝트, 다른 제품, 다른 파트너십/소송 이슈인 경우
- 시간의 흐름에 따라 실질적으로 새로운 핵심 사실(New Material Fact)이 발생한 경우

----------------------------------------
[기사 A (신규 수집 기사)]
- 제목: ${articleTitle}
- 요약: ${cleanSnippet}

[기사 B (기존 등록 이벤트)]
- 한국어 제목: ${existingEventTitle}
- 영문 원제: ${context?.existingOriginalTitle || 'N/A'}
- 사실 요약: ${cleanSummary}
${cleanImplications ? `- 투자 시사점: ${cleanImplications}` : ''}

----------------------------------------
답변 규칙:
부연 설명 없이 오직 "SAME" (동일 사건) 또는 "DIFFERENT" (별개 사건) 단어 하나로만 답변하십시오.`;

  try {
    const response = await ai.models.generateContent({
      model: modelId,
      contents: prompt,
      config: {
        maxOutputTokens: 256,
        temperature: 0.0,
      },
    });

    if (response.usageMetadata) {
      const { promptTokenCount, candidatesTokenCount, totalTokenCount } = response.usageMetadata;
      db.addLog(
        'Gemini',
        'info',
        `[Token Usage: semantic_dedup] prompt: ${promptTokenCount ?? 0}, output: ${candidatesTokenCount ?? 0}, total: ${totalTokenCount ?? 0}`
      );
    }

    const answer = response.text?.trim().toUpperCase();
    return answer?.includes('SAME') ?? false;
  } catch (e) {
    return false;
  }
}
