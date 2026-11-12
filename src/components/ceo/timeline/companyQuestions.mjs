// Company-specific comparison questions for CEO statements.
// Classification reads only the stored original quote (never a model summary or headline),
// so each assignment can be checked against the words that triggered it.

/** @typedef {{id:string,label:string,hint:string,re:RegExp,en?:[string,string]}} Question */

/** @type {Record<string, Question[]>} */
export const COMPANY_QUESTIONS = {
  nvda: [
    { id: 'demand', label: 'AI 수요는 얼마나 강하다고 말했나?', hint: '수요 강도·공급 부족 표현', en: ['How strong did they say AI demand is?', 'Demand strength, supply shortage'], re: /\b(demand|sold out|off the charts|growing exponentially)\b/gi },
    { id: 'platform', label: '주력 제품 세대는 어떻게 바뀌었나?', hint: 'Hopper → Blackwell → Rubin', en: ['How did the flagship product generation change?', 'Hopper → Blackwell → Rubin'], re: /\b(Hopper|Blackwell|Rubin|Grace|NVLink)\b/gi },
    { id: 'phase', label: 'AI 산업 국면을 어떻게 진단했나?', hint: '산업혁명·변곡점·AI 팩토리', en: ['How did they diagnose the AI industry phase?', 'Industrial revolution, inflection point, AI factory'], re: /\b(industrial revolution|age of AI|inflection point|AI factor(?:y|ies)|AI race|infrastructure expansion)\b/gi },
    { id: 'profit', label: 'AI의 수익성은 어떻게 설명했나?', hint: '매출·이익·토큰당 비용', en: ['How did they explain AI profitability?', 'Revenue, profit, cost per token'], re: /\b(revenue|profitab\w*|profitable|cost per token)\b/gi },
  ],
  googl: [
    { id: 'cloud', label: 'Cloud·AI 인프라 성장은 어떻게 달라졌나?', hint: '클라우드 매출·수주잔고·TPU·인프라', en: ['How has Cloud / AI infrastructure growth changed?', 'Cloud revenue, backlog, TPU, infrastructure'], re: /\b(Google Cloud|Cloud (?:accelerated|revenues?|growth)|for Cloud growth|TPU|backlog|AI infrastructure|data centers)\b/gi },
    { id: 'search', label: '검색은 AI로 어떻게 변했나?', hint: '검색·쿼리·AI Mode', en: ['How has Search changed with AI?', 'Search, queries, AI Mode'], re: /\b(Search|quer(?:y|ies)|AI Mode|AI Overviews)\b/g },
    { id: 'gemini', label: 'Gemini 사용량과 모델 성과는?', hint: '사용자 수·토큰 처리량', en: ['Gemini usage and model progress?', 'Users, token throughput'], re: /\b(Gemini|tokens|model capabilities|monthly active users|usage|shipping product)\b/gi },
    { id: 'ai-investment', label: 'AI 투자 효과를 어떻게 설명했나?', hint: 'AI 투자·풀스택 전략', en: ['How did they explain returns on AI investment?', 'AI investment, full-stack strategy'], re: /\b(AI investments?|investment in AI|full[- ]stack)\b/gi },
    { id: 'vision', label: 'AI의 장기적 의미를 어떻게 말했나?', hint: '기술 비전·낙관론', en: ['What did they say AI means long term?', 'Tech vision, optimism'], re: /\b(once[- ]in[- ]a[- ]\w+|foundational enabler|optimistic about AI|next frontiers?|human potential|benefit humanity|AI agents)\b/gi },
    { id: 'results', label: '분기 실적 평가는 어떻게 달라졌나?', hint: '분기 총평·매출 성장률', en: ['How has their quarterly assessment changed?', 'Quarter overview, revenue growth'], re: /\b(quarter|revenues? grew|run rate|quarterly revenue)\b/gi },
  ],
  msft: [
    { id: 'demand', label: 'AI 수요·효율을 어떻게 봤나?', hint: '수요 전망·효율 지표', en: ['How did they view AI demand and efficiency?', 'Demand outlook, efficiency'], re: /\b(demand|tokens per watt|efficient|accessible)\b/gi },
    { id: 'agents', label: '에이전트·AI 플랫폼 전략은?', hint: 'Agent·Copilot·CoreAI', en: ['Agents and AI platform strategy?', 'Agents, Copilot, CoreAI'], re: /\b(agent\w*|Copilot|CoreAI|platform shift|model-forward|AI stack)\b/gi },
    { id: 'security', label: '보안 우선 원칙은 어떻게 제시됐나?', hint: '보안·신뢰·SFI', en: ['How was the security-first principle framed?', 'Security, trust, SFI'], re: /\b(secur\w*|trust\w*|cyber\w*|SFI)\b/gi },
    { id: 'org', label: '조직·인력 운영은 어떻게 설명했나?', hint: '감원·조직 개편', en: ['How did they explain org and headcount changes?', 'Layoffs, reorganization'], re: /\b(job eliminations|layoffs|headcount|new division|engineering organization|those who have left)\b/gi },
    { id: 'capex', label: 'AI 설비투자에 대한 언급은?', hint: 'CapEx', en: ['What did they say about AI CapEx?', 'CapEx'], re: /\b(CapEx|capital expenditures?)\b/gi },
  ],
  tsla: [
    { id: 'autonomy', label: '자율주행·로보택시 전망은?', hint: 'FSD·Robotaxi·Cybercab', en: ['Outlook for autonomy and robotaxis?', 'FSD, Robotaxi, Cybercab'], re: /\b(self-driving|FSD|robotaxis?|Cybercab|autonom\w*)\b/gi },
    { id: 'optimus', label: 'Optimus(휴머노이드)를 어떻게 말했나?', hint: '휴머노이드 로봇', en: ['What did they say about Optimus (humanoid)?', 'Humanoid robot'], re: /\b(Optimus)\b/gi },
    { id: 'energy', label: '에너지·Megapack 수요는?', hint: 'Megapack·에너지 저장', en: ['Energy and Megapack demand?', 'Megapack, energy storage'], re: /\b(Megapacks?|energy|battery)\b/gi },
    { id: 'demand', label: '차량 수요·생산 판단은?', hint: '수요·생산', en: ['Vehicle demand and production?', 'Demand, production'], re: /\b(demand|production|deliver\w*|sold out|vehicles?)\b/gi },
    { id: 'merger', label: 'SpaceX 합병에 대한 입장은?', hint: '합병·결합', en: ['Stance on a SpaceX merger?', 'Merger, combination'], re: /\b(merg\w*|tie-up|combin\w*)\b/gi },
    { id: 'value', label: '테슬라 가치의 원천을 어떻게 봤나?', hint: '기업가치', en: ["Where did they see Tesla's value coming from?", 'Valuation'], re: /\b(value|valuation)\b/gi },
  ],
  openai: [
    { id: 'agi', label: 'AGI·초지능은 언제 온다고 봤나?', hint: 'AGI·초지능·시점', en: ['When did they expect AGI / superintelligence?', 'AGI, superintelligence, timing'], re: /\b(AGI|superintelligence|singularity|artificial general intelligence)\b/gi },
    { id: 'compute', label: '컴퓨팅·데이터센터 투자 규모는?', hint: 'GPU·데이터센터·전력', en: ['Scale of compute / data center investment?', 'GPUs, data centers, power'], re: /\b(compute|GPUs?|data ?cent(?:er|re)s?|Stargate|gigawatts?|chips?|energy)\b/gi },
    { id: 'products', label: '제품·모델 출시 계획은?', hint: 'ChatGPT·GPT·출시', en: ['Product and model launch plans?', 'ChatGPT, GPT, launches'], re: /\b(ChatGPT|GPT-?\d[\w.]*|o\d|Sora|launch\w*|release\w*|model)\b/g },
    { id: 'business', label: '매출·사용자·사업 구조는?', hint: '매출·사용자·구조', en: ['Revenue, users and business structure?', 'Revenue, users, structure'], re: /\b(revenue|users?|subscri\w*|nonprofit|for-profit|PBC|IPO|valuation)\b/gi },
    { id: 'jobs', label: 'AI가 일자리·경제에 미칠 영향은?', hint: '일자리·경제', en: ["AI's impact on jobs and the economy?", 'Jobs, economy'], re: /\b(jobs?|work(?:ers|force)?|economy|economic|productivity|abundance)\b/gi },
    { id: 'safety', label: '안전·규제를 어떻게 말했나?', hint: '안전·규제·정렬', en: ['What did they say about safety and regulation?', 'Safety, regulation, alignment'], re: /\b(safety|safe|regulat\w*|alignment|risks?|government)\b/gi },
  ],
  anthropic: [
    { id: 'timeline', label: '강력한 AI는 언제 온다고 봤나?', hint: '강력한 AI·시점', en: ['When did they expect powerful AI?', 'Powerful AI, timing'], re: /\b(powerful AI|AGI|country of geniuses|20\d\d|timelines?)\b/gi },
    { id: 'safety', label: '안전·해석 가능성 연구를 어떻게 말했나?', hint: '안전·해석·정렬', en: ['What did they say about safety and interpretability research?', 'Safety, interpretability, alignment'], re: /\b(safety|interpretability|alignment|risks?|misuse|responsible scaling)\b/gi },
    { id: 'policy', label: '수출 통제·중국·정책 입장은?', hint: '수출통제·중국·규제', en: ['Stance on export controls, China and policy?', 'Export controls, China, regulation'], re: /\b(export controls?|China|Chinese|DeepSeek|regulat\w*|policy|legislation|government)\b/gi },
    { id: 'economy', label: 'AI가 일자리·경제에 미칠 영향은?', hint: '일자리·경제', en: ["AI's impact on jobs and the economy?", 'Jobs, economy'], re: /\b(jobs?|unemployment|white-collar|economy|economic|GDP|labor)\b/gi },
    { id: 'benefits', label: '의학·과학 등 AI의 혜택 전망은?', hint: '의학·과학·생물학', en: ['Expected benefits of AI in medicine and science?', 'Medicine, science, biology'], re: /\b(biology|medicine|disease|cancer|science|scientific|health)\b/gi },
    { id: 'business', label: '사업·컴퓨팅 투자 판단은?', hint: '매출·컴퓨팅·고객', en: ['Business and compute investment decisions?', 'Revenue, compute, customers'], re: /\b(revenue|customers?|enterprise|compute|data ?cent(?:er|re)s?|Claude)\b/gi },
  ],
  bridgewater: [
    { id: 'debt', label: '부채 사이클·국가부채를 어떻게 봤나?', hint: '부채·적자·채권', en: ['How did they view the debt cycle and national debt?', 'Debt, deficits, bonds'], re: /\b(debts?|deficits?|debt cycle|borrow\w*|bonds?)\b/gi },
    { id: 'order', label: '세계 질서·미중 관계 판단은?', hint: '중국·지정학·전쟁', en: ['Views on world order and US–China relations?', 'China, geopolitics, war'], re: /\b(China|Chinese|world order|geopolit\w*|wars?|conflicts?)\b/gi },
    { id: 'money', label: '화폐·금·인플레이션 전망은?', hint: '금·달러·화폐 가치', en: ['Outlook on money, gold and inflation?', 'Gold, dollar, currency value'], re: /\b(gold|currenc\w*|dollars?|money printing|inflation|bitcoin)\b/gi },
    { id: 'markets', label: '시장·자산배분을 어떻게 조언했나?', hint: '분산·주식·버블', en: ['What market / asset-allocation advice did they give?', 'Diversification, stocks, bubbles'], re: /\b(portfolios?|diversif\w*|stocks?|equit\w*|asset allocation|bubbles?)\b/gi },
    { id: 'politics', label: '미국 정치·사회 분열을 어떻게 진단했나?', hint: '양극화·포퓰리즘·민주주의', en: ['How did they diagnose US political and social division?', 'Polarization, populism, democracy'], re: /\b(polariz\w*|populis\w*|democra\w*|civil war|political)\b/gi },
    { id: 'ai', label: 'AI·기술이 경제에 미칠 영향은?', hint: 'AI·기술·생산성', en: ['Impact of AI and technology on the economy?', 'AI, technology, productivity'], re: /\b(AI|artificial intelligence|technolog\w*|productivity)\b/g },
  ],
  pershing: [
    { id: 'positions', label: '주요 투자 종목을 어떻게 판단했나?', hint: '보유 종목', en: ['How did they assess key holdings?', 'Holdings'], re: /\b(Howard Hughes|Chipotle|Hilton|Alphabet|Google|Uber|Brookfield|Nike|Fannie Mae|Freddie Mac|Universal Music|Restaurant Brands|Canadian Pacific|Lowe['’]?s|Hertz|Amazon|Meta)\b/g },
    { id: 'rates', label: '금리·인플레이션 전망은?', hint: '금리·연준·국채', en: ['Outlook on rates and inflation?', 'Rates, Fed, Treasuries'], re: /\b(interest rates?|inflation|the Fed\b|Federal Reserve|Treasur\w*|bond markets?)\b/gi },
    { id: 'strategy', label: '투자 철학·전략은?', hint: '현금흐름·장기·집중투자', en: ['Investment philosophy and strategy?', 'Cash flow, long term, concentration'], re: /\b(durable|predictable|free cash flow|moats?|long[- ]term|concentrated|activis\w*)\b/gi },
    { id: 'performance', label: '성과를 어떻게 설명했나?', hint: 'NAV·수익률', en: ['How did they explain performance?', 'NAV, returns'], re: /\b(NAV|net asset value|returns?|performance|outperform\w*|S&P 500)\b/gi },
    { id: 'listing', label: '신규 펀드·상장 계획은?', hint: 'IPO·상장·PSUS', en: ['New fund / listing plans?', 'IPO, listing, PSUS'], re: /\b(IPO|listing|Pershing Square USA|PSUS|closed-end fund)\b/gi },
  ],
  spacex: [
    { id: 'space-ai', label: '우주 AI 인프라(AI 위성) 구상은?', hint: 'AI 위성·우주 데이터센터', en: ['Plans for space AI infrastructure (AI satellites)?', 'AI satellites, space data centers'], re: /\b(AI satellites?|satellites?|data cent(?:er|re)s?)\b/gi },
    { id: 'missions', label: '유인 우주비행·NASA 협력은?', hint: 'NASA·JAXA·ESA', en: ['Crewed spaceflight and NASA cooperation?', 'NASA, JAXA, ESA'], re: /\b(NASA|JAXA|ESA|astronauts?|crew|dream come true)\b/gi },
  ],
};

// Fallback for companies without curated questions (e.g. Tesla once data exists).
export const GENERIC_QUESTIONS = [
  { id: 'investment', label: 'AI 투자 방향은 어떻게 달라졌나?', hint: '투자·설비', en: ['How has the direction of AI investment changed?', 'Investment, CapEx'], re: /\b(capex|capital expenditures?|investments?)\b/gi },
  { id: 'demand', label: '수요·공급 판단은 어떻게 달라졌나?', hint: '수요·공급·사용량', en: ['How has the demand/supply view changed?', 'Demand, supply, usage'], re: /\b(demand|supply|capacity|usage|adoption)\b/gi },
  { id: 'revenue', label: '매출·수익화 근거는 어떻게 달라졌나?', hint: '매출·이익', en: ['How has the evidence for revenue / monetization changed?', 'Revenue, profit'], re: /\b(revenue|monetiz\w*|profit\w*)\b/gi },
  { id: 'strategy', label: '경쟁·제휴 방향은 어떻게 달라졌나?', hint: '제휴·경쟁', en: ['How has the competition / partnership direction changed?', 'Partnerships, competition'], re: /\b(partner\w*|compet\w*|strategy)\b/gi },
];

// Text that is not the CEO's own substantive claim: editor notes, greetings, ceremonial remarks.
const NOT_A_CLAIM = [
  /^editor[’']?s note/i,
  /^(?:mr\.|ms\.|madam\b|president\b|provost\b|excellencies\b|ladies and gentlemen\b)/i,
  /thank you for the invitation/i,
  /commencement speech/i,
  /\bhaircut\b/i,
];

export function isComparableClaim(statement) {
  const q = ['direct_quote', 'reported_headline', 'reported_excerpt', 'video_quote', 'social_post'].includes(statement?.kind) ? String(statement.quoteText || '').trim() : '';
  return !!q && !NOT_A_CLAIM.some(re => re.test(q));
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const valid = v => typeof v === 'string' && DATE_RE.test(v) && !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;

/**
 * Best date to place a statement on the timeline, with an explicit basis.
 * spoken: date stated in the source text; released: press release date; written: post date.
 */
export function effectiveDate(statement) {
  const sp = statement?.spokenAt;
  if (sp?.precision === 'day' && valid(sp.value)) return { value: sp.value, basis: 'spoken', label: '발언일' };
  const rd = statement?.referenceDate;
  if (rd?.precision === 'day' && valid(rd.value)) {
    if (rd.basis === 'spoken') return { value: rd.value, basis: 'spoken', label: '발언일' };
    if (rd.basis === 'released') return { value: rd.value, basis: 'released', label: '보도자료 발표일' };
    if (rd.basis === 'written') return { value: rd.value, basis: 'written', label: '게시일' };
    if (rd.basis === 'reported') return { value: rd.value, basis: 'reported', label: '기사 보도일' };
    if (rd.basis === 'video') return { value: rd.value, basis: 'video', label: '영상 게시일' };
  }
  return { value: null, basis: 'unknown', label: '날짜 미확인' };
}

// Numbers that appear literally in the quote (e.g. 63%, $460 billion, 7 billion, 3x).
export function literalMetrics(text) {
  const out = String(text || '').match(/\$?\d[\d,.]*\s?(?:%|percent|(?:half-)?(?:trillion|billion|million)(?:-dollar)?|x\b)|\b(?:half-trillion|first-ever \$\d+ billion)\b/gi) || [];
  return [...new Set(out.map(s => s.replace(/\s+/g, ' ').trim()))].slice(0, 4);
}

/** Korean display text: reviewed translation > ready AI summary title > original quote. */
export function displayText(s) {
  if (s?.translationKo?.status === 'reviewed' && s.translationKo.text) return { text: s.translationKo.text, kind: 'translation' };
  if (['video_quote', 'reported_headline', 'reported_excerpt', 'social_post'].includes(s?.kind) && s.aiTranslationKo) return { text: s.aiTranslationKo, kind: 'ai_translation' };
  if (s?.koSummary?.status === 'ready' && s.koSummary.title) return { text: s.koSummary.title, kind: 'ai_title' };
  return { text: String(s?.quoteText || ''), kind: 'original' };
}

export const COMPANY_LABELS = { nvda: 'NVIDIA', msft: 'Microsoft', googl: 'Google', tsla: 'Tesla', spacex: 'SpaceX', bridgewater: 'Bridgewater', pershing: 'Pershing Square', openai: 'OpenAI', anthropic: 'Anthropic' };

/**
 * Questions for one person across one or more companies (e.g. Musk: Tesla + SpaceX).
 * Each statement is classified only by its own company's questions. With several companies,
 * question ids are prefixed by company and labels show the company name.
 * Each statement may answer more than one question.
 * Returns only questions with at least one statement, oldest-first items, plus excluded counts.
 */
export function companyQuestions(statements, personId, companyIds) {
  const ids = Array.isArray(companyIds) ? companyIds : [companyIds];
  const multi = ids.length > 1;
  const scoped = (statements || []).filter(s => s.personId === personId && ids.includes(s.companyId));
  const claims = scoped.filter(isComparableClaim);
  const assigned = new Set();
  const questions = ids.flatMap(companyId => {
    const defs = COMPANY_QUESTIONS[companyId] || GENERIC_QUESTIONS;
    const own = claims.filter(s => s.companyId === companyId);
    return defs.map(def => {
      const items = own.flatMap(s => {
        const terms = [...new Set((String(s.quoteText).match(def.re) || []).map(t => t.trim()))];
        if (!terms.length) return [];
        assigned.add(s.statementId);
        return [{ statement: s, matchedTerms: terms, date: effectiveDate(s), metrics: literalMetrics(s.quoteText) }];
      }).sort((a, b) => (a.date.value || '9999').localeCompare(b.date.value || '9999'));
      const dated = items.filter(x => x.date.value);
      return {
        id: multi ? companyId + ':' + def.id : def.id,
        label: multi ? (COMPANY_LABELS[companyId] || companyId) + ' · ' + def.label : def.label,
        hint: def.hint, companyId, items,
        labelEn: def.en ? (multi ? (COMPANY_LABELS[companyId] || companyId) + ' · ' + def.en[0] : def.en[0]) : null,
        hintEn: def.en ? def.en[1] : null,
        range: dated.length ? [dated[0].date.value, dated[dated.length - 1].date.value] : null,
        comparable: new Set(dated.map(x => x.date.value)).size >= 2,
      };
    });
  }).filter(q => q.items.length);
  const other = claims.filter(s => !assigned.has(s.statementId));
  return { questions, other, excludedCount: scoped.length - claims.length, total: scoped.length };
}
