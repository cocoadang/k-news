/* 자동 생성 파일 (server/ceo/generateExample.ts). 직접 고치지 마세요.
 * 모든 인물·회사·매체·발언은 가상(예시)입니다. */
import { CeoDataset } from './types';

export const EXAMPLE_CEO_DATASET: CeoDataset = {
  "schemaVersion": 2,
  "isExample": true,
  "persons": [
    {
      "personId": "ex-han-seoyun-mobility",
      "displayName": "한서윤",
      "nameVariants": [
        "Han Seo-yun",
        "한 대표"
      ],
      "isExample": true
    },
    {
      "personId": "ex-han-seoyun-bio",
      "displayName": "한서윤",
      "nameVariants": [],
      "isExample": true
    },
    {
      "personId": "ex-oh-taemin",
      "displayName": "오태민",
      "nameVariants": [],
      "isExample": true
    },
    {
      "personId": "ex-mark-rivers",
      "displayName": "마크 리버스",
      "nameVariants": [
        "Mark Rivers",
        "Rivers",
        "리버스"
      ],
      "isExample": true
    },
    {
      "personId": "ex-do-harin",
      "displayName": "도하린",
      "nameVariants": [],
      "isExample": true
    }
  ],
  "roles": [
    {
      "personId": "ex-han-seoyun-mobility",
      "companyId": "ex-mobility",
      "companyName": "예시모빌리티",
      "title": "대표이사(CEO)",
      "roleType": "ceo",
      "start": "2021-03",
      "end": null
    },
    {
      "personId": "ex-han-seoyun-bio",
      "companyId": "ex-bio",
      "companyName": "예시바이오",
      "title": "최고재무책임자(CFO)",
      "roleType": "other",
      "start": "2019-01",
      "end": "2025-06"
    },
    {
      "personId": "ex-han-seoyun-bio",
      "companyId": "ex-bio",
      "companyName": "예시바이오",
      "title": "대표이사(CEO)",
      "roleType": "ceo",
      "start": "2025-07",
      "end": null
    },
    {
      "personId": "ex-oh-taemin",
      "companyId": "ex-mobility",
      "companyName": "예시모빌리티",
      "title": "대표이사(CEO)",
      "roleType": "ceo",
      "start": "2015-01",
      "end": "2021-02"
    },
    {
      "personId": "ex-oh-taemin",
      "companyId": "ex-energy",
      "companyName": "예시에너지",
      "title": "대표이사(CEO)",
      "roleType": "ceo",
      "start": "2022-06",
      "end": null
    },
    {
      "personId": "ex-mark-rivers",
      "companyId": "ex-cloud",
      "companyName": "예시클라우드",
      "title": "공동대표(Co-CEO)",
      "roleType": "co_ceo",
      "start": "2024-01",
      "end": null
    },
    {
      "personId": "ex-do-harin",
      "companyId": "ex-cloud",
      "companyName": "예시클라우드",
      "title": "공동대표(Co-CEO)",
      "roleType": "co_ceo",
      "start": "2024-01",
      "end": null
    }
  ],
  "topics": [
    {
      "topicId": "autonomy_timeline",
      "label": "자율주행 상용화 일정"
    },
    {
      "topicId": "pricing",
      "label": "요금·가격 정책"
    },
    {
      "topicId": "rd_investment",
      "label": "연구개발 투자"
    },
    {
      "topicId": "capex",
      "label": "설비 투자"
    },
    {
      "topicId": "ai_capex",
      "label": "데이터센터·AI 투자"
    }
  ],
  "statements": [
    {
      "statementId": "st_00d1d9646521c1e9",
      "personId": "ex-oh-taemin",
      "companyId": "ex-mobility",
      "roleTitleAtTime": "대표이사(CEO)",
      "roleStatusAtTime": "former",
      "topicId": "autonomy_timeline",
      "spokenAt": {
        "value": "2022-03-07",
        "precision": "day",
        "basisType": "explicit_in_text",
        "basis": "본문 \"2022년 3월 7일 한 포럼에서\"",
        "basisExcerpt": "2022년 3월 7일 한 포럼에서"
      },
      "kind": "direct_quote",
      "quoteText": "자율주행 상용화는 생각보다 빨리 온다",
      "quoteLanguage": "ko",
      "summaryKo": "자율주행 상용화는 예상보다 빨리 온다",
      "context": {
        "text": "대표 퇴임 후 개인 자격으로 참석한 포럼",
        "sources": [
          {
            "articleId": "ex-c2",
            "excerpt": "이번에 개인 자격으로 참석했다"
          }
        ]
      },
      "evidence": [
        {
          "articleId": "ex-c2",
          "articleContentHash": "721f22525b0b6dd35b3cabf6dea07d3f5deffa7f2971c20f64aeb2f80da87545",
          "sourceName": "예시일보",
          "url": "https://example.invalid/articles/ex-c2",
          "articlePublishedAt": "2022-03-08T01:00:00.000Z",
          "excerpt": "\"자율주행 상용화는 생각보다 빨리 온다\"고 말했다"
        }
      ],
      "extractor": {
        "name": "fixture-extractor",
        "version": "1.0",
        "schemaVersion": 2
      },
      "isExample": true,
      "referenceDate": {
        "value": "2022-03-07",
        "precision": "day",
        "basis": "spoken"
      }
    },
    {
      "statementId": "st_06aed8346a8f977d",
      "personId": "ex-han-seoyun-bio",
      "companyId": "ex-bio",
      "roleTitleAtTime": "대표이사(CEO)",
      "roleStatusAtTime": "current",
      "topicId": "rd_investment",
      "spokenAt": {
        "value": "2025-08-01",
        "precision": "day",
        "basisType": "explicit_in_text",
        "basis": "본문 \"2025년 8월 1일 취임 후 첫 간담회에서\"",
        "basisExcerpt": "2025년 8월 1일 취임 후 첫 간담회에서"
      },
      "kind": "direct_quote",
      "quoteText": "연구개발 투자를 줄이지 않겠다",
      "quoteLanguage": "ko",
      "summaryKo": "연구개발 투자를 줄이지 않겠다",
      "context": {
        "text": "대표 취임 직후 첫 간담회",
        "sources": [
          {
            "articleId": "ex-b1",
            "excerpt": "신임 대표는 2025년 8월 1일 취임 후 첫 간담회에서"
          }
        ]
      },
      "evidence": [
        {
          "articleId": "ex-b1",
          "articleContentHash": "185f9da6a7eee62227a7e7e140c26e04647bf2648eed2b93131e6258acfdc74d",
          "sourceName": "예시바이오뉴스",
          "url": "https://example.invalid/articles/ex-b1",
          "articlePublishedAt": "2025-08-02T01:00:00.000Z",
          "excerpt": "\"연구개발 투자를 줄이지 않겠다\"고 말했다"
        }
      ],
      "extractor": {
        "name": "fixture-extractor",
        "version": "1.0",
        "schemaVersion": 2
      },
      "isExample": true,
      "referenceDate": {
        "value": "2025-08-01",
        "precision": "day",
        "basis": "spoken"
      }
    },
    {
      "statementId": "st_1799d64d87c10238",
      "personId": "ex-han-seoyun-bio",
      "companyId": "ex-bio",
      "roleTitleAtTime": "대표이사(CEO)",
      "roleStatusAtTime": "current",
      "topicId": "rd_investment",
      "spokenAt": {
        "value": "2026-02-09",
        "precision": "day",
        "basisType": "explicit_in_text",
        "basis": "본문 \"2026년 2월 9일 실적 발표에서\"",
        "basisExcerpt": "2026년 2월 9일 실적 발표에서"
      },
      "kind": "direct_quote",
      "quoteText": "비용 효율화를 위해 일부 연구 과제를 정리한다",
      "quoteLanguage": "ko",
      "summaryKo": "비용 효율화를 위해 일부 연구 과제 정리",
      "context": {
        "text": "지난해 4분기 임상 1건 중단 이후",
        "sources": [
          {
            "articleId": "ex-b2",
            "excerpt": "지난해 4분기 임상 1건이 중단된 뒤 방향을 바꿨다"
          }
        ]
      },
      "evidence": [
        {
          "articleId": "ex-b2",
          "articleContentHash": "29bb47e1786d3b519a668ee4cd34fed884aba8312641f9e6e30c2079453162ea",
          "sourceName": "예시바이오뉴스",
          "url": "https://example.invalid/articles/ex-b2",
          "articlePublishedAt": "2026-02-10T01:00:00.000Z",
          "excerpt": "\"비용 효율화를 위해 일부 연구 과제를 정리한다\"고 밝혔다"
        }
      ],
      "extractor": {
        "name": "fixture-extractor",
        "version": "1.0",
        "schemaVersion": 2
      },
      "isExample": true,
      "referenceDate": {
        "value": "2026-02-09",
        "precision": "day",
        "basis": "spoken"
      }
    },
    {
      "statementId": "st_1fb7af6cd27c6065",
      "personId": "ex-han-seoyun-mobility",
      "companyId": "ex-mobility",
      "roleTitleAtTime": "대표이사(CEO)",
      "roleStatusAtTime": "current",
      "topicId": "autonomy_timeline",
      "spokenAt": {
        "value": "2026-03-14",
        "precision": "day",
        "basisType": "explicit_in_text",
        "basis": "본문 \"2026년 3월 14일 열린 주주총회에서\"",
        "basisExcerpt": "2026년 3월 14일 열린 주주총회에서"
      },
      "kind": "direct_quote",
      "quoteText": "올해는 운행 지역을 두 곳 더 늘린다",
      "quoteLanguage": "ko",
      "summaryKo": "올해 운행 지역을 두 곳 추가",
      "evidence": [
        {
          "articleId": "ex-a5",
          "articleContentHash": "eb4ce0f7931b060996dcd9e2dcd03bea3f986eacbe9864d99231e2680a9292e3",
          "sourceName": "예시일보",
          "url": "https://example.invalid/articles/ex-a5",
          "articlePublishedAt": "2026-03-14T09:00:00.000Z",
          "excerpt": "\"올해는 운행 지역을 두 곳 더 늘린다\"고 덧붙였다"
        }
      ],
      "eventKey": "han-mob-2026-03-14-agm",
      "extractor": {
        "name": "fixture-extractor",
        "version": "1.0",
        "schemaVersion": 2
      },
      "isExample": true,
      "referenceDate": {
        "value": "2026-03-14",
        "precision": "day",
        "basis": "spoken"
      }
    },
    {
      "statementId": "st_2a8efedb2ab2ee1e",
      "personId": "ex-do-harin",
      "companyId": "ex-cloud",
      "roleTitleAtTime": "공동대표(Co-CEO)",
      "roleStatusAtTime": "current",
      "topicId": "ai_capex",
      "spokenAt": {
        "value": "2026-01-19",
        "precision": "day",
        "basisType": "explicit_in_text",
        "basis": "본문 \"도하린 공동대표는 2026년 1월 19일\"",
        "basisExcerpt": "도하린 공동대표는 2026년 1월 19일"
      },
      "kind": "direct_quote",
      "quoteText": "데이터센터 투자는 수익성을 보며 속도를 조절하겠다",
      "quoteLanguage": "ko",
      "summaryKo": "수익성을 보며 투자 속도 조절",
      "evidence": [
        {
          "articleId": "ex-d2",
          "articleContentHash": "6bdeadd15b30f97707099bc30525eb7d06710bbb4d3d92eee347f12e598a0902",
          "sourceName": "예시경제",
          "url": "https://example.invalid/articles/ex-d2",
          "articlePublishedAt": "2026-01-20T01:00:00.000Z",
          "excerpt": "\"데이터센터 투자는 수익성을 보며 속도를 조절하겠다\"고 말했다"
        }
      ],
      "extractor": {
        "name": "fixture-extractor",
        "version": "1.0",
        "schemaVersion": 2
      },
      "isExample": true,
      "referenceDate": {
        "value": "2026-01-19",
        "precision": "day",
        "basis": "spoken"
      }
    },
    {
      "statementId": "st_356ad3ef7613b646",
      "personId": "ex-han-seoyun-mobility",
      "companyId": "ex-mobility",
      "roleTitleAtTime": "대표이사(CEO)",
      "roleStatusAtTime": "current",
      "topicId": "autonomy_timeline",
      "spokenAt": {
        "value": "2026-03-14",
        "precision": "day",
        "basisType": "explicit_in_text",
        "basis": "본문 \"2026년 3월 14일 열린 주주총회에서\"",
        "basisExcerpt": "2026년 3월 14일 열린 주주총회에서"
      },
      "kind": "direct_quote",
      "quoteText": "상용화 시점을 약속하지 않겠다. 안전 데이터가 먼저다",
      "quoteLanguage": "ko",
      "summaryKo": "상용화 시점을 약속하지 않겠다",
      "evidence": [
        {
          "articleId": "ex-a5",
          "articleContentHash": "eb4ce0f7931b060996dcd9e2dcd03bea3f986eacbe9864d99231e2680a9292e3",
          "sourceName": "예시일보",
          "url": "https://example.invalid/articles/ex-a5",
          "articlePublishedAt": "2026-03-14T09:00:00.000Z",
          "excerpt": "\"상용화 시점을 약속하지 않겠다. 안전 데이터가 먼저다\"라고 말했다"
        },
        {
          "articleId": "ex-a4",
          "articleContentHash": "6cc8f7eed63cba5a8aa410c6f4e8c11d670a676b8f3f38d7c02ae34151d1a5ee",
          "sourceName": "예시경제",
          "url": "https://example.invalid/articles/ex-a4",
          "articlePublishedAt": "2026-03-15T00:30:00.000Z",
          "excerpt": "\"상용화 시점을 약속하지 않겠다. 안전 데이터가 먼저다\"라고 밝혔다"
        }
      ],
      "eventKey": "han-mob-2026-03-14-agm",
      "extractor": {
        "name": "fixture-extractor",
        "version": "1.0",
        "schemaVersion": 2
      },
      "isExample": true,
      "referenceDate": {
        "value": "2026-03-14",
        "precision": "day",
        "basis": "spoken"
      }
    },
    {
      "statementId": "st_5d29ba894e8f39d4",
      "personId": "ex-han-seoyun-mobility",
      "companyId": "ex-mobility",
      "roleTitleAtTime": "대표이사(CEO)",
      "roleStatusAtTime": "unknown",
      "topicId": "autonomy_timeline",
      "spokenAt": {
        "value": null,
        "precision": "unknown",
        "basisType": "none",
        "basis": "날짜 형식·정밀도·근거 유형이 맞지 않아 미상으로 처리"
      },
      "kind": "paraphrase",
      "summaryKo": "규제 승인 절차가 길어지면 무인 서비스 일정이 늦어질 수 있다",
      "context": {
        "text": "1월 당국의 자율주행 안전 기준 개정안 발표 이후",
        "sources": [
          {
            "articleId": "ex-a3",
            "excerpt": "앞서 1월 당국은 자율주행 안전 기준 개정안을 발표했다"
          }
        ]
      },
      "evidence": [
        {
          "articleId": "ex-a3",
          "articleContentHash": "6eb17a97326ee79b97d5023a7ae90eb54620ae0f724bd3ac77e123f6b017f9fe",
          "sourceName": "예시일보",
          "url": "https://example.invalid/articles/ex-a3",
          "articlePublishedAt": "2025-02-11T02:00:00.000Z",
          "excerpt": "규제 당국의 승인 절차가 길어지면 무인 서비스 일정이 늦어질 수 있다는 취지로 말했다"
        }
      ],
      "extractor": {
        "name": "fixture-extractor",
        "version": "1.0",
        "schemaVersion": 2
      },
      "isExample": true
    },
    {
      "statementId": "st_5da77adee62700df",
      "personId": "ex-oh-taemin",
      "companyId": "ex-energy",
      "roleTitleAtTime": "대표이사(CEO)",
      "roleStatusAtTime": "before",
      "topicId": "capex",
      "spokenAt": {
        "value": "2022-05-19",
        "precision": "day",
        "basisType": "explicit_in_text",
        "basis": "본문 \"오태민 전 예시모빌리티 대표는 2022년 5월 19일\"",
        "basisExcerpt": "오태민 전 예시모빌리티 대표는 2022년 5월 19일"
      },
      "kind": "direct_quote",
      "quoteText": "에너지 저장 사업에 집중하겠다",
      "quoteLanguage": "ko",
      "summaryKo": "에너지 저장 사업에 집중",
      "evidence": [
        {
          "articleId": "ex-c4",
          "articleContentHash": "a2bd63fc4b3ccb2b46e656438d869768a701db2134b27e2c1668898a2f0f8782",
          "sourceName": "예시일보",
          "url": "https://example.invalid/articles/ex-c4",
          "articlePublishedAt": "2022-05-20T01:00:00.000Z",
          "excerpt": "\"에너지 저장 사업에 집중하겠다\"고 말했다"
        }
      ],
      "extractor": {
        "name": "fixture-extractor",
        "version": "1.0",
        "schemaVersion": 2
      },
      "isExample": true,
      "referenceDate": {
        "value": "2022-05-19",
        "precision": "day",
        "basis": "spoken"
      }
    },
    {
      "statementId": "st_7b9e187d02f4f0e4",
      "personId": "ex-oh-taemin",
      "companyId": "ex-mobility",
      "roleTitleAtTime": "대표이사(CEO)",
      "roleStatusAtTime": "current",
      "topicId": "autonomy_timeline",
      "spokenAt": {
        "value": "2020-11-04",
        "precision": "day",
        "basisType": "explicit_in_text",
        "basis": "본문 \"오태민 대표는 2020년 11월 4일\"",
        "basisExcerpt": "오태민 대표는 2020년 11월 4일"
      },
      "kind": "direct_quote",
      "quoteText": "자율주행은 10년 뒤의 이야기",
      "quoteLanguage": "ko",
      "summaryKo": "자율주행은 10년 뒤의 일",
      "evidence": [
        {
          "articleId": "ex-c1",
          "articleContentHash": "c8a31b86ac64da0c44754d9872fcccbf4bfff1beae20c66267f09e1e9857f53b",
          "sourceName": "예시경제",
          "url": "https://example.invalid/articles/ex-c1",
          "articlePublishedAt": "2020-11-05T01:00:00.000Z",
          "excerpt": "\"자율주행은 10년 뒤의 이야기\"라고 말했다"
        }
      ],
      "extractor": {
        "name": "fixture-extractor",
        "version": "1.0",
        "schemaVersion": 2
      },
      "isExample": true,
      "referenceDate": {
        "value": "2020-11-04",
        "precision": "day",
        "basis": "spoken"
      }
    },
    {
      "statementId": "st_82549f166fc0aaeb",
      "personId": "ex-han-seoyun-mobility",
      "companyId": "ex-mobility",
      "roleTitleAtTime": "대표이사(CEO)",
      "roleStatusAtTime": "current",
      "topicId": "autonomy_timeline",
      "spokenAt": {
        "value": "2024-05-20",
        "precision": "day",
        "basisType": "explicit_in_text",
        "basis": "본문 \"said on May 20, 2024\"",
        "basisExcerpt": "said on May 20, 2024"
      },
      "kind": "direct_quote",
      "quoteText": "we believe we can launch a fully driverless service this year",
      "quoteLanguage": "en",
      "summaryKo": "연내 완전 무인 서비스 출시가 가능하다고 봄",
      "evidence": [
        {
          "articleId": "ex-a2",
          "articleContentHash": "621158c10b5b71acec46e406ffd82ad000d7d3d8199891298ed274e02a9eb76e",
          "sourceName": "Example Wire",
          "url": "https://example.invalid/articles/ex-a2",
          "articlePublishedAt": "2024-05-20T23:00:00.000Z",
          "excerpt": "\"we believe we can launch a fully driverless service this year.\""
        }
      ],
      "eventKey": "han-mob-2024-05-20-investor-day",
      "extractor": {
        "name": "fixture-extractor",
        "version": "1.0",
        "schemaVersion": 2
      },
      "isExample": true,
      "referenceDate": {
        "value": "2024-05-20",
        "precision": "day",
        "basis": "spoken"
      }
    },
    {
      "statementId": "st_a15b37a8a17ce6f5",
      "personId": "ex-mark-rivers",
      "companyId": "ex-cloud",
      "roleTitleAtTime": "공동대표(Co-CEO)",
      "roleStatusAtTime": "current",
      "topicId": "ai_capex",
      "spokenAt": {
        "value": "2026-01-20",
        "precision": "day",
        "basisType": "explicit_in_text",
        "basis": "본문 \"said on Jan. 20, 2026\"",
        "basisExcerpt": "said on Jan. 20, 2026"
      },
      "kind": "direct_quote",
      "quoteText": "stay the course",
      "quoteLanguage": "en",
      "summaryKo": "증설 계획을 그대로 유지",
      "evidence": [
        {
          "articleId": "ex-d3",
          "articleContentHash": "01dca3e983a4e738e01eca17b64ac376e1b9fc22714212bf7de608d49354410b",
          "sourceName": "Example Wire",
          "url": "https://example.invalid/articles/ex-d3",
          "articlePublishedAt": "2026-01-21T01:00:00.000Z",
          "excerpt": "the company would \"stay the course\" on capacity plans"
        }
      ],
      "extractor": {
        "name": "fixture-extractor",
        "version": "1.0",
        "schemaVersion": 2
      },
      "isExample": true,
      "referenceDate": {
        "value": "2026-01-20",
        "precision": "day",
        "basis": "spoken"
      }
    },
    {
      "statementId": "st_be1a06d56a18f778",
      "personId": "ex-han-seoyun-mobility",
      "companyId": "ex-mobility",
      "roleTitleAtTime": "대표이사(CEO)",
      "roleStatusAtTime": "current",
      "topicId": "autonomy_timeline",
      "spokenAt": {
        "value": "2025",
        "precision": "year",
        "basisType": "explicit_in_text",
        "basis": "본문 \"2025년 한 해 동안 여러 차례\"",
        "basisExcerpt": "2025년 한 해 동안 여러 차례"
      },
      "kind": "interpretation",
      "summaryKo": "무인 서비스 출시가 2026년 이후가 될 것이라는 뜻을 여러 차례 내비침(기사 해석)",
      "evidence": [
        {
          "articleId": "ex-a7",
          "articleContentHash": "977b53552a68b5dd75b46f9af36f972df3affdf2ff8e56830aa3ca7f7f9fb480",
          "sourceName": "예시일보",
          "url": "https://example.invalid/articles/ex-a7",
          "articlePublishedAt": "2025-12-30T05:00:00.000Z",
          "excerpt": "무인 서비스 출시가 내년 이후가 될 것이라는 뜻을 내비쳤다"
        }
      ],
      "extractor": {
        "name": "fixture-extractor",
        "version": "1.0",
        "schemaVersion": 2
      },
      "isExample": true,
      "referenceDate": {
        "value": "2025",
        "precision": "year",
        "basis": "spoken"
      }
    },
    {
      "statementId": "st_caf032625005818f",
      "personId": "ex-han-seoyun-mobility",
      "companyId": "ex-mobility",
      "roleTitleAtTime": "대표이사(CEO)",
      "roleStatusAtTime": "unknown",
      "topicId": "autonomy_timeline",
      "spokenAt": {
        "value": null,
        "precision": "unknown",
        "basisType": "none",
        "basis": "본문에 발언 시점 없음 (\"최근 인터뷰\")"
      },
      "kind": "paraphrase",
      "summaryKo": "무인 서비스는 도시별로 단계적으로 확대",
      "evidence": [
        {
          "articleId": "ex-a6",
          "articleContentHash": "6808c0eaf33bc1070d9d0a503c65940769227a10a0bdd898bd72197d746b6df9",
          "sourceName": "예시경제",
          "url": "https://example.invalid/articles/ex-a6",
          "articlePublishedAt": "2025-09-03T03:00:00.000Z",
          "excerpt": "무인 서비스는 도시별로 단계적으로 확대할 것이라고 설명했다"
        }
      ],
      "extractor": {
        "name": "fixture-extractor",
        "version": "1.0",
        "schemaVersion": 2
      },
      "isExample": true
    },
    {
      "statementId": "st_cbc3854ea49adbc7",
      "personId": "ex-mark-rivers",
      "companyId": "ex-cloud",
      "roleTitleAtTime": "공동대표(Co-CEO)",
      "roleStatusAtTime": "current",
      "topicId": "ai_capex",
      "spokenAt": {
        "value": "2025-06-11",
        "precision": "day",
        "basisType": "explicit_in_text",
        "basis": "본문 \"said on June 11, 2025\"",
        "basisExcerpt": "said on June 11, 2025"
      },
      "kind": "direct_quote",
      "quoteText": "We will double our data center spending next year.",
      "quoteLanguage": "en",
      "summaryKo": "내년 데이터센터 투자를 두 배로 늘리겠다",
      "evidence": [
        {
          "articleId": "ex-d1",
          "articleContentHash": "041c948ba90f1dafdcff1d71875c119849153154d87189fe044cd04a04c1be8d",
          "sourceName": "Example Wire",
          "url": "https://example.invalid/articles/ex-d1",
          "articlePublishedAt": "2025-06-12T01:00:00.000Z",
          "excerpt": "\"We will double our data center spending next year.\""
        }
      ],
      "extractor": {
        "name": "fixture-extractor",
        "version": "1.0",
        "schemaVersion": 2
      },
      "isExample": true,
      "referenceDate": {
        "value": "2025-06-11",
        "precision": "day",
        "basis": "spoken"
      }
    },
    {
      "statementId": "st_d308c30917857ffc",
      "personId": "ex-han-seoyun-mobility",
      "companyId": "ex-mobility",
      "roleTitleAtTime": "대표이사(CEO)",
      "roleStatusAtTime": "current",
      "topicId": "pricing",
      "spokenAt": {
        "value": "2026-03-14",
        "precision": "day",
        "basisType": "explicit_in_text",
        "basis": "본문 \"2026년 3월 14일 열린 주주총회에서\"",
        "basisExcerpt": "2026년 3월 14일 열린 주주총회에서"
      },
      "kind": "direct_quote",
      "quoteText": "구독 요금은 당분간 동결한다",
      "quoteLanguage": "ko",
      "summaryKo": "구독 요금을 당분간 동결",
      "evidence": [
        {
          "articleId": "ex-a5",
          "articleContentHash": "eb4ce0f7931b060996dcd9e2dcd03bea3f986eacbe9864d99231e2680a9292e3",
          "sourceName": "예시일보",
          "url": "https://example.invalid/articles/ex-a5",
          "articlePublishedAt": "2026-03-14T09:00:00.000Z",
          "excerpt": "\"구독 요금은 당분간 동결한다\"고 했다"
        }
      ],
      "eventKey": "han-mob-2026-03-14-agm",
      "extractor": {
        "name": "fixture-extractor",
        "version": "1.0",
        "schemaVersion": 2
      },
      "isExample": true,
      "referenceDate": {
        "value": "2026-03-14",
        "precision": "day",
        "basis": "spoken"
      }
    },
    {
      "statementId": "st_e08247e3f5d8bd42",
      "personId": "ex-han-seoyun-mobility",
      "companyId": "ex-mobility",
      "roleTitleAtTime": "대표이사(CEO)",
      "roleStatusAtTime": "current",
      "topicId": "autonomy_timeline",
      "spokenAt": {
        "value": "2024-05-20",
        "precision": "day",
        "basisType": "explicit_in_text",
        "basis": "본문 \"2024년 5월 20일 연례 투자자 행사에서\"",
        "basisExcerpt": "2024년 5월 20일 연례 투자자 행사에서"
      },
      "kind": "direct_quote",
      "quoteText": "올해 안에 완전 무인 서비스를 시작할 수 있다고 본다",
      "quoteLanguage": "ko",
      "summaryKo": "연내 완전 무인 서비스 시작이 가능하다고 전망",
      "context": {
        "text": "이달 초 도심 시범 운행 허가를 받은 직후",
        "sources": [
          {
            "articleId": "ex-a1",
            "excerpt": "회사는 이달 초 도심 시범 운행 허가를 받았다"
          }
        ]
      },
      "evidence": [
        {
          "articleId": "ex-a1",
          "articleContentHash": "f990c0ce60d5afe78da707f00514b6a80321631da0a4d7eb176acfe7400821f6",
          "sourceName": "예시경제",
          "url": "https://example.invalid/articles/ex-a1",
          "articlePublishedAt": "2024-05-21T01:00:00.000Z",
          "excerpt": "\"올해 안에 완전 무인 서비스를 시작할 수 있다고 본다\"고 말했다"
        }
      ],
      "eventKey": "han-mob-2024-05-20-investor-day",
      "extractor": {
        "name": "fixture-extractor",
        "version": "1.0",
        "schemaVersion": 2
      },
      "isExample": true,
      "referenceDate": {
        "value": "2024-05-20",
        "precision": "day",
        "basis": "spoken"
      }
    },
    {
      "statementId": "st_f3e6e1970b587852",
      "personId": "ex-oh-taemin",
      "companyId": "ex-energy",
      "roleTitleAtTime": "대표이사(CEO)",
      "roleStatusAtTime": "current",
      "topicId": "capex",
      "spokenAt": {
        "value": "2023-01-09",
        "precision": "day",
        "basisType": "explicit_in_text",
        "basis": "본문 \"오태민 예시에너지 대표는 2023년 1월 9일\"",
        "basisExcerpt": "오태민 예시에너지 대표는 2023년 1월 9일"
      },
      "kind": "direct_quote",
      "quoteText": "배터리 공장 증설은 수요를 확인한 뒤 결정한다",
      "quoteLanguage": "ko",
      "summaryKo": "공장 증설은 수요 확인 후 결정",
      "evidence": [
        {
          "articleId": "ex-c3",
          "articleContentHash": "3831a48dcb25099a31f1d0ac93f9b6bd3745352aaceff873bf419ef67e65dffc",
          "sourceName": "예시경제",
          "url": "https://example.invalid/articles/ex-c3",
          "articlePublishedAt": "2023-01-10T01:00:00.000Z",
          "excerpt": "\"배터리 공장 증설은 수요를 확인한 뒤 결정한다\"고 말했다"
        }
      ],
      "extractor": {
        "name": "fixture-extractor",
        "version": "1.0",
        "schemaVersion": 2
      },
      "isExample": true,
      "referenceDate": {
        "value": "2023-01-09",
        "precision": "day",
        "basis": "spoken"
      }
    }
  ],
  "comparisons": [],
  "heldBackCount": 2,
  "unavailableArticles": {
    "pending": 0,
    "failed": 0
  }
};
