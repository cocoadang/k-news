/** 문자열 정규화·짧은 해시 (외부 의존성 없음) */

/** 비교용 정규화: 유니코드 NFC, 곧은/굽은 따옴표 통일, 공백 하나로 */
export function normalizeForMatch(s: string): string {
  return (s || '')
    .normalize('NFC')
    .replace(/[‘’‚′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 인용 비교용: 앞뒤 따옴표·마침표 제거 + 소문자 */
export function normalizeQuote(s: string): string {
  return normalizeForMatch(s).replace(/^["'\s]+|["'\s.,!?]+$/g, '').toLowerCase();
}

/** 말줄임으로 서로 다른 구간을 이어 붙였는지 */
export function hasEllipsisJoin(s: string): boolean {
  return /\.\.\.|…|\(중략\)|\[\.\.\.\]/.test(s);
}

/** 짧은 결정적 해시 (FNV-1a 32bit 두 번, 16진 16자리). 보안 용도 아님 */
export function shortHash(s: string): string {
  let h1 = 0x811c9dc5, h2 = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x01000197) >>> 0;
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}

/** http/https 절대 URL만 허용 (javascript:, data:, 상대 경로 등은 null) */
export function safeHttpUrl(u: unknown): string | null {
  if (typeof u !== 'string' || !u.trim()) return null;
  try {
    const url = new URL(u.trim());
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}
