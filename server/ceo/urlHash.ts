import crypto from 'node:crypto';

/**
 * 기존 기사 ID와 같은 URL 해시 (server/firestore.ts computeUrlHash와 동일 규칙).
 * CEO 모듈이 Firestore 모듈·db 싱글턴을 불러오지 않도록 복제했으며, 동일성은 테스트로 확인합니다.
 */
export function ceoUrlHash(url: string): string {
  const normalized = url.trim().toLowerCase().split('?')[0].replace(/\/+$/, '');
  return crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 32);
}
