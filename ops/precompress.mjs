// 빌드 후 정적 파일(js/css/svg)을 미리 압축(.br, .gz)해 둡니다. 서버는 브라우저가 지원하면 압축본을 보냅니다.
// 추가 패키지 없이 Node 내장 zlib만 사용합니다.
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { brotliCompressSync, gzipSync, constants } from 'node:zlib';

const dir = process.argv[2] || 'dist/assets';
let n = 0;
for (const name of readdirSync(dir)) {
  if (!/\.(js|css|svg|json)$/.test(name)) continue;
  const file = join(dir, name);
  if (statSync(file).size < 1024) continue;
  const raw = readFileSync(file);
  writeFileSync(file + '.br', brotliCompressSync(raw, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }));
  writeFileSync(file + '.gz', gzipSync(raw, { level: 9 }));
  n++;
}
console.log(`precompressed ${n} files in ${dir}`);
