import React, { useId, useMemo, useState } from 'react';
import { CeoApiResponse, CeoDataset, CeoSourceReport, CeoStatement, KoSummaryInfo, StatementEvidence } from '../../ceo/types';
import { buildCeoView, SortOrder, PersonSummary } from '../../ceo/view';
import { documentPublishedAt, formatArticleDate, formatSpokenDate, statementReferenceDate } from '../../ceo/dates';
import { KIND_LABEL } from '../../ceo/validate';
import { formatRoleAtTime } from '../../ceo/identity';
import { safeHttpUrl } from '../../ceo/text';

/** 서버 원문 확인 결과 (실데이터일 때) */
export interface CeoSourceSummary {
  status: CeoApiResponse['status'];
  refreshedAt: string | null;
  sources: CeoSourceReport[];
  message?: string;
  historyDurable?: boolean;
  withdrawnCount?: number;
  koSummary?: KoSummaryInfo;
}

const KO_STATE_LABEL: Record<KoSummaryInfo['state'], string> = {
  off: '꺼짐', on: '켜짐', limit_reached: '월 한도 도달 — 원문 표시', halted: '중지됨(확인 필요) — 원문 표시',
  config_unverified: '요금 설정 미확인 — 원문 표시', unknown: '상태 확인 불가 — 원문 표시',
};
const usd = (v: number | null) => (v === null ? '?' : `$${v.toFixed(v < 0.01 ? 4 : 2)}`);
/** AI 한국어 요약 상태·이번 달(UTC) 예산 한 줄 */
function KoBudgetLine({ info }: { info: KoSummaryInfo }) {
  return (
    <p className={`mt-1 ${subText}`} data-testid="ko-budget">
      AI 한국어 요약: {KO_STATE_LABEL[info.state]} · {info.month}(UTC) 확정 {usd(info.spentUsd)} · 확인 대기 예약 {usd(info.outstandingUsd)} · 월 한도 {usd(info.limitUsd)}
      {info.message ? ` · ${info.message}` : ''}
    </p>
  );
}

export type CeoViewState =
  | { status: 'loading' }
  | { status: 'not_loaded'; message: string }
  | { status: 'error'; message: string; sources?: CeoSourceReport[] }
  | { status: 'ready'; dataset: CeoDataset; source?: CeoSourceSummary };

interface Props {
  state: CeoViewState;
  onRetry?: () => void;
  isAdmin?: boolean;
}

type ArticleMeta = Pick<StatementEvidence, 'sourceName' | 'url' | 'articlePublishedAt' | 'publishedAtBasis'>;

const focusRing = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#090d16]';
/** 보조 문구: 모바일에서 한 단계 크고 밝게 */
const subText = 'text-[13px] sm:text-xs text-slate-300 sm:text-slate-400';

/** 원문 게시일 표시 이름: 선별 공식 페이지는 근거 종류별, 그 밖(피드·기사)은 '기사' */
const PUBLISHED_LABEL: Record<NonNullable<StatementEvidence['publishedAtBasis']>['kind'], string> = {
  written: '작성일', released: '발표문 게시일', posted: '게시일',
};
const pubLabel = (e: Pick<StatementEvidence, 'publishedAtBasis'> | undefined) => (e?.publishedAtBasis ? PUBLISHED_LABEL[e.publishedAtBasis.kind] : '기사');
/** 원문 게시일 문구. SEC 제출 문서는 실제 문서 게시일을 확인하지 않았으므로 날짜를 만들지 않음(영상 게시일·투자설명서 날짜를 쓰지 않음) */
const pubText = (e: Pick<StatementEvidence, 'publishedAtBasis' | 'articlePublishedAt' | 'url'>, sec?: boolean) => sec ? (documentPublishedAt(e) ? `SEC 제출일 ${formatArticleDate(documentPublishedAt(e))}` : 'SEC 제출일 미확인') : `${pubLabel(e)} ${formatArticleDate(e.articlePublishedAt)}`;

/** 선별 공식 페이지 종류 배지 */
const SOURCE_TYPE_LABEL: Record<NonNullable<CeoStatement['sourceType']>, string> = {
  call_remarks: '실적 통화 발언문', authored_post: '본인 작성글', press_release: '공식 발표문 안 인용', filed_transcript: 'SEC 제출 문서',
};
const ORIGINAL_LABEL = (s: CeoStatement) => s.sourceType === 'authored_post' ? '본인 작성글 원문' : s.sourceType === 'press_release' ? '발표문 안 인용 원문'
  : s.sourceType === 'filed_transcript' ? 'SEC 문서 속 인용 원문' : '직접 인용 원문';
