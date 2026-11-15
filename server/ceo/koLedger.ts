/**
 * CEO 한국어 요약 전용 비용 원장 (월 USD 한도, 앱 내부). 서버 전용.
 * - 상태는 문서 1개(JSON 문자열 필드)에 둡니다: 설정·월별 확정 비용·미확정 예약·작업(job) 목록·결과 캐시.
 *   문서 하나를 트랜잭션으로 읽고 쓰므로 '작업 고유성 확인 + 최대 비용 예약'이 한 번에 확정됩니다.
 * - 단위: 정수 나노달러(1e-9 USD), 계산은 항상 올림. 월 = 예약 시각의 UTC 연-월.
 * - 가용 = 한도 - 이번 달 확정 비용 - 미확정 예약 전체(이전 달 미확정 포함, 보수적).
 * - 트랜잭션 콜백 안에서는 모델·네트워크를 호출하지 않습니다(이 모듈은 SDK를 모름).
 * - 예약은 정산(settle, 정확히 1회) 또는 '명백한 미전송' 해제(release)로만 끝납니다. 결과 불명(uncertain)은 예약을 그대로 두고
 *   새 달·lease 만료로도 복구하지 않습니다. 같은 작업은 다시 예약되지 않습니다(재호출 0).
 */
import type { Firestore, Transaction } from '@google-cloud/firestore';

export const KO_LEDGER_COLLECTION = 'ceo_ko_summary_ledger';
/** 코드상 절대 한도: USD 1 (설정은 이 값 이하로만) */
export const KO_HARD_LIMIT_NANO = 1_000_000_000;
/** 월 한도 USD 1 유지(사용자 결정 2026-11-07: 먼저 모두 수집하고 중요한 발언부터 번역) */
export const monthCapNano = (s: { limitNano: number }, _month: string) => Math.min(s.limitNano, KO_HARD_LIMIT_NANO);

export type KoJobStatus = 'reserved' | 'settled' | 'uncertain' | 'released';
export interface KoJob {
  jobKey: string;
  status: KoJobStatus;
  month: string;
  reservedNano: number;
  costNano?: number;
  attemptId: string;
  statementId: string;
  reservedAt: string;
  endedAt?: string;
  usage?: { prompt: number; candidates: number; thoughts: number; total?: number; modelVersion?: string };
  note?: string;
}
export interface KoResult { title: string; summary: string; generatedAt: string; model: string; validationVersion?: number }
export interface KoLedgerState {
  schemaVersion: 1;
  enabled: boolean;
  limitNano: number;
  /** 처음 켠 시각. 이보다 먼저 처음 확인된 발언은 자동 처리하지 않음(과거 소급 0) */
  activatedAt: string | null;
  /** 추가 호출 중지 사유 (예상 밖 모델·비용 초과·usage 불명 등). 사람이 확인하기 전까지 유지 */
  halted: string | null;
  months: Record<string, { spentNano: number }>;
  jobs: Record<string, KoJob>;
  results: Record<string, KoResult>;
  revision: number;
}

export const emptyKoState = (): KoLedgerState => ({ schemaVersion: 1, enabled: false, limitNano: KO_HARD_LIMIT_NANO, activatedAt: null, halted: null, months: {}, jobs: {}, results: {}, revision: 0 });
export const utcMonth = (ms: number) => new Date(ms).toISOString().slice(0, 7);
export const outstandingNano = (s: KoLedgerState) => Object.values(s.jobs).filter(j => j.status === 'reserved' || j.status === 'uncertain').reduce((a, j) => a + j.reservedNano, 0);
export const availableNano = (s: KoLedgerState, month: string) =>
  monthCapNano(s, month) - (s.months[month]?.spentNano ?? 0) - outstandingNano(s);

export type ReserveResult = { ok: true; attemptId: string } | { ok: false; reason: 'exists' | 'over_limit' | 'halted' | 'disabled' | 'invalid' };

/** 순수 결정 함수들 (메모리·Firestore 어댑터 공용) */
export function decideReserve(s: KoLedgerState, o: { jobKey: string; statementId: string; costNano: number; now: number; attemptId: string }): { next: KoLedgerState; result: ReserveResult } {
  if (!Number.isSafeInteger(o.costNano) || o.costNano <= 0) return { next: s, result: { ok: false, reason: 'invalid' } };
  if (s.jobs[o.jobKey] || s.results[o.jobKey]) return { next: s, result: { ok: false, reason: 'exists' } };
  if (!s.enabled) return { next: s, result: { ok: false, reason: 'disabled' } };
  if (s.halted) return { next: s, result: { ok: false, reason: 'halted' } };
  const month = utcMonth(o.now);
  if (o.costNano > availableNano(s, month)) return { next: s, result: { ok: false, reason: 'over_limit' } };
  const next: KoLedgerState = JSON.parse(JSON.stringify(s));
  next.jobs[o.jobKey] = { jobKey: o.jobKey, status: 'reserved', month, reservedNano: o.costNano, attemptId: o.attemptId, statementId: o.statementId, reservedAt: new Date(o.now).toISOString() };
  next.revision++;
  return { next, result: { ok: true, attemptId: o.attemptId } };
}

