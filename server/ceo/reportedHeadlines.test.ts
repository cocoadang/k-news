import test from 'node:test';
import assert from 'node:assert/strict';
import { reportedCeoStatements, cleanHeadline } from './reportedHeadlines';

// Fictional headlines for structure tests only.
const ev = (title: string, at: string, url: string, snippet = '', tier = 'tier2') => ({ sourceTier: tier, primarySource: { name: 'Wire', url, title, publishedAt: at, snippet } });

test('Musk headlines split by Tesla/SpaceX, deduplicated, earliest KST date kept', () => {
  const out = reportedCeoStatements([
    ev('Musk says Tesla robotaxi expands - Outlet A', '2026-10-22T11:00:00Z', 'https://a.example/1'),
    ev('Musk says Tesla robotaxi expands', '2026-10-21T23:30:00Z', 'https://b.example/2'),
    ev("Elon Musk's Tesla claims record demand", '2026-10-21T00:00:00Z', 'https://c.example/3'),
    ev('Musk says SpaceX rocket flies', '2026-10-21T00:00:00Z', 'https://d.example/4'),
    ev('Tesla sales fall in Europe', '2026-10-21T00:00:00Z', 'https://e.example/5'),
    ev('Musk says Tesla Optimus ready', '2026-10-21T00:00:00Z', 'https://f.example/6', '', 'blocked'),
    ev("Airline CEO responds after Elon Musk said he'd switch to Tesla", '2026-10-21T00:00:00Z', 'https://g.example/7'),
  ]);
  const tsla = out.filter(s => s.companyId === 'tsla'), spx = out.filter(s => s.companyId === 'spacex');
  assert.equal(tsla.length, 1); assert.equal(spx.length, 1);
  assert.equal(tsla[0].quoteText, 'Musk says Tesla robotaxi expands');
  assert.equal(tsla[0].referenceDate.value, '2026-10-22');
  assert.equal(tsla[0].reportedSourceCount, 2);
});

test('other CEOs and quotes inside article snippets', () => {
  const out = reportedCeoStatements([
    ev('Nvidia CEO Jensen Huang says demand is insane', '2026-10-01T00:00:00Z', 'https://h.example/1'),
    ev('Microsoft earnings beat', '2026-10-02T00:00:00Z', 'https://h.example/2', 'On the call, Satya Nadella told analysts “we are capacity constrained through the end of the fiscal year” as Azure grew.'),
    ev('Pichai to speak at summit', '2026-10-03T00:00:00Z', 'https://h.example/3', 'Pichai to speak at summit Outlet'),
  ]);
  assert.deepEqual(out.map(s => [s.personId, s.companyId, s.kind]).sort(), [['jensen-huang', 'nvda', 'reported_headline'], ['satya-nadella', 'msft', 'reported_excerpt']]);
  assert.equal(out.find(s => s.kind === 'reported_excerpt')!.quoteText, 'we are capacity constrained through the end of the fiscal year');
});

test('outlet suffix is stripped', () => {
  assert.equal(cleanHeadline('Musk says Tesla X - WHEC.com'), 'Musk says Tesla X');
});
