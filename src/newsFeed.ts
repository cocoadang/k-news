import { isFingerprintSpecific, spaceDataCenterApprovalFingerprint } from '../shared/eventFingerprint';
import type { NewsEvent } from './types';

const windowMs = 72 * 60 * 60 * 1000;
const newsTime = (event: NewsEvent) =>
  Date.parse(event.primarySource?.publishedAt || event.firstSeenAt) || Date.parse(event.updatedAt || '') || 0;

export function groupNewsFeed(events: NewsEvent[]): NewsEvent[] {
  const sorted = [...events].sort((a, b) => newsTime(b) - newsTime(a));
  const groups = new Map<string, NewsEvent>();
  const feed: NewsEvent[] = [];
  for (const event of sorted) {
    const fingerprint = spaceDataCenterApprovalFingerprint(event.originalTitle || event.primarySource?.title || event.title)
      || event.eventFingerprint;
    if (!isFingerprintSpecific(fingerprint)) {
      feed.push(event);
      continue;
    }
    const key = fingerprint!;
    const first = groups.get(key);
    if (!first || !newsTime(event) || newsTime(first) - newsTime(event) > windowMs) {
      const group = { ...event };
      groups.set(key, group);
      feed.push(group);
      continue;
    }
    const sources = new Map([first.primarySource, ...(first.relatedSources || []), event.primarySource, ...(event.relatedSources || [])]
      .map(source => [source.url, source]));
    sources.delete(first.primarySource.url);
    first.relatedSources = [...sources.values()];
    first.articleCount = Math.max(first.articleCount, event.articleCount, 1 + sources.size);
    first.relatedCompanies = [...new Set([...(first.relatedCompanies || []), ...(event.relatedCompanies || [])])];
    const knownCompanies = new Set(first.companyImpacts?.map(impact => impact.companyId));
    first.companyImpacts = [...(first.companyImpacts || []), ...(event.companyImpacts || []).filter(impact => !knownCompanies.has(impact.companyId))];
  }
  return feed;
}

const starshipMilestones = [
  {id: 'catch', pattern: /\b(?:first|historic)\b.{0,45}\b(?:catch|capture|caught)\b|\bcatch(?:es)?\b.{0,45}\b(?:upper stage|from orbit)\b|첫\s*(?:상단부\s*)?포획|상단부\s*첫\s*포획|궤도.{0,16}귀환.{0,8}포획/i},
  {id: 'fuel', pattern: /\b(?:refuelling|refueling|propellant transfer)\b.{0,35}\b(?:milestone|progress|advance)\b|연료\s*보급\s*진전/i},
  {id: 'cryo', pattern: /\b(?:flight 17|17th (?:test )?flight)\b.{0,95}\b(?:cryogenic|cryo)\b|\b(?:cryogenic|cryo)\b.{0,95}\b(?:flight 17|17th (?:test )?flight)\b|17차\s*비행.{0,55}극저온\s*시험/i},
] as const;

const trackedIssues = [
  { companyId: 'spacex', label: ['SpaceX 스타십 개발', 'SpaceX Starship development'], subject: /\bstarship\b|스타십/i, stages: starshipMilestones },
  { companyId: 'tsla', label: ['테슬라 오스틴 로보택시', 'Tesla Austin robotaxi'], subject: /(?=.*tesla|.*테슬라)(?=.*robotaxi|.*로보택시)(?=.*austin|.*오스틴)/i },
  { companyId: 'spacex', label: ['SpaceX 궤도 데이터센터', 'SpaceX orbital data centers'], subject: /(?=.*space\s*x|.*스페이스\s*x)(?=.*data[ -]?cent(?:er|re)|.*데이터\s*센터)(?=.*orbital|.*in space|.*궤도|.*우주)/i },
  { companyId: 'spacex', label: ['SpaceX 애리조나 AI 시설', 'SpaceX Arizona AI facility'], subject: /(?=.*space\s*x|.*스페이스\s*x)(?=.*arizona|.*애리조나)(?=.*\bai\b|.*data[ -]?cent(?:er|re)|.*데이터\s*센터)/i },
  {
    companyId: 'tsla',
    label: ['테슬라 사이버캡 출시', 'Tesla Cybercab rollout'],
    subject: /\bcybercabs?\b|사이버캡/i,
    stages: [
      {id: 'berlinPlan', pattern: /\b(?:targets?|aims?)\b.{0,70}\b(?:production|manufacturing)\b.{0,40}\b(?:giga )?berlin\b|기가\s*베를린.{0,35}사이버캡\s*생산.{0,14}목표/i},
      {id: 'sales', pattern: /\btesla\b.{0,24}\bstart(?:s|ed)? selling cybercabs?\b|테슬라.{0,15}사이버캡\s*판매\s*시작/i},
    ],
  },
  {
    companyId: 'nvda',
    label: ['NVIDIA 베라 루빈', 'NVIDIA Vera Rubin'],
    subject: /\bvera rubin\b|베라\s*루빈/i,
    stages: [
      {id: 'benchmark', pattern: /\bmlperf\b.{0,70}\b(?:training|endpoints|debut)\b|MLPerf.{0,40}(?:학습|엔드포인트)/i},
      {id: 'supply', pattern: /\bexpands? supply chain capacity\b|공급망\s*생산능력\s*확대/i},
      {id: 'cloud', pattern: /\bexpands? microsoft ai collaboration\b|마이크로소프트와\s*AI\s*협력\s*확대/i},
    ],
  },
  {
    companyId: 'googl',
    label: ['구글 AI 모드 확장', 'Google AI Mode rollout'],
    subject: /\bai mode\b|AI\s*모드/i,
    stages: [
      {id: 'defaultModel', pattern: /\bgemini 4 hydrogen\b.{0,30}\bdefault\b|기본값.{0,20}제미나이\s*4\s*하이드로젠/i},
      {id: 'searchIntegrations', pattern: /\bwallet\b.{0,14}\bdrive\b.{0,20}\bgemini app integrations\b|월렛.{0,8}드라이브.{0,10}제미나이\s*앱\s*연동/i},
    ],
  },
  {
    companyId: 'msft',
    label: ['마이크로소프트 Copilot 확장', 'Microsoft Copilot rollout'],
    subject: /\bcopilot\b|코파일럿/i,
    stages: [
      {id: 'workspaces', pattern: /\bunveils? copilot workspaces\b|Copilot\s*Workspaces.{0,24}공개/i},
      {id: 'dynamics', pattern: /\bintroducing dynamics 365 in copilot\b|코파일럿에\s*다이내믹스\s*365\s*도입/i},
      {id: 'appSearch', pattern: /\brefresh(?:es)? copilot app search\b|코파일럿\s*앱\s*검색\s*기능\s*개편/i},
    ],
  },
] as const;