export interface SettleInput {
  jobKey: string; attemptId: string; costNano: number; now: number;
  usage: KoJob['usage']; result: KoResult | null; note?: string; halt?: string | null;
  /** 묶음 작업(헤드라인 번역)의 항목별 결과: 항목 키 → 결과 */
  extraResults?: Record<string, KoResult>;
}
/** 정산: 같은 시도(attemptId)의 'reserved'/'uncertain' 작업만, 정확히 1회. 비용은 원래 예약 월에 기록. 예약 초과도 그대로 기록하고 중지 */
export function decideSettle(s: KoLedgerState, o: SettleInput): { next: KoLedgerState; ok: boolean } {
  const j = s.jobs[o.jobKey];
  if (!j || j.attemptId !== o.attemptId || (j.status !== 'reserved' && j.status !== 'uncertain')) return { next: s, ok: false };
  if (!Number.isSafeInteger(o.costNano) || o.costNano < 0) return { next: s, ok: false };
  const next: KoLedgerState = JSON.parse(JSON.stringify(s));
  const nj = next.jobs[o.jobKey];
  nj.status = 'settled'; nj.costNano = o.costNano; nj.usage = o.usage; nj.endedAt = new Date(o.now).toISOString(); if (o.note) nj.note = o.note;
  next.months[j.month] = { spentNano: (next.months[j.month]?.spentNano ?? 0) + o.costNano };
  if (o.result) next.results[o.jobKey] = o.result;
  for (const [k, v] of Object.entries(o.extraResults || {})) {
    const previous=next.results[k];
    // Repair a formerly rejected empty result, while preserving valid cached
    // translations. A newer validation marker also prevents endless retries.
    if (!previous || (!previous.title && (v.title || (v.validationVersion||0)>(previous.validationVersion||0)))) next.results[k] = v;
  }
  const over = o.costNano > j.reservedNano ? `실제 비용(${o.costNano})이 예약(${j.reservedNano})을 넘음` : null;
  const halt = o.halt || over;
  if (halt && !next.halted) next.halted = halt;
  next.revision++;
  return { next, ok: true };
}
/** 결과 불명: 예약 유지(재호출·복구 없음) + 추가 호출 중지 */
export function decideUncertain(s: KoLedgerState, o: { jobKey: string; attemptId: string; now: number; note: string }): { next: KoLedgerState; ok: boolean } {
  const j = s.jobs[o.jobKey];
  if (!j || j.attemptId !== o.attemptId || j.status !== 'reserved') return { next: s, ok: false };
  const next: KoLedgerState = JSON.parse(JSON.stringify(s));
  next.jobs[o.jobKey].status = 'uncertain'; next.jobs[o.jobKey].note = o.note; next.jobs[o.jobKey].endedAt = new Date(o.now).toISOString();
  if (!next.halted) next.halted = `결과 불명(예약 유지): ${o.note}`;
  next.revision++;
  return { next, ok: true };
}
/** 명백한 미전송(요청 함수를 부르기 전 실패)에만 예약 해제 */
export function decideRelease(s: KoLedgerState, o: { jobKey: string; attemptId: string; now: number; note: string }): { next: KoLedgerState; ok: boolean } {
  const j = s.jobs[o.jobKey];
  if (!j || j.attemptId !== o.attemptId || j.status !== 'reserved') return { next: s, ok: false };
  const next: KoLedgerState = JSON.parse(JSON.stringify(s));
  delete next.jobs[o.jobKey]; // 미전송이므로 같은 작업은 나중에 다시 예약 가능
  next.revision++;
  return { next, ok: true };
}
export function decideConfig(s: KoLedgerState, o: { enabled?: boolean; limitNano?: number; now: number }): KoLedgerState {
  const next: KoLedgerState = JSON.parse(JSON.stringify(s));
  if (o.limitNano !== undefined) {
    if (!Number.isSafeInteger(o.limitNano) || o.limitNano < 0 || o.limitNano > KO_HARD_LIMIT_NANO) throw new Error('한도는 0~USD 1(1e9 나노달러) 정수만 허용');
    next.limitNano = o.limitNano;
  }
  if (o.enabled !== undefined) {
    next.enabled = o.enabled;
    if (o.enabled && !next.activatedAt) next.activatedAt = new Date(o.now).toISOString();
  }
  next.revision++;
  return next;
}

export interface KoLedger {
  read(): Promise<KoLedgerState>;
  reserve(o: { jobKey: string; statementId: string; costNano: number; now: number; attemptId: string }): Promise<ReserveResult>;
  settle(o: SettleInput): Promise<boolean>;
  markUncertain(o: { jobKey: string; attemptId: string; now: number; note: string }): Promise<boolean>;
  release(o: { jobKey: string; attemptId: string; now: number; note: string }): Promise<boolean>;
  configure(o: { enabled?: boolean; limitNano?: number; now: number }): Promise<KoLedgerState>;
}

