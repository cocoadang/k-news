/**
 * 실제 Firestore SDK 어댑터 검증 — Firestore 에뮬레이터 전용 (운영 DB 금지).
 * 실행(PC, Firebase CLI + Java 11+, 영구 PATH 변경 없이 그 셸에서만 JAVA_HOME/PATH 지정):
 *   npx firebase emulators:exec --config server/ceo/testing/firebase.emulator.json --only firestore --project demo-ceo-test \
 *     "npx tsx server/ceo/ceoStore.firestore.test.ts"
 *   (emulators:exec가 FIRESTORE_EMULATOR_HOST=127.0.0.1:8080, GCLOUD_PROJECT=demo-ceo-test를 설정하고 끝나면 에뮬레이터를 종료)
 *   에뮬레이터 jar는 Firebase CLI 캐시에 미리 있어야 함(외부 통신 차단 상태에서 실행하므로 다운로드 불가)
 * 수동: 에뮬레이터를 따로 띄운 뒤 FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 GCLOUD_PROJECT=demo-ceo-test npx tsx server/ceo/ceoStore.firestore.test.ts
 * 안전장치: FIRESTORE_EMULATOR_HOST가 루프백이 아니거나 프로젝트 ID가 'demo-'로 시작하지 않으면 실행하지 않음.
 * 운영 자격 증명 불필요(에뮬레이터는 인증 없음). 매 실행마다 임의 이름의 테스트 컬렉션을 쓰고 끝나면 지움.
 */
import assert from 'node:assert';
import { randomUUID } from 'node:crypto';
import { Firestore } from '@google-cloud/firestore';
import { FirestoreCeoStateStore } from './firestoreStateStore';
import { runStoreContract } from './testing/storeContract';
import { LastResult } from './stateStore';
import { FirestoreKoLedger } from './koLedger';
import { runKoLedgerContract } from './testing/koLedgerContract';

const host = process.env.FIRESTORE_EMULATOR_HOST || '';
const projectId = process.env.GCLOUD_PROJECT || 'demo-ceo-test';
if (!/^(127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(host) || !projectId.startsWith('demo-')) {
  console.error(`거부: FIRESTORE_EMULATOR_HOST=${host || '(없음)'} project=${projectId} — 루프백 에뮬레이터 + demo- 프로젝트에서만 실행합니다.`);
  process.exit(2);
}

// 끝나지 않은 약속 때문에 이벤트 루프가 비어 조용히 종료(코드 0)되는 것을 실패로 처리
let finished = false;
process.on('beforeExit', () => { if (!finished) { console.log('FAIL (테스트가 끝나기 전에 이벤트 루프가 비었습니다 — 멈춘 약속)'); process.exit(3); } });
const results: { name: string; ok: boolean; error?: string }[] = [];
async function test(name: string, fn: () => Promise<void>) {
  try { await fn(); results.push({ name, ok: true }); console.log(`PASS ${name}`); }
  catch (e: any) { results.push({ name, ok: false, error: e?.stack || String(e) }); console.log(`FAIL ${name}\n  ${e?.message || e}`); }
}

const clients: Firestore[] = [];
const client = () => { const c = new Firestore({ projectId }); clients.push(c); return c; };

async function main() {
  await runStoreContract(test, 'FIRESTORE-EMULATOR', async () => {
    const collection = `ceo_statement_history_test_${randomUUID().slice(0, 8)}`;
    const mk = () => new FirestoreCeoStateStore(client(), { collection, opTimeoutMs: 10_000 });
    const admin = client();
    return {
      a: mk(), b: mk(), reopen: mk,
      withHooks: hooks => new FirestoreCeoStateStore(client(), { collection, opTimeoutMs: 10_000, hooks }),
      chunkExists: async id => (await admin.collection(collection).doc(id).get()).exists,
      cleanup: async () => { await admin.recursiveDelete(admin.collection(collection)); },
    };
  });

  await test('FIRESTORE-EMULATOR E1 읽기 경쟁: 저장이 계속되는 동안 동시에 읽어도 항상 같은 판의 head·조각(손상·누락 없음)', async () => {
    const collection = `ceo_statement_history_test_${randomUUID().slice(0, 8)}`;
    const w = new FirestoreCeoStateStore(client(), { collection });
    const r = new FirestoreCeoStateStore(client(), { collection });
    const res = (n: number): LastResult => ({ status: 'ready', refreshedAt: String(n), sources: [], message: String(n),
      dataset: { schemaVersion: 2, isExample: true, persons: [], roles: [], topics: [], comparisons: [], heldBackCount: 0, unavailableArticles: { pending: 0, failed: 0 } } });
    const T = 1_900_000_000_000;
    let stop = false; const seen: number[] = [];
    const reader = (async () => {
      while (!stop) {
        const st = await r.readState();
        if (st && st.head.revision > 0) {
          assert.strictEqual(String(st.head.revision), Object.keys(st.payload.cache.entries)[0], 'payload belongs to head revision');
          seen.push(st.head.revision);
        }
      }
    })();
    for (let i = 1; i <= 8; i++) {
      const l = await w.acquire({ holder: 'w', now: T + i * 10, minIntervalMs: 0, leaseMs: 5 }); assert.ok(l.ok);
      const big = 'x'.repeat(300_000); // 조각 2개 이상
      assert.ok((await w.commit({ token: l.token, baseRevision: i - 1, now: T + i * 10 + 1, payload: { records: [], cache: { entries: { [String(i)]: { pad: big } as any } } }, result: res(i) })).ok);
    }
    stop = true; await reader;
    assert.ok(seen.length > 0);
    const admin = client(); await admin.recursiveDelete(admin.collection(collection));
  });

  // CEO 한국어 요약 비용 원장 계약 (같은 문서를 여러 클라이언트가 트랜잭션으로 경쟁)
  await runKoLedgerContract(test, 'FIRESTORE-EMULATOR', async () => {
    const collection = `ceo_ko_summary_ledger_test_${randomUUID().slice(0, 8)}`;
    const mk = () => new FirestoreKoLedger(client(), { collection, opTimeoutMs: 10_000 });
    const admin = client();
    return { a: mk(), b: mk(), reopen: mk, cleanup: async () => { await admin.recursiveDelete(admin.collection(collection)); } };
  });

  await Promise.all(clients.map(c => c.terminate()));
  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed (store adapter + @google-cloud/firestore as resolved at build; FIRESTORE_EMULATOR_HOST=${host}, project ${projectId})`);
  for (const f of failed) console.log(`--- ${f.name}\n${f.error}`);
  finished = true;
  process.exit(failed.length ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
