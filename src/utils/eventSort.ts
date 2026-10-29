import { NewsEvent } from '../types';

/**
 * Calculates the effective publication time for a NewsEvent to ensure
 * true chronological sorting (newest first).
 *
 * Priority:
 * 1. Primary source actual publishedAt timestamp
 * 2. firstSeenAt (system collection time)
 * 3. createdAt (fallback)
 * 4. updatedAt (fallback)
 */
export function getEventEffectiveTime(event: NewsEvent): number {
  if (event.primarySource?.publishedAt) {
    const pub = new Date(event.primarySource.publishedAt).getTime();
    if (!isNaN(pub) && pub > 0) {
      return pub;
    }
  }

  if (event.firstSeenAt) {
    const firstSeen = new Date(event.firstSeenAt).getTime();
    if (!isNaN(firstSeen) && firstSeen > 0) {
      return firstSeen;
    }
  }

  if (event.updatedAt) {
    const updated = new Date(event.updatedAt).getTime();
    if (!isNaN(updated) && updated > 0) {
      return updated;
    }
  }

  return 0;
}

/**
 * Robust descending comparator prioritizing primarySource.publishedAt, then firstSeenAt.
 */
export function compareEventsLatestFirst(a: NewsEvent, b: NewsEvent): number {
  const timeA = new Date(a.primarySource?.publishedAt || a.firstSeenAt).getTime();
  const timeB = new Date(b.primarySource?.publishedAt || b.firstSeenAt).getTime();
  const safeA = isNaN(timeA) || timeA <= 0 ? new Date(a.updatedAt || 0).getTime() || 0 : timeA;
  const safeB = isNaN(timeB) || timeB <= 0 ? new Date(b.updatedAt || 0).getTime() || 0 : timeB;
  return safeB - safeA;
}
