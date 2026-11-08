/**
 * X(트위터) 본인 계정 게시물 → CEO 발언 화면 (사용자 요청 2026-11-07).
 * - 공식 X API v2(유료, 게시물 1건 읽기 USD 0.005)만 사용. 토큰(X_BEARER_TOKEN)이 없으면 아무것도 하지 않음.
 * - 답글·리트윗 제외, 본인 원글만. 머스크는 Tesla·SpaceX 관련 단어가 있는 글만 검색(검색 결과만 과금).
 * - 월 비용 상한(기본 USD 5)을 넘기지 않도록 요청 전에 최대 비용을 예약하고, 결과 수로 정산합니다.
 * - 최근 7일 검색을 매일 하고, 상한에 여유가 있으면 전체 기록 검색으로 6년 전까지 조금씩 거슬러 올라갑니다.
 */
import { createHash } from 'node:crypto';

export const X_POST_USD = 0.005;
export const X_DEFAULT_CAP_USD = 5;
export const X_YEARS = 6;

const TESLA = /\b(Tesla|FSD|Robotaxis?|Cybercab|Optimus|Megapacks?|Powerwall|Cybertruck|Model [3SXY]|Autopilot|Giga ?\w*)\b/i;
const SPACEX = /\b(SpaceX|Starship|Starlink|Falcon|Dragon|Raptor|Starbase|Mars)\b/i;

export interface XAccount { personId: string; username: string; keywords?: string; company: (text: string) => string | null }
export const X_ACCOUNTS: XAccount[] = [
  { personId: 'elon-musk', username: 'elonmusk', keywords: '(Tesla OR SpaceX OR Starship OR Starlink OR Optimus OR FSD OR Robotaxi OR Cybercab OR Megapack OR Falcon)',
    company: t => { const a = TESLA.test(t), b = SPACEX.test(t); return a && !b ? 'tsla' : b && !a ? 'spacex' : null; } },
  { personId: 'bill-ackman', username: 'BillAckman', company: () => 'pershing' },
  { personId: 'ray-dalio', username: 'RayDalio', company: () => 'bridgewater' },
  { personId: 'satya-nadella', username: 'satyanadella', company: () => 'msft' },
  { personId: 'sundar-pichai', username: 'sundarpichai', company: () => 'googl' },
  { personId: 'sam-altman', username: 'sama', company: () => 'openai' },
  { personId: 'dario-amodei', username: 'DarioAmodei', company: () => 'anthropic' },
];

export interface XPost { id: string; username: string; personId: string; companyId: string; text: string; createdAt: string }
export interface XState {
  version: 1;
  months: Record<string, { usd: number }>;
  /** 계정별: 최근 검색 기준 id, 과거 검색 진행 위치 */
  accounts: Record<string, { newestId?: string; backfillUntil?: string; backfillDone?: boolean; archiveUnavailable?: boolean }>;
  posts: Record<string, XPost>;
  lastRun?: { at: string; status: string; fetched: number; kept: number; usd: number };
}
export const emptyXState = (): XState => ({ version: 1, months: {}, accounts: {}, posts: {} });
export interface XStore { read(): Promise<XState>; write(s: XState, added: XPost[]): Promise<void> }

const month = (ms: number) => new Date(ms).toISOString().slice(0, 7);
const kstDay = (iso: string) => new Date(Date.parse(iso) + 9 * 3600000).toISOString().slice(0, 10);

export function spentUsd(s: XState, ms: number) { return s.months[month(ms)]?.usd || 0; }

