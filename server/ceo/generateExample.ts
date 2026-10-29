/**
 * 예시 데이터셋 생성기: fixture 기사 → 캐시 → 데이터셋 → src/ceo/exampleDataset.ts 파일 내용.
 * 모델 호출·네트워크·운영 DB 없음. 파일 쓰기는 generateExampleCli.ts
 */
import { buildCeoDataset, emptyCeoCache, refreshCeoCache } from './pipeline';
import { createFixtureExtractor, EXAMPLE_ARTICLES, EXAMPLE_PERSONS, EXAMPLE_ROLES, EXAMPLE_TOPICS } from './fixtures';
import { CeoDataset } from '../../src/ceo/types';

export async function buildExampleDataset(): Promise<CeoDataset> {
  const extractor = createFixtureExtractor();
  const { cache } = await refreshCeoCache(EXAMPLE_ARTICLES, emptyCeoCache(), extractor, { now: () => new Date('2026-10-18T00:00:00Z') });
  const { dataset } = await buildCeoDataset(EXAMPLE_ARTICLES, cache, { persons: EXAMPLE_PERSONS, roles: EXAMPLE_ROLES, topics: EXAMPLE_TOPICS }, { extractor });
  return dataset;
}

export function renderExampleModule(ds: CeoDataset): string {
  return `/* 자동 생성 파일 (server/ceo/generateExample.ts). 직접 고치지 마세요.\n * 모든 인물·회사·매체·발언은 가상(예시)입니다. */\nimport { CeoDataset } from './types';\n\nexport const EXAMPLE_CEO_DATASET: CeoDataset = ${JSON.stringify(ds, null, 2)};\n`;
}
