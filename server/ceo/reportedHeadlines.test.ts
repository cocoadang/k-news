import test from 'node:test';
import assert from 'node:assert/strict';
import { reportedMuskTeslaStatements, cleanHeadline } from './reportedHeadlines';

// Fictional headlines for structure tests only.
const ev = (title: string, at: string, url: string, tier = 'tier2') => ({ sourceTier: tier, primarySource: { name: 'Wire', url, title, publishedAt: at } });

test('only Musk-attributed Tesla headlines, deduplicated, earliest date kept', () => {
  const out = reportedMuskTeslaStatements([
    ev('Musk says Tesla robotaxi expands - Outlet A', '2026-10-22T11:00:00Z', 'https://a.example/1'),
    ev('Musk says Tesla robotaxi expands', '2026-10-21T23:30:00Z', 'https://b.example/2'),
    ev("Elon Musk's Tesla claims record demand", '2026-10-21T00:00:00Z', 'https://c.example/3'),
    ev('Musk says SpaceX rocket flies', '2026-10-21T00:00:00Z', 'https://d.example/4'),
    ev('Tesla sales fall in Europe', '2026-10-21T00:00:00Z', 'https://e.example/5'),
    ev('Musk says Tesla Optimus ready', '2026-10-21T00:00:00Z', 'https://f.example/6', 'blocked'),
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].kind, 'reported_headline');
  assert.equal(out[0].quoteText, 'Musk says Tesla robotaxi expands');
  assert.equal(out[0].referenceDate.value, '2026-10-22'); // 23:30Z = KST next day
  assert.equal(out[0].reportedSourceCount, 2);
});

test('outlet suffix is stripped', () => {
  assert.equal(cleanHeadline('Musk says Tesla X - WHEC.com'), 'Musk says Tesla X');
});
