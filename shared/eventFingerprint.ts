// Distinguish the specific FCC grant from applications, appeals and later launches.
export function spaceDataCenterApprovalFingerprint(title: string): string {
  const text = title.toLowerCase().normalize('NFKC');
  if (!/spacex|스페이스x|스페이스엑스/.test(text)) return '';
  if (/\b(?:denies|rejects|revokes|reverses|challenges|appeals?|seeks|requests|proposes|could|may|would|expected to)\b|\bnot\b|철회|취소|반려|거부|승인 요청|승인 신청|승인 가능성/.test(text)) return '';
  const scaledSatellitePlan = /(?:\b(?:1|one)\s+million\b|\b1[,.]000[,.]000\b|100\s*만)/.test(text)
    && /satellites?|위성/.test(text)
    && (/\b(?:ai|data[- ]cent(?:er|re)s?)\b|데이터\s*센터/.test(text) || /\bfcc\b|연방통신위원회/.test(text));
  if (!scaledSatellitePlan && !/\bstarmind\b|스타마인드/.test(text)) return '';
  const granted = /\b(?:authori[sz]es|authori[sz]ed|approves|approved|clears|signs off|gets approval|green light)\b|승인|허가/.test(text);
  return granted ? 'spacex:starmind:fcc_approval:1000000' : '';
}

/**
 * 지문이 사건을 특정할 만큼 구체적인지 판단합니다.
 * - 기업만 있거나("googl") 기업+제품 1개("googl:gemini")뿐인 지문은 서로 다른 사건도 같아지므로 사용하지 않습니다.
 * - 기업 외 요소가 2개 이상이고, 기간(q1~q4)·숫자(금액/비율/버전) 같은 고정점이 있거나 요소가 3개 이상이어야 합니다.
 */
export function isFingerprintSpecific(fp?: string | null): boolean {
  if (!fp || !fp.includes(':')) return false;
  const rest = fp.split(':').slice(1).filter(Boolean);
  if (rest.length < 2) return false;
  const hasAnchor = rest.some(p => /^q[1-4]$/.test(p) || /\d/.test(p));
  return hasAnchor || rest.length >= 3;
}

/**
 * Checks whether two event fingerprints represent the same underlying event within the 72-hour window.
 */
export function areFingerprintsMatching(
  fp1: string,
  fp2: string,
  hoursDiff: number = 0
): boolean {
  if (hoursDiff > 72) return false;
  if (!fp1 || !fp2) return false;

  // 너무 일반적인 지문(예: "googl:gemini")은 동일 사건 판단에 쓰지 않음
  if (!isFingerprintSpecific(fp1) || !isFingerprintSpecific(fp2)) return false;

  const parts1 = fp1.split(':');
  const parts2 = fp2.split(':');

  // Must share the same company
  if (parts1[0] !== parts2[0]) return false;
  if (fp1 === fp2) return true;

  // 기업을 제외한 요소로 비교 (기업 일치만으로 공통 요소가 늘어나지 않도록)
  const rest1 = new Set(parts1.slice(1));
  const rest2 = new Set(parts2.slice(1));

  let common = 0;
  for (const p of rest1) {
    if (rest2.has(p)) common++;
  }

  // 요소 구성이 완전히 같거나, 기업 외 공통 요소가 3개 이상일 때만 동일 사건
  if (common === rest1.size && common === rest2.size) {
    return true;
  }
  if (common >= 3) {
    return true;
  }

  return false;
}
