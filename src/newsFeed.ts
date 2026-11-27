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
