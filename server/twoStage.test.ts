import test from 'node:test';
import assert from 'node:assert/strict';
import { db } from './db';
import { createUnanalyzedEvent, runTwoStageAnalysis } from './geminiAnalyzer';
import { _setIsFirestoreAvailableForTesting } from './firestore';
import { NewsEvent, RawArticle } from './types';

test('two-stage diagnostics', async () => {
  _setIsFirestoreAvailableForTesting(false);
  const now = new Date('2026-10-15T02:00:00Z');
  const ev = (id: string) => ({ ...createUnanalyzedEvent({ id, title: `Google community overview ${id}`, link: `https://example.com/${id}`, source: 'Reuters',
    publishedAt: now.toISOString(), firstSeenAt: now.toISOString(), snippet: 'Confirmed product context and company facts provided by the news source. '.repeat(2) } as RawArticle), id, updatedAt: now.toISOString() });
  const commit = async (expected: NewsEvent, patch: Partial<NewsEvent>) => { const c = db.getEventById(expected.id); if (!c) return null; const s = { ...c, ...patch, updatedAt: now.toISOString() }; db.syncEventFromCloud(s); return s; };
  const generate = async (prompt: string) => { const items = JSON.parse(prompt.slice(prompt.lastIndexOf('\n') + 1)); return { text: JSON.stringify({ items: items.map((e: any) => ({ id: e.id, score: 2, reason: '잠정', uncertain: false })) }), usageMetadata: { totalTokenCount: 100 } }; };
  db._setEventsForTesting(Array.from({ length: 20 }, (_, i) => ev(`low-${i}`)) as any);
  const r = await runTwoStageAnalysis({ now, generate, analyze: async () => { throw new Error('x'); }, commit });
  const e0: any = db.getEventById('low-0');
  console.log(`::warning title=twoStage::${JSON.stringify(r)} | status=${e0?.analysisStatus} skip=${e0?.skipReason} firstSeen=${e0?.firstSeenAt} deferred=${e0?.analysisDeferredReason}`);
  assert.ok(true);
});
