import {deepStrictEqual, strictEqual} from 'node:assert';
import {test} from 'node:test';
import {buildIssueFlows} from './newsFeed';
import type {NewsEvent} from './types';

function event(id: string, title: string, time: string): NewsEvent {
  return {id, title, firstSeenAt: time, primarySource: {publishedAt: time}} as NewsEvent;
}

test('issue timelines require distinct milestones for the same project', () => {
  const launch = event('a', 'Tesla launches robotaxi service in Austin', '2026-06-01');
  const duplicate = event('b', 'Tesla starts robotaxi service in Austin', '2026-06-02');
  const expansion = event('c', 'Tesla expands robotaxi service in Austin', '2026-07-01');
  const differentCity = event('d', 'Tesla expands robotaxi service in Dallas', '2026-07-05');
  const speculation = event('e', 'Could Tesla expand robotaxi service in Austin?', '2026-07-06');
  strictEqual(buildIssueFlows([launch, duplicate, differentCity, speculation], 'tsla').size, 0);
  const flows = buildIssueFlows([duplicate, speculation, launch, expansion, differentCity], 'tsla');
  deepStrictEqual(flows.get('c')?.entries.map(item => item.event.id), ['a', 'c']);
  strictEqual(flows.has('d'), false);
  strictEqual(flows.has('e'), false);
});

test('Starship separates the first catch from preparations for a different flight', () => {
  const catch1 = event('one', 'SpaceX catches Starship upper stage for the first time', '2026-11-21');
  const catch2 = event('two', 'Starship achieves historic first catch from orbit', '2026-11-22');
  const cryo = event('three', 'SpaceX Starship Flight 17 booster begins cryogenic testing', '2026-11-24');
  const events = [catch2, cryo, catch1];
  strictEqual(buildIssueFlows(events, 'all').size, 0);
  strictEqual(buildIssueFlows(events, 'tsla').size, 0);
  deepStrictEqual(buildIssueFlows(events, 'spacex').get('three')?.entries.map(item => item.event.id), ['one', 'three']);
});

test('company-specific release and integration milestones stay in the matching tab', () => {
  const workspaces = event('workspaces', 'Microsoft Unveils Copilot Workspaces and Salesforce Deal', '2026-11-18');
  const dynamics = event('dynamics', 'Microsoft Ignite 2026: Introducing Dynamics 365 in Copilot', '2026-11-20');
  const events = [workspaces, dynamics];
  deepStrictEqual(buildIssueFlows(events, 'msft').get('dynamics')?.entries.map(step => step.id), ['workspaces', 'dynamics']);
  strictEqual(buildIssueFlows(events, 'nvda').size, 0);
});

test('Tesla, NVIDIA and Google articles produce distinct issue milestones', () => {
  const events = [
    event('berlin', 'Tesla Targets 2029 Cybercab Production Start In Giga Berlin With $3.3B Investment: Report', '2026-11-20'),
    event('sales', "Tesla Just Started Selling Cybercabs, Here's What It Means for a SpaceX and Tesla Merger", '2026-11-25'),
    event('benchmark', 'NVIDIA Vera Rubin NVL72 Achieves up to 2x Blackwell Ultra Performance in MLPerf Training v6.1', '2026-11-18'),
    event('supply', 'NVIDIA expands supply chain capacity for AI systems and Vera Rubin platforms', '2026-11-23'),
    event('kmodel', '구글, AI 모드 기본값을 제미나이 4 하이드로젠으로 변경', '2026-11-23'),
    event('apps', "Google's AI Mode Is Getting Wallet, Drive, and Gemini App Integrations", '2026-11-24'),
  ];
  for (const [companyId, entries] of [
    ['tsla', ['berlin', 'sales']],
    ['nvda', ['benchmark', 'supply']],
    ['googl', ['kmodel', 'apps']],
  ] as const) {
    const flows = buildIssueFlows(events, companyId);
    deepStrictEqual([...flows.keys()], [...entries]);
    deepStrictEqual(flows.get(entries[0])?.entries.map(step => step.event.id), [...entries]);
  }
});