/** 검색 1회: 결과 수만큼 과금. 예약(max_results×단가)이 상한을 넘으면 요청하지 않음 */
async function search(o: { token: string; fetchImpl: typeof fetch; s: XState; now: number; cap: number; archive: boolean; query: string; sinceId?: string; endTime?: string; startTime?: string; max: number }) {
  const reserve = o.max * X_POST_USD;
  if (spentUsd(o.s, o.now) + reserve > o.cap) return { ok: false as const, reason: 'cap' };
  const u = new URL(`https://api.x.com/2/tweets/search/${o.archive ? 'all' : 'recent'}`);
  u.searchParams.set('query', o.query);
  u.searchParams.set('max_results', String(Math.max(10, Math.min(100, o.max))));
  u.searchParams.set('tweet.fields', 'created_at,note_tweet,lang,author_id');
  u.searchParams.set('expansions', 'author_id');
  u.searchParams.set('user.fields', 'username');
  if (o.sinceId) u.searchParams.set('since_id', o.sinceId);
  if (o.endTime) u.searchParams.set('end_time', o.endTime);
  if (o.startTime) u.searchParams.set('start_time', o.startTime);
  const res = await o.fetchImpl(u, { headers: { Authorization: `Bearer ${o.token}` }, signal: AbortSignal.timeout(15000) });
  if (res.status === 401 || res.status === 403) return { ok: false as const, reason: `http_${res.status}` };
  if (res.status === 429) return { ok: false as const, reason: 'rate_limited' };
  if (!res.ok) return { ok: false as const, reason: `http_${res.status}` };
  const body: any = await res.json();
  const data: any[] = Array.isArray(body?.data) ? body.data : [];
  const m = month(o.now); o.s.months[m] = { usd: Math.round(((o.s.months[m]?.usd || 0) + data.length * X_POST_USD) * 1e6) / 1e6 };
  return { ok: true as const, data, newestId: body?.meta?.newest_id as string | undefined, oldestTime: data.length ? data.map(d => d.created_at).sort()[0] as string : undefined };
}

export async function collectXPosts(o: { token?: string; store: XStore; fetchImpl?: typeof fetch; now: () => number; deadline: number; capUsd?: number; accounts?: XAccount[] }) {
  if (!o.token) return { status: 'x_not_configured' };
  const f = o.fetchImpl || fetch;
  const cap = o.capUsd ?? X_DEFAULT_CAP_USD;
  const s = await o.store.read();
  let fetched = 0, kept = 0; const notes: string[] = []; const added: XPost[] = [];
  const keep = (a: XAccount, d: any) => {
    const text = String(d?.note_tweet?.text || d?.text || '').trim();
    if (!d?.id || !text || s.posts[d.id]) return;
    const companyId = a.company(text); if (!companyId) return;
    const post = { id: String(d.id), username: a.username, personId: a.personId, companyId, text: text.slice(0, 4000), createdAt: String(d.created_at || '') };
    s.posts[post.id] = post; added.push(post); kept++;
  };
  const sixYears = new Date(o.now()); sixYears.setUTCFullYear(sixYears.getUTCFullYear() - X_YEARS);
  for (const a of o.accounts || X_ACCOUNTS) {
    if (o.now() > o.deadline - 5000) break;
    const st = (s.accounts[a.username] ||= {});
    const query = `from:${a.username} -is:retweet -is:reply${a.keywords ? ' ' + a.keywords : ''}`;
    try {
      // 1) 최근 7일(새 글)
      const r = await search({ token: o.token, fetchImpl: f, s, now: o.now(), cap, archive: false, query, sinceId: st.newestId, max: 100 });
      if (!r.ok) { notes.push(`${a.username}:${r.reason}`); if (r.reason.startsWith('http_40')) break; continue; }
      fetched += r.data.length; r.data.forEach(d => keep(a, d));
      if (r.newestId) st.newestId = r.newestId;
      if (!st.backfillUntil) st.backfillUntil = r.oldestTime || new Date(o.now() - 7 * 86400000).toISOString();
      // 2) 과거 기록(상한의 절반을 넘게 쓰지 않을 때만, 계정당 1회 100건)
      if (!st.backfillDone && !st.archiveUnavailable && spentUsd(s, o.now()) < cap / 2 && o.now() < o.deadline - 5000) {
        const b = await search({ token: o.token, fetchImpl: f, s, now: o.now(), cap, archive: true, query, endTime: st.backfillUntil, startTime: sixYears.toISOString(), max: 100 });
        if (b.ok) { fetched += b.data.length; b.data.forEach(d => keep(a, d)); if (!b.data.length) st.backfillDone = true; else st.backfillUntil = b.oldestTime; }
        else if (b.reason === 'http_403') st.archiveUnavailable = true;
        else notes.push(`${a.username}:archive_${b.reason}`);
      }
    } catch (e: any) { notes.push(`${a.username}:${String(e?.name || 'error')}`); }
  }
  const usd = spentUsd(s, o.now());
  s.lastRun = { at: new Date(o.now()).toISOString(), status: notes.length ? 'partial' : 'ok', fetched, kept, usd };
  await o.store.write(s, added);
  return { status: notes.length ? 'x_partial' : 'x_ok', fetched, kept, monthUsd: usd, notes: notes.slice(0, 6) };
}

