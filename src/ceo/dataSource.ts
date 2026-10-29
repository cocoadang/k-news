import type { CeoApiResponse } from './types';

/**
 * CEO 발언 데이터 공급원: 서버의 읽기 전용 조회 API만 사용합니다.
 * 예시(가상) 데이터로 자동 대체하지 않습니다 — 실패·미적재·결과 없음은 그대로 화면에 표시합니다.
 */
export async function fetchCeoDataset(signal?: AbortSignal): Promise<CeoApiResponse> {
  const res = await fetch('/api/ceo/dataset', { credentials: 'include', signal, headers: { Accept: 'application/json' } });
  const type = res.headers.get('content-type') || '';
  if (!res.ok || !type.includes('application/json')) throw new Error(`조회 실패 (HTTP ${res.status})`);
  return (await res.json()) as CeoApiResponse;
}

/** 관리자 전용: 공식 출처 원문 새로고침 (서버가 인증 확인) */
export async function requestCeoRefresh(): Promise<{ ok: boolean; status: number; body: (CeoApiResponse & { error?: string }) | null }> {
  const res = await fetch('/api/admin/ceo/refresh', { method: 'POST', credentials: 'include', headers: { Accept: 'application/json' } });
  const type = res.headers.get('content-type') || '';
  const body = type.includes('application/json') ? await res.json().catch(() => null) : null;
  return { ok: res.ok, status: res.status, body };
}

/** 관리자 전용: CEO 한국어 요약 설정(켜기·끄기·한도 USD 0~1). 서버가 인증 확인. 자동 재시도 없음 */
export async function postKoSettings(body: { enabled?: boolean; limitUsd?: number }): Promise<{ ok: boolean; status: number; body: any }> {
  const res = await fetch('/api/admin/ceo/ko-summary/settings', { method: 'POST', credentials: 'include', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const type = res.headers.get('content-type') || '';
  return { ok: res.ok, status: res.status, body: type.includes('application/json') ? await res.json().catch(() => null) : null };
}

/** 관리자 전용: 저장된 검증 발언 1건만 한국어 요약 (유료 호출 최대 1회). 자동 재시도 없음 */
export async function postKoOne(body: { statementId: string; overrideReviewed?: boolean }): Promise<{ ok: boolean; status: number; body: any }> {
  const res = await fetch('/api/admin/ceo/ko-summary/one', { method: 'POST', credentials: 'include', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const type = res.headers.get('content-type') || '';
  return { ok: res.ok, status: res.status, body: type.includes('application/json') ? await res.json().catch(() => null) : null };
}