const LANG_NAME: Record<string, string> = { en: '영어', ko: '한국어' };

const KIND_STYLE: Record<CeoStatement['kind'], string> = {
  direct_quote: 'border-cyan-700 text-cyan-200 bg-cyan-950/60',
  paraphrase: 'border-slate-600 text-slate-200 bg-slate-800/80',
  translation: 'border-violet-700 text-violet-200 bg-violet-950/60',
  interpretation: 'border-amber-700 text-amber-200 bg-amber-950/50',
};


function Badge({ className, children }: { className: string; children: React.ReactNode }) {
  return <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-semibold ${className}`}>{children}</span>;
}

/** 출처 줄: 매체 · 기사일 · 링크(http/https만, 예시는 연결 안 함) */
function SourceLine({ meta, isExample, sec }: { meta: ArticleMeta | undefined; isExample: boolean; sec?: boolean }) {
  if (!meta) return <span className={subText}>출처 정보 없음</span>;
  const href = safeHttpUrl(meta.url);
  return (
    <span className={subText}>
      {meta.sourceName} · {pubText(meta, sec)} ·{' '}
      {isExample ? <span>예시 링크(연결 안 됨)</span> : href ? (
        <a href={href} target="_blank" rel="noreferrer noopener" className={`text-cyan-300 underline ${focusRing}`}>원문 열기</a>
      ) : <span>링크 없음</span>}
    </span>
  );
}

/** 열고 닫는 근거 영역 (버튼 aria-expanded ↔ 패널 hidden) */
function Disclosure({ label, openLabel, children, testId }: { label: string; openLabel: string; children: React.ReactNode; testId?: string }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  return (
    <div className="mt-3" data-testid={testId}>
      <button type="button" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen(v => !v)}
        className={`inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm font-medium text-slate-200 hover:border-slate-500 ${focusRing}`}>
        <span aria-hidden="true">{open ? '▾' : '▸'}</span>
        {open ? openLabel : label}
      </button>
      <div id={panelId} hidden={!open} className="mt-3 space-y-3 border-l-2 border-slate-700 pl-3">{children}</div>
    </div>
  );
}

/** 발언일 / 원문 게시일(기사일·작성일·발표문 게시일)을 항상 따로 표시. 서면 공식 발표문은 발표일 기준임을 명시 */
function DateLine({ s }: { s: CeoStatement }) {
  const ref = statementReferenceDate(s);
  const spoken = formatSpokenDate(s.spokenAt);
  const first = s.evidence[0];
  const isReleased = ref?.basis === 'released';

  if ((isReleased || ref?.basis === 'written') && ref) {
    const [y, m, day] = ref.value.split('-');
    const dateStr = day ? `${y}.${m}.${day}` : m ? `${y}.${m}` : y;
    return (
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm" data-testid="date-line">
        <span className="font-semibold text-slate-100">
          <span className="sr-only">기준일 </span>{isReleased ? '발표일' : '작성일'} {dateStr}
        </span>
        <span className="text-[13px] sm:text-xs font-semibold text-cyan-300">({isReleased ? '발표일' : '작성일'} 기준)</span>
        {first && (
          <span className={subText}>
            ({isReleased ? '서면 발표문 · 실제 구두 발언일 미상' : '본인 작성글 · 구두 발언일 아님'}) · {pubText(first, false)} · {first.sourceName}{s.evidence.length > 1 ? ` 외 ${s.evidence.length - 1}건` : ''}
          </span>
        )}
      </div>
    );
  }

  const unknown = spoken.precisionLabel === '날짜 미상';
  if (unknown && s.sourceType === 'filed_transcript' && first && documentPublishedAt(first)) {
    return <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm" data-testid="date-line">
      <span className="font-semibold text-slate-100">SEC 제출일 {formatArticleDate(documentPublishedAt(first))}</span>
      <span className={subText}>발언일 미확인 · {first.sourceName}</span>
    </div>;
  }
  if (unknown && first && documentPublishedAt(first)) {
    return <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm" data-testid="date-line">
      <span className="font-semibold text-slate-100">{pubLabel(first)} {formatArticleDate(documentPublishedAt(first))}</span>
      <span className={subText}>게시일 기준 · {first.sourceName}</span>
    </div>;
  }
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm" data-testid="date-line">
      <span className={unknown ? 'font-semibold text-amber-200' : 'font-semibold text-slate-100'}>
        <span className="sr-only">발언일 </span>{unknown && first?.publishedAtBasis ? '발언일 미상' : spoken.text}
      </span>
      <span className={subText}>({spoken.precisionLabel})</span>
      {first && (
        <span className={first.publishedAtBasis && unknown ? 'text-[13px] sm:text-xs font-semibold text-slate-200' : subText}>
          {pubText(first, s.sourceType === 'filed_transcript')}{first.publishedAtBasis && unknown ? ' (실제 발언일 아님)' : ''} · {first.sourceName}{s.evidence.length > 1 ? ` 외 ${s.evidence.length - 1}건` : ''}
        </span>
      )}
    </div>
  );
}

/**
 * 본문: 직접 인용은 인용문 그대로. 요약·번역·해석은 의미를 검증하지 않았으므로 기사 문장을 먼저 보여주고,
 * 자동 요약은 '원문 대조 필요'로 덧붙입니다.
 */
function MainText({ s, large }: { s: CeoStatement; large?: boolean }) {
  const size = large ? 'text-lg sm:text-xl' : 'text-base sm:text-lg';
  const tr = s.translationKo;
  if (s.kind === 'direct_quote' && s.quoteText && tr?.status === 'reviewed' && tr.text.trim()) {
    // 한국어 번역을 기본으로. 번역은 원문이 아님을 표시하고, 영어 원문·출처·날짜 근거는 펼쳐서 확인
    return (
      <div data-testid="translation">
        <p className="mb-1"><Badge className="border-violet-700 text-violet-200 bg-violet-950/60">한국어 번역</Badge>
          <span className={`ml-2 ${subText}`}>{LANG_NAME[s.quoteLanguage || ''] || s.quoteLanguage} 원문은 펼쳐서 확인</span></p>
        <p className={`${size} font-semibold leading-relaxed text-white`} lang="ko">{tr.text}</p>
        {tr.noteKo && <p className={`mt-1 ${subText}`} data-testid="translation-note">{tr.noteKo}</p>}
      </div>
    );
  }
  const ko = s.koSummary;
  if (s.kind === 'direct_quote' && s.quoteText && ko?.status === 'ready') {
    // AI 요약은 인용이 아님: 인용부호 없이, '원문 대조 필요' 표시. 아래에 검증된 원문 인용을 그대로 함께 보여줌
    return (
      <div data-testid="ko-summary">
        <p className="mb-1"><Badge className="border-amber-700 text-amber-200 bg-amber-950/50">AI 한국어 요약</Badge></p>
        <p className={`${size} font-semibold leading-relaxed text-white`} lang="ko">{ko.title}</p>
        <p className="mt-1 text-sm leading-relaxed text-slate-200" lang="ko">{ko.summary}</p>
        <p className={`mt-2 ${subText}`}>검증된 {LANG_NAME[s.quoteLanguage || ''] || s.quoteLanguage} 원문 인용</p>
        <blockquote className="text-base font-semibold leading-relaxed text-slate-100" lang={s.quoteLanguage}>“{s.quoteText}”</blockquote>
      </div>
    );
  }
  if (s.kind === 'direct_quote' && s.quoteText) {
    return (
      <div>
        {s.quoteLanguage && s.quoteLanguage !== 'ko' && tr && (
          <p className="mb-1 text-[13px] sm:text-xs font-semibold text-amber-200" data-testid="translation-unavailable">
            {tr.status === 'stale' ? '한국어 번역 미확인 · 원문·근거가 바뀌어 저장된 번역을 쓰지 않고 원문을 표시합니다' : '한국어 번역 없음 · 원문을 표시합니다'}
          </p>
        )}
        {ko && (
          <p className="mb-1 text-[13px] sm:text-xs font-semibold text-amber-200" data-testid="ko-summary-status">
            {ko.status === 'pending' ? 'AI 한국어 요약 결과 확인 대기 · 원문을 표시합니다' : 'AI 한국어 요약을 만들지 못해 원문을 표시합니다'}
          </p>
        )}
        <blockquote className={`${size} font-semibold leading-relaxed text-white`} lang={s.quoteLanguage || 'ko'}>
          “{s.quoteText}”
        </blockquote>
        {s.quoteLanguage && s.quoteLanguage !== 'ko' && s.summaryKo.trim() && (
          <p className="mt-1 text-sm text-slate-300"><span className="text-slate-400">자동 번역 요지(원문 대조 필요) · </span>{s.summaryKo}</p>
        )}
      </div>
    );
  }
  return (
    <div>
      <p className={`${subText} mb-1`}>기사 문장</p>
      <blockquote className={`${size} font-semibold leading-relaxed text-slate-100`}>“{s.evidence[0]?.excerpt}”</blockquote>
      {s.summaryKo.trim() && <p className="mt-1 text-sm text-slate-300"><span className="text-slate-400">자동 요약(원문 대조 필요) · </span>{s.summaryKo}</p>}
    </div>
  );
}

/** 당시 상황: 추출기의 설명문 대신, 발언과 같은 기사 안의 근거 문장을 그대로 보여줌 */
function Context({ s }: { s: CeoStatement }) {
  if (!s.context?.sources.length) return null;
  return (
    <p className="mt-2 text-sm leading-relaxed text-slate-300">
      <span className="font-semibold text-slate-300">당시 상황(기사 문장) · </span>“{s.context.sources[0].excerpt}”
    </p>
  );
}

function Evidence({ s, isExample }: { s: CeoStatement; isExample: boolean }) {
  const metaOf = (articleId: string) => s.evidence.find(e => e.articleId === articleId);
  const translated = s.translationKo?.status === 'reviewed';
  const lang = LANG_NAME[s.quoteLanguage || ''] || s.quoteLanguage || '';
  return (
    <Disclosure label={translated ? `${lang} 원문·출처·날짜 근거 보기` : `근거·원문 보기 (${s.sourceType === 'filed_transcript' ? 'SEC 문서' : '기사'} ${s.evidence.length}건)`} openLabel="근거 접기">
      {translated && s.quoteText && (
        <figure className="text-sm" data-testid="original-quote">
          <p className={`${subText} mb-1`}>{ORIGINAL_LABEL(s)}({lang}, 그대로)</p>
          <blockquote className="rounded-lg border border-cyan-800 bg-slate-900/80 px-3 py-2 text-base font-semibold leading-relaxed text-white" lang={s.quoteLanguage}>“{s.quoteText}”</blockquote>
        </figure>
      )}
      <div className={subText}>
        <p>발언일 근거: {s.spokenAt.basis || '없음'}{s.spokenAt.basisType === 'inferred_from_article' && ' (기사 정보로 추정)'}</p>
        {s.spokenAt.basisExcerpt && <p className="mt-0.5">날짜 근거 문장: “{s.spokenAt.basisExcerpt}”</p>}
        {s.evidence.filter(e => e.publishedAtBasis).slice(0, 1).map((e, i) => (
          <p key={i} className="mt-0.5" data-testid="published-basis">{PUBLISHED_LABEL[e.publishedAtBasis!.kind]} 근거: {e.publishedAtBasis!.basis} — 발언일이 아닙니다.</p>
        ))}
        {s.roleNoteAtTime && <p className="mt-0.5">당시 직책: 등록된 공식 재임 기간 기준(페이지의 현재 직함 표기는 소급하지 않음)</p>}
      </div>
      {s.provenance && s.provenance.length > 0 && (
        <ul className={`space-y-1 ${subText}`} data-testid="provenance">
          {s.provenance.map((x, i) => <li key={i}>{x.label}: “{x.excerpt}”</li>)}
        </ul>
      )}
      {s.evidence.map((e, i) => (
        <figure key={`${e.articleId}-${i}`} className="text-sm">
          <blockquote className="rounded-lg bg-slate-900/80 px-3 py-2 leading-relaxed text-slate-200">{e.excerpt}</blockquote>
          <figcaption className="mt-1"><SourceLine meta={e} isExample={isExample} sec={s.sourceType === 'filed_transcript'} /></figcaption>
        </figure>
      ))}
      {s.context?.sources.map((c, i) => (
        <figure key={`ctx-${i}`} className="text-sm" data-testid="context-source">
          <p className={`${subText} mb-1`}>당시 상황 근거</p>
          <blockquote className="rounded-lg bg-slate-900/80 px-3 py-2 leading-relaxed text-slate-200">{c.excerpt}</blockquote>
          <figcaption className="mt-1"><SourceLine meta={metaOf(c.articleId)} isExample={isExample} /></figcaption>
        </figure>
      ))}
      {s.kind !== 'direct_quote' && (
        <p className={subText}>이 항목은 발언을 그대로 옮긴 인용이 아니라 {KIND_LABEL[s.kind]}입니다. 요약 문장의 의미는 자동 검증되지 않았습니다.</p>
      )}
    </Disclosure>
  );
}

/** 게시일순/발표일순 비교: 발언일 미상이 양쪽인지·한쪽인지·없는지(둘 다 알지만 선후 미확정) 정확히 구분 */
const unknownSpoken = (s: CeoStatement) => s.spokenAt.precision === 'unknown';
function publishedBadge(c: { earlier: CeoStatement; later: CeoStatement; basis?: string }): string {
  if (c.basis === 'written') return '작성일순 · 작성일 기준';
  if (c.basis === 'released') return '발표일순 · 발표일 기준';
  const e = unknownSpoken(c.earlier), l = unknownSpoken(c.later);
  return e && l ? '게시일순 · 실제 발언일 아님' : e || l ? '게시일순 · 한쪽 발언일 미확인' : '게시일순 · 발언 선후 미확정';
}
function publishedNote(c: { earlier: CeoStatement; later: CeoStatement; basis?: string }): string {
  if (c.basis === 'written') return '본인 작성글의 작성일 기준 비교입니다.';
  if (c.basis === 'released') return '공식 발표일 기준 비교입니다.';
  const e = unknownSpoken(c.earlier), l = unknownSpoken(c.later);
  if (e && l) return '원문 게시일·SEC 제출일 기준 비교입니다. 실제 발언 순서와 다를 수 있습니다.';
  if (e || l) return '원문 게시일·SEC 제출일 기준 비교입니다. 실제 발언 순서와 다를 수 있습니다.';
  return '두 기록 모두 발언일은 확인됐지만 선후를 확정할 수 없어 원문 게시일 순서로 놓았습니다.';
}

/** 당시 직책: 발언일 기준, 발언일 미상인 작성글·발표문은 작성·발표 당시 기준임을 밝힘 */
function roleText(s: CeoStatement): string {
  const note = s.roleNoteAtTime ? ` · ${s.roleNoteAtTime}` : '';
  if (s.roleDateBasis === 'written' || s.roleDateBasis === 'released') {
    const when = s.roleDateBasis === 'written' ? '작성 당시' : '발표 당시';
    if (s.roleStatusAtTime === 'current') return `${when} ${s.roleTitleAtTime}${note}`;
    return `${when} · ${formatRoleAtTime(s.roleStatusAtTime, s.roleTitleAtTime)}${note}`;
  }
  return formatRoleAtTime(s.roleStatusAtTime, s.roleTitleAtTime) + note;
}

function StatementBody({ s, isExample, large }: { s: CeoStatement; isExample: boolean; large?: boolean }) {
  return (
    <>
      <DateLine s={s} />
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <Badge className={KIND_STYLE[s.kind]}>{KIND_LABEL[s.kind]}</Badge>
        {s.sourceType && <Badge className="border-slate-600 text-slate-200 bg-slate-800" >{SOURCE_TYPE_LABEL[s.sourceType]}</Badge>}
        <span className={s.roleStatusAtTime === 'current' && !s.roleNoteAtTime ? subText : 'text-[13px] sm:text-xs font-semibold text-amber-200'} data-testid="role-at-time">
          {roleText(s)}
        </span>
      </div>
      {s.verification?.status === 'not_rechecked' && (
        <p className="mt-1 text-[13px] sm:text-xs font-semibold text-amber-200" data-testid="not-rechecked">
          마지막 원문 확인 {formatArticleDate(s.verification.lastVerifiedAt)} · 이번 갱신에서 원문을 다시 읽지 못함
        </p>
      )}
      <div className="mt-3"><MainText s={s} large={large} /></div>
      <Context s={s} />
      <Evidence s={s} isExample={isExample} />
    </>
  );
}

function PersonButton({ p, selected, onSelect, sameNameCount }: { p: PersonSummary; selected: boolean; onSelect: () => void; sameNameCount: number }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={`min-w-[200px] shrink-0 rounded-xl border px-4 py-3 text-left transition-colors ${focusRing} ${
        selected ? 'border-cyan-500 bg-cyan-950/50' : 'border-slate-700 bg-slate-900/70 hover:border-slate-500'}`}
    >
      <span className="block text-base font-bold text-white">{p.person.displayName}</span>
      <span className="mt-0.5 block text-sm text-slate-300">
        {p.role ? `${p.role.companyName} · ${p.isFormer ? `전 ${p.role.title}` : p.role.title}` : '직책 정보 없음'}
      </span>
      <span className="mt-2 flex flex-wrap gap-1.5">
        {sameNameCount > 1 && <Badge className="border-amber-700 text-amber-200 bg-amber-950/50">동명이인 있음</Badge>}
        {p.isFormer && <Badge className="border-slate-600 text-slate-300 bg-slate-800">전직</Badge>}
        {p.coCeoNames.length > 0 && <Badge className="border-slate-600 text-slate-300 bg-slate-800">공동대표: {p.coCeoNames.join(', ')}</Badge>}
        <Badge className="border-slate-700 text-slate-300 bg-slate-900">발언 {p.statementCount}건</Badge>
      </span>
    </button>
  );
}

function SourceList({ sources }: { sources: CeoSourceReport[] }) {
  return (
    <ul className={`space-y-1 text-left ${subText}`} data-testid="source-list">
      {sources.map(r => (
        <li key={r.feedUrl}>
          <span className={r.ok ? 'text-slate-200' : r.held ? 'text-amber-200' : 'text-rose-300'}>{r.ok ? '확인' : r.held ? '보류' : '실패'}</span> · {r.feedName}
          {r.kind === 'discovery' ? ` · 이번 확인 ${r.matchedExisting}건 · 인용 확인 문서 ${r.withBody}건 · 대기 ${r.itemsInFeed}건` : r.kind === 'transcript' ? ' (IR 행사 기록)' : r.kind === 'page' ? ' (선별 공식 페이지)' : r.kind === 'sec' ? ' (SEC 제출 문서)' : ` · 피드 ${r.itemsInFeed}건 중 기존 기사 ${r.matchedExisting}건, 본문 ${r.withBody}건`}
          {r.error && <> · {r.error}</>}
          {r.rejectedQuotes?.map((q, i) => <span key={i} className="block text-amber-200">보류: {q.reason}</span>)}
        </li>
      ))}
    </ul>
  );
}

function StateBox({ title, children, tone = 'neutral' }: { title: string; children?: React.ReactNode; tone?: 'neutral' | 'error' }) {
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={`rounded-2xl border p-6 text-center ${tone === 'error' ? 'border-rose-800 bg-rose-950/40' : 'border-slate-800 bg-slate-900/50'}`}>
      <p className="text-base font-bold text-slate-100">{title}</p>
      {children && <div className="mt-2 text-sm text-slate-300">{children}</div>}
    </div>
  );
}

export function CeoStatementsView({ state, onRetry, isAdmin = false }: Props) {
  const [personId, setPersonId] = useState<string | null>(null);
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [topicId, setTopicId] = useState<string | null>(null);
  const [sort, setSort] = useState<SortOrder>('newest');
  const dataset = state.status === 'ready' ? state.dataset : null;
  const view = useMemo(() => (dataset ? buildCeoView(dataset, { personId, companyId, topicId, sort }) : null), [dataset, personId, companyId, topicId, sort]);

  const header = (
    <div className="mb-4">
      <h2 id="ceo-heading" className="text-xl sm:text-2xl font-bold text-white">CEO 발언</h2>
      
      <p className={`mt-1 ${subText}`}>공식 자료에서 확인한 발언을 회사·주제별로 비교합니다.</p>
    </div>
  );

  if (state.status === 'loading') return <section className="break-keep" aria-busy="true" aria-labelledby="ceo-heading">{header}<StateBox title="발언 자료를 불러오는 중입니다…" /></section>;
  if (state.status === 'not_loaded') {
    return (
      <section className="break-keep" aria-labelledby="ceo-heading">{header}
        <StateBox title="공식 출처 원문을 아직 불러오지 않았습니다.">
          <p>{state.message}</p>
          {isAdmin ? (
            <p className="mt-1">관리자 영역의 '공식 원문 새로고침'을 실행하면 공식 출처 원문에서 확인된 발언만 표시됩니다. 예시 자료로 대신 채우지 않습니다.</p>
          ) : (
            <p className="mt-1">정기 자동 수집 또는 관리자 갱신 완료 후 공식 출처에서 확인된 발언이 표시됩니다. 예시 자료로 대신 채우지 않습니다.</p>
          )}
        </StateBox>
      </section>
    );
  }
  if (state.status === 'error') {
    return (
      <section className="break-keep" aria-labelledby="ceo-heading">{header}
        <StateBox title="발언 자료를 불러오지 못했습니다." tone="error">
          <p>{state.message}</p>
          {isAdmin && state.sources && state.sources.length > 0 && <SourceList sources={state.sources} />}
          {onRetry && <button type="button" onClick={onRetry} className={`mt-3 rounded-lg bg-cyan-700 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-600 ${focusRing}`}>다시 시도</button>}
        </StateBox>
      </section>
    );
  }
  if (!dataset || !view) return null;

  const exampleBanner = dataset.isExample && (
    <div role="note" className="mb-4 rounded-xl border border-amber-600 bg-amber-950/60 px-4 py-3 text-sm text-amber-100">
      <strong className="font-bold">예시 데이터</strong> · 화면 구성 확인용 가상 인물·가상 회사·가상 발언입니다. 실존 인물의 발언이 아닙니다.
    </div>
  );
  const src = state.status === 'ready' ? state.source : undefined;
  const sourceBanner = isAdmin && src && (
    <div role="status" className={`mb-4 rounded-xl border px-4 py-3 text-sm ${src.status === 'ready' ? 'border-slate-700 bg-slate-900/60 text-slate-200' : 'border-amber-700 bg-amber-950/40 text-amber-100'}`} data-testid="source-banner">
      <p>
        <strong className="font-bold">{src.status === 'ready' ? '공식 원문 확인 완료' : src.status === 'partial' ? '일부 출처만 확인(부분 가용)' : '출처 확인 실패'}</strong>
        {src.refreshedAt && <> · 마지막 갱신 {formatArticleDate(src.refreshedAt)}</>}
        {src.message && <> · {src.message}</>}
      </p>
      {src.historyDurable === false && <p className={`mt-1 ${subText}`}>확인 이력은 서버 메모리에만 있어 서버가 다시 시작되면 다시 불러와야 합니다.</p>}
      {/* 비용/월 한도/원장 및 출처별 실패 상세는 관리자에게만 조건부 렌더링 */}
      {isAdmin && src.koSummary && <KoBudgetLine info={src.koSummary} />}
      {!!src.withdrawnCount && <p className={`mt-1 ${subText}`}>원문에서 사라졌거나 출처가 삭제된 발언 {src.withdrawnCount}건은 표시하지 않았습니다.</p>}
      {isAdmin && (
        <Disclosure label={`출처 확인 결과 보기 (${src.sources.length}곳)`} openLabel="출처 확인 결과 접기" testId="source-detail">
          <SourceList sources={src.sources} />
        </Disclosure>
      )}
    </div>
  );
  const unavailable = dataset.unavailableArticles || { pending: 0, failed: 0 };
  const footerNotes = (
    <div className={`mt-6 space-y-1 ${subText}`}>
      {dataset.heldBackCount > 0 && <p>인물 확인이 안 되었거나 근거가 확인되지 않은 발언 {dataset.heldBackCount}건은 표시하지 않았습니다.</p>}
      {(unavailable.pending > 0 || unavailable.failed > 0) && (
        <p data-testid="unavailable-note">현재 기준으로 아직 정리되지 않은 기사 {unavailable.pending}건(재추출 대기)과 추출 실패 기사 {unavailable.failed}건은 표시하지 않았습니다.</p>
      )}
    </div>
  );

  if (view.persons.length === 0 || dataset.statements.length === 0) {
    return (
      <section className="break-keep" aria-labelledby="ceo-heading">{header}{exampleBanner}{sourceBanner}
        <StateBox title={src ? '공식 원문에서 확인된 CEO 발언이 없습니다.' : '아직 정리된 CEO 발언이 없습니다.'}>
          {src ? '본문을 읽은 공식 출처에서 등록된 CEO의 직접 인용을 찾지 못했습니다. 원문이 부족하면 빈 화면으로 둡니다.' : '기사에서 발언이 추출되면 이곳에 인물별로 표시됩니다.'}
        </StateBox>{footerNotes}
      </section>
    );
  }

  const selected = view.persons.find(p => p.person.personId === view.selectedPersonId && p.companyId === view.selectedCompanyId)!;
  const nameCount = (name: string) => new Set(view.persons.filter(p => p.person.displayName === name).map(p => p.person.personId)).size;
  const topicLabel = view.topics.find(t => t.topic.topicId === view.selectedTopicId)?.topic.label;
  const isEx = dataset.isExample;
  /** 발언일 미상 중 원문 게시일이 확인된 건수 (안내 문구만 구분, 정렬·비교는 그대로) */
  const undatedPub = view.undated.filter(s => s.evidence.some(e => !!documentPublishedAt(e))).length;

  return (
    <section className="break-keep" aria-labelledby="ceo-heading">
      {header}
      {exampleBanner}
      {sourceBanner}

      <div className="mb-5">
        <h3 className="mb-2 text-sm font-semibold text-slate-300">1. 인물 선택</h3>
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-2" role="group" aria-label="인물 선택">
          {view.persons.map(p => (
            <PersonButton key={`${p.person.personId}:${p.companyId}`} p={p} selected={p.person.personId === view.selectedPersonId && p.companyId === view.selectedCompanyId}
              sameNameCount={nameCount(p.person.displayName)}
              onSelect={() => { setPersonId(p.person.personId); setCompanyId(p.companyId); setTopicId(null); }} />
          ))}
        </div>
      </div>

      {view.topics.length === 0 ? (
        <StateBox title={`${selected.person.displayName} · ${selected.role?.companyName || selected.companyId}의 발언 자료가 부족합니다.`}>이 회사에 해당하는 검증된 발언 자료가 아직 없습니다.</StateBox>
      ) : (
        <>
          <div className="mb-6">
            <h3 className="mb-2 text-sm font-semibold text-slate-300">2. 주제 선택</h3>
            <div className="flex flex-wrap gap-2" role="group" aria-label="주제 선택">
              {view.topics.map(t => (
                <button key={t.topic.topicId} type="button" aria-pressed={t.topic.topicId === view.selectedTopicId}
                  onClick={() => setTopicId(t.topic.topicId)}
                  className={`min-h-[40px] rounded-full border px-4 py-2 text-sm font-semibold ${focusRing} ${
                    t.topic.topicId === view.selectedTopicId ? 'border-cyan-500 bg-cyan-900/60 text-white' : 'border-slate-700 bg-slate-900 text-slate-300 hover:border-slate-500'}`}>
                  {t.topic.label} <span className="ml-1 text-xs font-normal text-slate-400">{t.count}</span>
                </button>
              ))}
            </div>
          </div>

          <section aria-labelledby="ceo-compare-heading" className="mb-8">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <h3 id="ceo-compare-heading" className="text-lg font-bold text-white">발언 비교 · {topicLabel}</h3>
              
              {(view.comparison?.basis === 'released' || view.comparison?.basis === 'written') && <Badge className="border-cyan-700 text-cyan-200 bg-cyan-950/60">{publishedBadge(view.comparison)}</Badge>}
              {view.comparison?.basis === 'published' && <Badge className="border-amber-700 text-amber-200 bg-amber-950/50">{publishedBadge(view.comparison)}</Badge>}
            </div>
            {!view.comparison ? (
              <StateBox title="비교할 기록이 아직 부족합니다." />
            ) : (
              <>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2" data-testid="compare-grid">
                  {([['앞선 기록', view.comparison.earlier], ['뒤의 기록', view.comparison.later]] as const).map(([label, s]) => (
                    <article key={`${label}-${s.statementId}`} className="rounded-2xl border border-slate-700 bg-slate-900/70 p-4 sm:p-5" data-testid={`compare-${label === '앞선 기록' ? 'earlier' : 'later'}`}>
                      <p className="mb-2 text-xs font-bold tracking-wide text-cyan-300">{label} <span className="font-normal text-slate-400">(선택 자료 내)</span></p>
                      <StatementBody s={s} isExample={isEx} large />
                    </article>
                  ))}
                </div>
                {(view.comparison.basis === 'published' || view.comparison.basis === 'released' || view.comparison.basis === 'written') && (
                  <p className={`mt-1 ${subText}`} data-testid={view.comparison.basis === 'released' ? 'released-order-note' : 'published-order-note'}>{publishedNote(view.comparison)}</p>
                )}
              </>
            )}
          </section>

          <section aria-labelledby="ceo-timeline-heading">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h3 id="ceo-timeline-heading" className="text-lg font-bold text-white">날짜순 기록</h3>
              <div className="inline-flex rounded-lg border border-slate-700 p-0.5" role="group" aria-label="정렬">
                {(['newest', 'oldest'] as const).map(o => (
                  <button key={o} type="button" aria-pressed={sort === o} onClick={() => setSort(o)}
                    className={`min-h-[36px] rounded-md px-3 text-sm font-semibold ${focusRing} ${sort === o ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-white'}`}>
                    {o === 'newest' ? '최신순' : '과거순'}
                  </button>
                ))}
              </div>
            </div>
            <ol className="relative space-y-4 border-l-2 border-slate-800 pl-5" data-testid="timeline">
              {view.dated.map(s => (
                <li key={s.statementId} className="relative" data-testid="timeline-item" data-statement-id={s.statementId}>
                  <span aria-hidden="true" className="absolute -left-[27px] top-2 h-3 w-3 rounded-full border-2 border-cyan-400 bg-[#090d16]" />
                  <article className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
                    <StatementBody s={s} isExample={isEx} />
                  </article>
                </li>
              ))}
            </ol>
            {view.undated.length > 0 && (
              <div className="mt-6">
                <h4 className="text-base font-bold text-amber-200">날짜 미확인 기록 {view.undated.length}건</h4>
                <p className={`mb-3 ${subText}`} data-testid="undated-order-note">{undatedPub ? '발언일 미확인 · 원문 게시일·SEC 제출일 기준' : '날짜가 확인되지 않은 기록입니다.'}</p>
                <ul className="space-y-4" data-testid="undated">
                  {view.undated.map(s => (
                    <li key={s.statementId} className="rounded-2xl border border-dashed border-slate-700 bg-slate-900/40 p-4">
                      <StatementBody s={s} isExample={isEx} />
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        </>
      )}
      {footerNotes}
    </section>
  );
}
