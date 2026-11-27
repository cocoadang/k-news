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
  strictEqual(buildIssueFlows([launch, duplicate, differentCity, speculation]).size, 0);
  const flows = buildIssueFlows([duplicate, speculation, launch, expansion, differentCity]);
  deepStrictEqual(flows.get('c')?.entries.map(item => item.id), ['a', 'c']);
  strictEqual(flows.has('d'), false);
  strictEqual(flows.has('e'), false);
});

test('Starship separates the first catch from preparations for a different flight', () => {
  const catch1 = event('one', 'SpaceX catches Starship upper stage for the first time', '2026-11-21');
  const catch2 = event('two', 'Starship achieves historic first catch from orbit', '2026-11-22');
  const cryo = event('three', 'SpaceX Starship Flight 17 booster begins cryogenic testing', '2026-11-24');
  deepStrictEqual(buildIssueFlows([catch2, cryo, catch1]).get('three')?.entries.map(item => item.id), ['one', 'three']);
});