/** CEO 발언 화면용 공개 항목 (본인 X 게시물, 게시일 기준) */
export function xPostStatements(s: XState | null | undefined): any[] {
  return Object.values(s?.posts || {}).filter(p => p.createdAt && Number.isFinite(Date.parse(p.createdAt))).map(p => ({
    statementId: 'xp_' + createHash('sha256').update(p.id).digest('hex').slice(0, 16),
    personId: p.personId, companyId: p.companyId, roleTitleAtTime: '', roleStatusAtTime: 'current', topicId: '기타',
    kind: 'social_post', quoteText: p.text, quoteLanguage: 'en', summaryKo: '', sourceType: 'social_post',
    referenceDate: { value: kstDay(p.createdAt), basis: 'written', precision: 'day' },
    evidence: [{ articleId: 'x_' + p.id, url: `https://x.com/${p.username}/status/${p.id}`, sourceName: `X @${p.username}`, articlePublishedAt: new Date(p.createdAt).toISOString() }], // 본문은 quoteText에만(응답 크기 절약)
    isExample: false,
  }));
}

/** Firestore 저장소: 진행 상태는 문서 1개, 게시물은 글마다 문서(ceo_x_posts). 읽기는 10분 캐시 */
export function firestoreXStore(getDb: () => any, cacheMs = 600_000): XStore {
  let cache: { at: number; posts: Record<string, XPost> } | null = null;
  const db = () => getDb();
  return {
    async read() {
      const d = db(); if (!d) return emptyXState();
      const snap = await d.collection('ceo_x_state').doc('state').get();
      const st = snap.exists && snap.data()?.version === 1 ? snap.data() : {};
      if (!cache || Date.now() - cache.at > cacheMs) {
        const q = await d.collection('ceo_x_posts').get();
        const posts: Record<string, XPost> = {};
        q.forEach((doc: any) => { const p = doc.data(); if (p?.id) posts[p.id] = p; });
        cache = { at: Date.now(), posts };
      }
      return { ...emptyXState(), ...st, posts: { ...cache.posts } };
    },
    async write(s, added) {
      const d = db(); if (!d) return;
      const { posts: _p, ...rest } = s;
      await d.collection('ceo_x_state').doc('state').set(rest);
      for (let i = 0; i < added.length; i += 400) {
        const b = d.batch();
        for (const p of added.slice(i, i + 400)) b.set(d.collection('ceo_x_posts').doc(p.id), p);
        await b.commit();
      }
      if (cache) for (const p of added) cache.posts[p.id] = p;
    },
  };
}

/** X 토큰: 환경변수(X_BEARER_TOKEN) 우선, 없으면 관리자가 화면에서 넣은 값(Firestore ceo_x_secret/token, 서버만 읽음·응답에 노출 안 함) */
export function xTokenStore(getDb: () => any) {
  let cache: { at: number; token: string | null } | null = null;
  const ref = () => getDb()?.collection('ceo_x_secret').doc('token');
  return {
    async get(): Promise<string | undefined> {
      if (process.env.X_BEARER_TOKEN) return process.env.X_BEARER_TOKEN;
      if (cache && Date.now() - cache.at < 300_000) return cache.token || undefined;
      const r = ref(); if (!r) return undefined;
      const snap = await r.get(); const t = snap.exists ? String(snap.data()?.token || '') : '';
      cache = { at: Date.now(), token: t || null };
      return t || undefined;
    },
    async set(token: string | null) {
      const r = ref(); if (!r) throw new Error('firestore_unavailable');
      if (token) await r.set({ token, updatedAt: new Date().toISOString() }); else await r.delete();
      cache = null;
    },
  };
}
/** 화면에 넣은 토큰 형식 확인(값은 저장 전후 어디에도 출력하지 않음) */
export const validXToken = (t: unknown): t is string => typeof t === 'string' && /^[A-Za-z0-9%_\-.~+/=]{40,300}$/.test(t.trim());
