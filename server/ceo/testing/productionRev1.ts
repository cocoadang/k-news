/**
 * 운영 저장 판 1(2026-10-18 관리자 1회 초기화)의 발언 2건 — 운영 GET /api/ceo/dataset 응답에서 그대로 옮긴 회귀 기준.
 * ceo6가 같은 원문에서 같은 statementId·이력 키·처음 확인 시각을 이어 가는지 확인하는 데만 씁니다(운영 DB 접근 없음).
 */
import { CeoStatement } from '../../../src/ceo/types';

export const PROD_REV1_FIRST_VERIFIED = '2026-10-18T12:14:00.667Z';
export const PROD_REV1_EXTRACTOR = { name: 'ceo-composite', version: '1.0+q1.2+cbbfc454a08be8083', schemaVersion: 2 };

export const PROD_REV1_STATEMENTS: CeoStatement[] = [
  {
    statementId: 'st_97291118242500cb', personId: 'satya-nadella', companyId: 'msft', roleTitleAtTime: 'CEO', roleStatusAtTime: 'current',
    topicId: '클라우드 / 데이터센터',
    spokenAt: { value: '2025-01-29', precision: 'day', basisType: 'explicit_in_text', basis: '녹음된 실적 발표 통화의 행사 날짜 ("Wednesday January 29, 2025")', basisExcerpt: 'Wednesday January 29, 2025' },
    kind: 'direct_quote', quoteText: 'And, as AI becomes more efficient and accessible, we will see exponentially more demand', quoteLanguage: 'en', summaryKo: '',
    evidence: [{ articleId: '5f4e1efe6346c7d4bcfdbc5e525d9893', articleContentHash: '2bcf7bc13804501dadaf29b3b8a691399b06147cc17c2c38629c9089e54f5ee2',
      sourceName: 'Microsoft Investor Relations · Microsoft FY25 Q2 실적 발표 통화 기록', url: 'https://www.microsoft.com/en-us/investor/events/fy-2025/earnings-fy-2025-q2',
      articlePublishedAt: null, excerpt: 'And, as AI becomes more efficient and accessible, we will see exponentially more demand.' }],
    extractor: PROD_REV1_EXTRACTOR, isExample: false,
  },
  {
    statementId: 'st_a8856ddbe8a68f94', personId: 'satya-nadella', companyId: 'msft', roleTitleAtTime: 'CEO', roleStatusAtTime: 'current',
    topicId: '클라우드 / 데이터센터',
    spokenAt: { value: '2026-01-28', precision: 'day', basisType: 'explicit_in_text', basis: '녹음된 실적 발표 통화의 행사 날짜 ("Wednesday January 28, 2026")', basisExcerpt: 'Wednesday January 28, 2026' },
    kind: 'direct_quote', quoteText: 'The key metric we are optimizing for is tokens per watt per dollar', quoteLanguage: 'en', summaryKo: '',
    evidence: [{ articleId: '5848c714bdf17d88708f8d48a3ab3c86', articleContentHash: 'cc25c8ddee544b9e2fca87a8d9e1f905385988e1347795edbcbc5510c71b7050',
      sourceName: 'Microsoft Investor Relations · Microsoft FY26 Q2 실적 발표 통화 기록', url: 'https://www.microsoft.com/en-us/investor/events/fy-2026/earnings-fy-2026-q2',
      articlePublishedAt: null, excerpt: 'The key metric we are optimizing for is tokens per watt per dollar, which comes down to increasing utilization and decreasing TCO using silicon, systems, and software.' }],
    extractor: PROD_REV1_EXTRACTOR, isExample: false,
  },
];
