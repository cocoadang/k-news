import { CeoPerson, CeoRole, PartialDate } from './types';
import { partialToInterval, spokenInterval, tenureRelation } from './dates';
import { normalizeForMatch } from './text';

export interface SpeakerMention {
  name: string;
  /** 기사에서 함께 언급된 회사 (없을 수 있음) */
  companyId?: string;
}

export type ResolveResult =
  | { status: 'resolved'; personId: string }
  | { status: 'unresolved'; reason: 'unknown_person' | 'ambiguous' | 'no_role_at_company'; candidates: string[] };

const nameKey = (s: string) => normalizeForMatch(s).toLowerCase().replace(/\s+/g, '');

/**
 * 이름만으로는 인물을 정하지 않습니다. 이름 후보 → 회사 역할 → 발언 시점 재임 순으로 좁히고,
 * 끝까지 둘 이상이거나 근거가 없으면 보류(unresolved)합니다.
 * spokenAt은 근거 검증을 마친 날짜여야 합니다(검증 전 날짜로 인물을 먼저 확정하지 않음).
 * 같은 회사 동명이인: 발언 시점이 재임 기간 '밖'으로 확실한 후보만 제외합니다. 날짜가 미상이거나 재임 경계와
 * 겹쳐(uncertain) 둘 이상이 가능하면 보류합니다.
 */
export function resolveSpeaker(mention: SpeakerMention, spokenAt: PartialDate, persons: CeoPerson[], roles: CeoRole[]): ResolveResult {
  const key = nameKey(mention.name);
  let candidates = persons.filter(p => [p.displayName, ...p.nameVariants].some(n => nameKey(n) === key)).map(p => p.personId);
  if (candidates.length === 0) return { status: 'unresolved', reason: 'unknown_person', candidates: [] };
  if (mention.companyId) {
    const atCompany = candidates.filter(id => roles.some(r => r.personId === id && r.companyId === mention.companyId));
    if (atCompany.length === 0) return { status: 'unresolved', reason: 'no_role_at_company', candidates };
    candidates = atCompany;
    if (candidates.length > 1) {
      // 같은 회사에 같은 이름이 둘 이상: 발언 시점에 가능한(재임 '밖'이 확실하지 않은) 후보가 하나일 때만 확정
      const possible = candidates.filter(id => roles.some(r => r.personId === id && r.companyId === mention.companyId && tenureRelation(spokenAt, r.start, r.end) !== 'outside'));
      if (possible.length === 1) return { status: 'resolved', personId: possible[0] };
      return { status: 'unresolved', reason: 'ambiguous', candidates };
    }
    return { status: 'resolved', personId: candidates[0] };
  }
  if (candidates.length === 1) return { status: 'resolved', personId: candidates[0] };
  return { status: 'unresolved', reason: 'ambiguous', candidates };
}

export interface RoleAtTime {
  title: string;
  /** current: 발언 시점 재임 중, former: 재임 종료 후, before: 취임 전, unknown: 날짜 불확실 */
  status: 'current' | 'former' | 'before' | 'unknown';
  companyName: string;
}

/**
 * 발언 시점의 회사 내 직책과 상태(재임 중/퇴임 후/취임 전/미상). title은 직책 이름 그대로 (표시 문구는 화면에서)
 * - 재임 중 역할이 여럿(겸직)이면 CEO·공동 CEO를 우선
 * - 어느 역할의 경계와 겹쳐 확실하지 않으면 '미상'
 * - 퇴임 후: 발언 시점 '이전에 끝난' 역할 중 가장 최근에 끝난 것 (발언 이후에 끝나거나 시작하는 역할은 후보에서 제외)
 * - 취임 전: 끝난 역할이 없고 모든 역할이 발언 이후에 시작할 때, 가장 먼저 시작하는 역할
 */
export function roleAtTime(personId: string, companyId: string, spokenAt: PartialDate, roles: CeoRole[]): RoleAtTime | null {
  const rs = roles.filter(r => r.personId === personId && r.companyId === companyId);
  if (rs.length === 0) return null;
  const rank = (r: CeoRole) => (r.roleType === 'ceo' || r.roleType === 'co_ceo' ? 0 : 1);
  const inside = rs.filter(r => tenureRelation(spokenAt, r.start, r.end) === 'inside').sort((a, b) => rank(a) - rank(b) || (a.start < b.start ? 1 : -1));
  if (inside.length) return { title: inside[0].title, status: 'current', companyName: inside[0].companyName };
  const s = spokenInterval(spokenAt);
  if (!s || rs.some(r => tenureRelation(spokenAt, r.start, r.end) === 'uncertain')) {
    const r = rs[0];
    return { title: r.title, status: 'unknown', companyName: r.companyName };
  }
  const endedBefore = rs.filter(r => { const e = r.end ? partialToInterval(r.end) : null; return !!e && e[1] <= s[0]; })
    .sort((a, b) => partialToInterval(b.end!)![1] - partialToInterval(a.end!)![1]);
  if (endedBefore.length) return { title: endedBefore[0].title, status: 'former', companyName: endedBefore[0].companyName };
  const startsAfter = rs.filter(r => { const st = partialToInterval(r.start); return !!st && st[0] >= s[1]; })
    .sort((a, b) => partialToInterval(a.start)![0] - partialToInterval(b.start)![0]);
  if (startsAfter.length) return { title: startsAfter[0].title, status: 'before', companyName: startsAfter[0].companyName };
  return { title: rs[0].title, status: 'unknown', companyName: rs[0].companyName };
}

/** 인물의 대표 표시 역할: 현직 우선, 없으면 가장 최근에 끝난 역할 */
export function currentOrLatestRole(personId: string, roles: CeoRole[]): CeoRole | null {
  const rs = roles.filter(r => r.personId === personId);
  if (!rs.length) return null;
  const current = rs.filter(r => r.end === null).sort((a, b) => (a.start < b.start ? 1 : -1));
  if (current.length) return current[0];
  return rs.sort((a, b) => ((a.end || '') < (b.end || '') ? 1 : -1))[0];
}

/** 같은 회사·같은 기간에 다른 CEO가 함께 있는지 (공동 CEO 표시용) */
export function coCeos(personId: string, roles: CeoRole[]): string[] {
  const mine = roles.filter(r => r.personId === personId && r.roleType === 'co_ceo' && r.end === null);
  return Array.from(new Set(roles
    .filter(r => r.personId !== personId && r.roleType === 'co_ceo' && r.end === null && mine.some(m => m.companyId === r.companyId))
    .map(r => r.personId)));
}

/** 화면 문구: 당시 직책 상태를 잃지 않게 표시 */
export function formatRoleAtTime(status: RoleAtTime['status'], title: string): string {
  switch (status) {
    case 'current': return `당시 ${title}`;
    case 'former': return `퇴임 후 발언 (전 ${title})`;
    case 'before': return `취임 전 발언 (이후 ${title})`;
    default: return `발언 시점 미확인 · ${title}`;
  }
}