const milestones = [
  { id: 'approval', pattern: /\b(?:approves?|approved|grants? (?:a |the )?permit)\b|승인(?:했다|됐다|받아|\s*완료)|인허가\s*획득/i },
  { id: 'application', pattern: /\b(?:files?|filed|submits?|submitted|applies?)\b.{0,35}\b(?:application|permit|fcc)\b|허가\s*신청|승인\s*신청/i },
  { id: 'expansion', pattern: /\b(?:expands?|expanded)\b.{0,45}\b(?:service|area|geofence|coverage)\b|운행\s*(?:지역|구역)\s*확대/i },
  { id: 'opening', pattern: /\b(?:launches?|launched|starts?|begins?)\b.{0,45}\b(?:service|operations|rides|construction)\b|운행\s*개시|시범\s*운영\s*시작|착공/i },
  { id: 'agreement', pattern: /\b(?:signs?|signed|secures?|secured)\b.{0,45}\b(?:deal|agreement|contract)\b|(?:전력|용수)\s*계약\s*체결/i },
  { id: 'announcement', pattern: /\b(?:announces?|unveils?|details?|reveals?)\b.{0,45}\b(?:plans?|proposal)\b|계획\s*(?:공개|발표)/i },
] as const;

const stageLabels = {
  berlinPlan: ['베를린 생산 목표 보도', 'Berlin production target reported'],
  sales: ['판매 시작', 'Sales begin'],
  benchmark: ['MLPerf 성능 공개', 'MLPerf results'],
  supply: ['공급망 생산능력 확대', 'Supply capacity expands'],
  cloud: ['마이크로소프트 협력 확대', 'Microsoft collaboration expands'],
  defaultModel: ['기본 모델 변경', 'Default model changes'],
  searchIntegrations: ['월렛·드라이브·제미나이 연동', 'Wallet, Drive and Gemini integration'],
  workspaces: ['Workspaces 공개', 'Workspaces unveiled'],
  dynamics: ['Dynamics 365 연동', 'Dynamics 365 integration'],
  appSearch: ['앱 검색 개편', 'App search updated'],
  catch: ['첫 포획', 'First catch'],
  fuel: ['연료 보급 진전', 'Refueling progress'],
  cryo: ['17차 비행 시험 준비', 'Flight 17 test preparation'],
  approval: ['승인', 'Approval'],
  application: ['신청', 'Application'],
  expansion: ['운영 확대', 'Expansion'],
  opening: ['운영 시작·착공', 'Opening or construction'],
  agreement: ['계약 체결', 'Agreement'],
  announcement: ['계획 발표', 'Plan announced'],
} as const;

type StageId = keyof typeof stageLabels;
type IssueStep = {id: StageId; event: NewsEvent; date: number; label: readonly [string, string]};
export type IssueFlow = { title: readonly [string, string]; entries: IssueStep[] };

export function buildIssueFlows(events: NewsEvent[], companyId: string) {
  const byEvent = new Map<string, IssueFlow>();
  for (const issue of trackedIssues) {
    if (issue.companyId !== companyId) continue;
    const entriesByStage = new Map<StageId, NewsEvent>();
    const members: NewsEvent[] = [];
    for (const event of events) {
      if (!newsTime(event) || event.contentType === 'rumor' || event.contentType === 'analyst_opinion') continue;
      const titles = [event.originalTitle || event.title, event.titleKo].filter((title): title is string => Boolean(title));
      if (/^.*(?:\?|\b(?:could|might|seeks? approval|denied|rejected|not approved)\b|미승인|승인\s*거부|가능성)/i.test(titles[0])) continue;
      const stages = 'stages' in issue ? issue.stages : milestones;
      const stage = stages.find(step => titles.some(title => issue.subject.test(title) && step.pattern.test(title)));
      if (!stage) continue;
      members.push(event);
      const previous = entriesByStage.get(stage.id);
      if (!previous || newsTime(event) < newsTime(previous)) entriesByStage.set(stage.id, event);
    }
    const entries = [...entriesByStage].map(([id, event]) => ({id, event, date: newsTime(event), label: stageLabels[id]}))
      .sort((a, b) => a.date - b.date);
    const latest = entries.at(-1);
    if (entries.length < 2 || !latest || latest.date - entries[0].date > 365 * 86400_000) continue;
    const flow = { title: issue.label, entries };
    for (const member of members) byEvent.set(member.id, flow);
  }
  return byEvent;
}
