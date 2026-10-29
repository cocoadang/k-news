/** 예시 데이터 파일 생성 CLI: 첫 인자 경로에 src/ceo/exampleDataset.ts 내용을 씁니다 (없으면 표준출력). */
import fs from 'node:fs';
import { buildExampleDataset, renderExampleModule } from './generateExample';

buildExampleDataset().then(ds => {
  const out = renderExampleModule(ds);
  const target = process.argv[2];
  if (target) fs.writeFileSync(target, out, 'utf8'); else process.stdout.write(out);
}).catch(e => { console.error(e); process.exit(1); });