function parseState(raw: unknown): KoLedgerState {
  if (raw === undefined || raw === null) return emptyKoState();
  const s = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!s || s.schemaVersion !== 1 || typeof s.jobs !== 'object' || typeof s.results !== 'object') throw new Error('CEO 한국어 요약 원장 형식이 아닙니다.');
  return s as KoLedgerState;
}

/** 테스트용 메모리 원장 (운영 번들에 쓰지 않음 — routes는 Firestore 원장만 만듦) */
export class MemoryKoLedger implements KoLedger {
  state: string = JSON.stringify(emptyKoState());
  writes = 0;
  /** 트랜잭션 재실행 흉내: 쓰기 직전에 한 번 실행되는 경쟁 훅 */
  beforeWrite: (() => void) | null = null;
  failNext: 'reserve' | 'settle' | null = null;
  private lock: Promise<void> = Promise.resolve();
  private async tx<T>(fn: (s: KoLedgerState) => { next: KoLedgerState; out: T }): Promise<T> {
    const prev = this.lock; let done!: () => void; this.lock = new Promise(r => (done = r));
    await prev;
    try {
      const { next, out } = fn(parseState(this.state));
      if (next !== undefined && JSON.stringify(next) !== this.state) {
        if (this.beforeWrite) { const h = this.beforeWrite; this.beforeWrite = null; h(); }
        this.state = JSON.stringify(next); this.writes++;
      }
      return out;
    } finally { done(); }
  }
  async read() { return parseState(this.state); }
  async reserve(o: Parameters<KoLedger['reserve']>[0]) {
    if (this.failNext === 'reserve') { this.failNext = null; throw new Error('ledger unavailable'); }
    return this.tx(s => { const d = decideReserve(s, o); return { next: d.next, out: d.result }; });
  }
  async settle(o: SettleInput) {
    if (this.failNext === 'settle') { this.failNext = null; throw new Error('ledger unavailable'); }
    return this.tx(s => { const d = decideSettle(s, o); return { next: d.next, out: d.ok }; });
  }
  async markUncertain(o: Parameters<KoLedger['markUncertain']>[0]) { return this.tx(s => { const d = decideUncertain(s, o); return { next: d.next, out: d.ok }; }); }
  async release(o: Parameters<KoLedger['release']>[0]) { return this.tx(s => { const d = decideRelease(s, o); return { next: d.next, out: d.ok }; }); }
  async configure(o: Parameters<KoLedger['configure']>[0]) { return this.tx(s => { const n = decideConfig(s, o); return { next: n, out: n }; }); }
}

/** Firestore 원장 (운영). 기존 Firestore 인스턴스 주입(ADC), 문서 1개 트랜잭션. 콜백 안 모델 호출 없음 */
export class FirestoreKoLedger implements KoLedger {
  constructor(private db: Firestore, private opts: { collection?: string; opTimeoutMs?: number } = {}) {}
  private ref() { return this.db.collection(this.opts.collection || KO_LEDGER_COLLECTION).doc('state'); }
  private timed<T>(p: Promise<T>): Promise<T> {
    let t: ReturnType<typeof setTimeout> | undefined;
    return Promise.race([p, new Promise<never>((_, rej) => { t = setTimeout(() => rej(new Error('원장 작업 시간 초과(결과 미확정)')), this.opts.opTimeoutMs ?? 10_000); })])
      .finally(() => t && clearTimeout(t));
  }
  private tx<T>(fn: (s: KoLedgerState) => { next: KoLedgerState; out: T }): Promise<T> {
    return this.timed(this.db.runTransaction(async (t: Transaction) => {
      const snap = await t.get(this.ref());
      const cur = parseState(snap.exists ? (snap.data() as any)?.json : undefined);
      const { next, out } = fn(cur);
      if (next.revision !== cur.revision) t.set(this.ref(), { schemaVersion: 1, revision: next.revision, json: JSON.stringify(next) });
      return out;
    }));
  }
  async read() { const snap: any = await this.timed(this.ref().get()); return parseState(snap.exists ? (snap.data() as any)?.json : undefined); }
  reserve(o: Parameters<KoLedger['reserve']>[0]) { return this.tx(s => { const d = decideReserve(s, o); return { next: d.next, out: d.result }; }); }
  settle(o: SettleInput) { return this.tx(s => { const d = decideSettle(s, o); return { next: d.next, out: d.ok }; }); }
  markUncertain(o: Parameters<KoLedger['markUncertain']>[0]) { return this.tx(s => { const d = decideUncertain(s, o); return { next: d.next, out: d.ok }; }); }
  release(o: Parameters<KoLedger['release']>[0]) { return this.tx(s => { const d = decideRelease(s, o); return { next: d.next, out: d.ok }; }); }
  configure(o: Parameters<KoLedger['configure']>[0]) { return this.tx(s => { const n = decideConfig(s, o); return { next: n, out: n }; }); }
}
