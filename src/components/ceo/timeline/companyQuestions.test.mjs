import test from 'node:test';
import assert from 'node:assert/strict';
import { companyQuestions, effectiveDate, literalMetrics, isComparableClaim, displayText } from './companyQuestions.mjs';

// Synthetic, clearly fictional fixtures. No production data.
const st = (id, companyId, quoteText, extra = {}) => ({ statementId: id, personId: 'p', companyId, kind: 'direct_quote', quoteText, ...extra });
const rel = v => ({ referenceDate: { value: v, basis: 'released', precision: 'day' } });

test('company-specific questions, oldest first, isolated by company', () => {
  const data = [
    st('b', 'nvda', 'Demand for Blackwell is amazing', rel('2025-02-26')),
    st('a', 'nvda', 'Hopper demand remains strong', rel('2024-08-28')),
    st('x', 'msft', 'Demand is strong', rel('2025-01-01')),
  ];
  const r = companyQuestions(data, 'p', 'nvda');
  const demand = r.questions.find(q => q.id === 'demand');
  assert.deepEqual(demand.items.map(x => x.statement.statementId), ['a', 'b']);
  assert.deepEqual(demand.range, ['2024-08-28', '2025-02-26']);
  assert.equal(demand.comparable, true);
  assert.ok(r.questions.find(q => q.id === 'platform'));
  assert.equal(r.total, 2);
});

test('editor notes and greetings are excluded, never classified', () => {
  const data = [
    st('n', 'googl', 'Editor’s note: Today the CEO spoke about Search.'),
    st('g', 'googl', 'Mr. Secretary-General, it is a privilege to join you.'),
    st('t', 'googl', 'President Macron, thank you for the invitation.'),
    st('c', 'googl', 'Search has strong momentum.', { referenceDate: { value: '2026-10-28', basis: 'written', precision: 'day' } }),
  ];
  const r = companyQuestions(data, 'p', 'googl');
  assert.equal(r.excludedCount, 3);
  assert.deepEqual(r.questions.map(q => q.id), ['search']);
  assert.equal(r.questions[0].comparable, false);
  assert.equal(isComparableClaim({ kind: 'paraphrase', quoteText: 'Search' }), false);
});

test('effective date keeps its basis; spoken beats release; invalid dates are unknown', () => {
  assert.deepEqual(effectiveDate({ spokenAt: { precision: 'day', value: '2026-06-04' }, ...rel('2026-06-05') }), { value: '2026-06-04', basis: 'spoken', label: '발언일' });
  assert.equal(effectiveDate(rel('2025-05-28')).basis, 'released');
  assert.equal(effectiveDate({ referenceDate: { value: '2025-02-30', basis: 'released', precision: 'day' } }).value, null);
  assert.equal(effectiveDate({}).basis, 'unknown');
});

test('metrics are copied literally from the quote, not computed', () => {
  assert.deepEqual(literalMetrics('Revenue grew 63%, exceeding $20 billion, backlog over $460 billion.'), ['63%', '$20 billion', '$460 billion']);
  assert.deepEqual(literalMetrics('Demand is strong.'), []);
});

test('display text prefers reviewed translation, then AI title, then original', () => {
  assert.equal(displayText({ quoteText: 'x', translationKo: { status: 'reviewed', text: '번역' } }).kind, 'translation');
  assert.equal(displayText({ quoteText: 'x', translationKo: { status: 'missing' }, koSummary: { status: 'ready', title: '제목' } }).kind, 'ai_title');
  assert.equal(displayText({ quoteText: 'x', koSummary: { status: 'failed' } }).kind, 'original');
});

test('unknown company falls back to generic questions; empty data invents nothing', () => {
  assert.equal(companyQuestions([], 'p', 'zzzz').questions.length, 0);
  const r = companyQuestions([st('z', 'zzzz', 'Capital expenditures will rise', rel('2026-01-01'))], 'p', 'zzzz');
  assert.deepEqual(r.questions.map(q => q.id), ['investment']);
});

test('reported headlines are comparable but labelled by report date', () => {
  const h = { statementId: 'r', personId: 'p', companyId: 'tsla', kind: 'reported_headline', quoteText: 'Elon Musk Says Tesla Megapacks Are Nearly Sold Out', referenceDate: { value: '2026-10-25', basis: 'reported', precision: 'day' } };
  const r = companyQuestions([h], 'p', 'tsla');
  assert.ok(r.questions.find(q => q.id === 'energy'));
  assert.equal(r.questions[0].items[0].date.label, '기사 보도일');
});
