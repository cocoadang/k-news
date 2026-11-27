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

const trackedIssues = [
  { label: ['테슬라 오스틴 로보택시', 'Tesla Austin robotaxi'], subject: /(?=.*tesla|.*테슬라)(?=.*robotaxi|.*로보택시)(?=.*austin|.*오스틴)/i },
  { label: ['SpaceX 궤도 데이터센터', 'SpaceX orbital data centers'], subject: /(?=.*space\s*x|.*스페이스\s*x)(?=.*data[ -]?cent(?:er|re)|.*데이터\s*센터)(?=.*orbital|.*in space|.*궤도|.*우주)/i },
  { label: ['SpaceX 애리조나 AI 시설', 'SpaceX Arizona AI facility'], subject: /(?=.*space\s*x|.*스페이스\s*x)(?=.*arizona|.*애리조나)(?=.*\bai\b|.*data[ -]?cent(?:er|re)|.*데이터\s*센터)/i },
] as const;

const milestones = [
  { id: 'approval', pattern: /\b(?:approves?|approved|grants? (?:a |the )?permit)\b|승인(?:했다|됐다|받아|\s*완료)|인허가\s*획득/i },
  { id: 'application', pattern: /\b(?:files?|filed|submits?|submitted|applies?)\b.{0,35}\b(?:application|permit|fcc)\b|허가\s*신청|승인\s*신청/i },
  { id: 'expansion', pattern: /\b(?:expands?|expanded)\b.{0,45}\b(?:service|area|geofence|coverage)\b|운행\s*(?:지역|구역)\s*확대/i },
  { id: 'opening', pattern: /\b(?:launches?|launched|starts?|begins?)\b.{0,45}\b(?:service|operations|rides|construction)\b|운행\s*개시|시범\s*운영\s*시작|착공/i },
  { id: 'agreement', pattern: /\b(?:signs?|signed|secures?|secured)\b.{0,45}\b(?:deal|agreement|contract)\b|(?:전력|용수)\s*계약\s*체결/i },
  { id: 'announcement', pattern: /\b(?:announces?|unveils?|details?|reveals?)\b.{0,45}\b(?:plans?|proposal)\b|계획\s*(?:공개|발표)/i },
] as const;

export type IssueFlow = { title: readonly [string, string]; entries: NewsEvent[] };

export function buildIssueFlows(events: NewsEvent[]) {
  const byEvent = new Map<string, IssueFlow>();
  for (const issue of trackedIssues) {
    const entriesByStage = new Map<string, NewsEvent>();
    const members: NewsEvent[] = [];
    for (const event of events) {
      if (!newsTime(event) || event.contentType === 'rumor' || event.contentType === 'analyst_opinion') continue;
      const title = event.originalTitle || event.title;
      if (!issue.subject.test(title) || /\?|\b(?:could|might|seeks? approval|denied|rejected|not approved)\b|미승인|승인\s*거부|가능성/i.test(title)) continue;
      const stage = milestones.find(step => step.pattern.test(title));
      if (!stage) continue;
      members.push(event);
      const previous = entriesByStage.get(stage.id);
      if (!previous || newsTime(event) < newsTime(previous)) entriesByStage.set(stage.id, event);
    }
    const entries = [...entriesByStage.values()].sort((a, b) => newsTime(a) - newsTime(b));
    if (entries.length < 2 || newsTime(entries.at(-1)!) - newsTime(entries[0]) > 365 * 86400_000) continue;
    const flow = { title: issue.label, entries };
    for (const member of members) byEvent.set(member.id, flow);
  }
  return byEvent;
}
