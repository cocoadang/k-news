export interface CompanyRenewalHistoryEntry {
  id: string;
  companyId: string;
  timestamp: string;
  status: 'success' | 'failed' | 'rolled_back';
  before: {
    searchKeywords: string[];
    coreBusinesses: string[];
  };
  after: {
    searchKeywords: string[];
    coreBusinesses: string[];
  };
  addedKeywords: string[];
  removedKeywords: string[];
  addedBusinesses: string[];
  removedBusinesses: string[];
  reason: string;
  evidenceArticleIds: string[];
  versionBefore?: number;
  versionAfter?: number;
}

export interface CompanyRenewalLock {
  lockedAt: string;
  leaseMs: number;
  token?: string;
  workerId?: string;
}

export interface CompanyProfile {
  id: string; // 'spacex', 'googl', 'tsla', 'msft', 'nvda'
  name: string; // 'Alphabet / Google'
  ticker?: string; // 'GOOGL'
  color: string; // '#4285F4'
  searchKeywords: string[];
  coreBusinesses: string[];
  importantKeywords: string[];
  lowImportanceKeywords: string[];
  competitorKeywords?: string[];
  enabled: boolean;
  // Pinned items (always preserved during auto renewal)
  pinnedSearchKeywords?: string[];
  pinnedCoreBusinesses?: string[];
  // Weekly auto renewal controls & audit
  autoWeeklyRenewalEnabled?: boolean; // default: true
  lastKeywordRenewalAttemptAt?: string;
  lastKeywordRenewalSuccessAt?: string;
  lastRenewalStatus?: 'success' | 'failed' | 'skipped' | 'rate_limited' | 'running';
  lastRenewalReason?: string;
  version?: number; // starts at 1, incremented on every update (human or AI)
  renewalHistory?: CompanyRenewalHistoryEntry[];
  renewalLock?: CompanyRenewalLock | null;
  updatedAt?: string;
}

export const INITIAL_COMPANIES: CompanyProfile[] = [
  {
    id: 'spacex',
    name: 'SpaceX',
    ticker: 'SpaceX (Private)',
    color: '#0ea5e9', // cyan-500
    searchKeywords: [
      'SpaceX Starship',
      'SpaceX Starlink',
      'SpaceX Starshield',
      'SpaceX IPO valuation',
      'SpaceX NASA Artemis',
      'SpaceX Pentagon DoD',
    ],
    coreBusinesses: ['Starship', 'Starlink', 'Starshield', 'Falcon 9 / Heavy'],
    pinnedSearchKeywords: ['SpaceX Starship', 'SpaceX Starlink', 'SpaceX IPO valuation'],
    pinnedCoreBusinesses: ['Starship', 'Starlink'],
    autoWeeklyRenewalEnabled: true,
    version: 1,
    renewalHistory: [],
    importantKeywords: [
      'IPO', '상장', 'valuation', '기업가치', 'funding', '자금조달', 'Starship', '스타십',
      'Starlink', '스타링크', 'Starshield', '스타실드', 'NASA', 'Artemis', '아르테미스',
      'FAA', 'Pentagon', 'DoD', 'NRO', '미국 국방부', '우주군', 'Space Force', '정부계약',
      'government contract', '화성', 'Mars', '발사 실패', '폭발', 'explosion', 'CAPEX',
      '생산시설', 'Starbase', '스타베이스'
    ],
    lowImportanceKeywords: [
      'routine launch', 'batch launch', 'falcon 9 batch', '일반 발사', '정기 발사'
    ],
    competitorKeywords: ['Blue Origin', 'Rocket Lab', 'ULA', 'Kuiper'],
    enabled: true,
  },
  {
    id: 'googl',
    name: 'Alphabet / Google',
    ticker: 'GOOGL',
    color: '#3b82f6', // blue-500
    searchKeywords: [
      'Google Gemini AI',
      'Google DeepMind',
      'Google Cloud revenue',
      'Google TPU AI',
      'Waymo robotaxi',
      'Alphabet antitrust DOJ',
    ],
    coreBusinesses: ['Gemini / DeepMind', 'Google Cloud', 'Google Search & Ads', 'Waymo Autonomous'],
    pinnedSearchKeywords: ['Google Gemini AI', 'Waymo robotaxi'],
    pinnedCoreBusinesses: ['Gemini / DeepMind', 'Google Cloud'],
    autoWeeklyRenewalEnabled: true,
    version: 1,
    renewalHistory: [],
    importantKeywords: [
      'Gemini', '제미나이', 'DeepMind', '딥마인드', 'AI 모델', 'AI Agent', 'TPU', 'Google Cloud',
      '구글 클라우드', '검색 점유율', 'AI 검색', 'AI Search', '광고 매출', 'YouTube', '유튜브',
      'Waymo', '웨이모', 'Android', '안드로이드', 'Chrome', '크롬', '반독점', 'Antitrust',
      'DOJ', '소송', '미국 규제', 'EU 규제', '데이터센터 투자', 'AI CAPEX', '인수합병', 'M&A',
      '실적', '매출', '영업이익', '경쟁력'
    ],
    lowImportanceKeywords: [
      'service update', 'app update', 'minor patch', 'doodle', '단순 업데이트', '앱 패치'
    ],
    competitorKeywords: ['OpenAI', 'Microsoft Copilot', 'Meta AI', 'Amazon AWS', 'Apple Intelligence'],
    enabled: true,
  },
  {
    id: 'tsla',
    name: 'Tesla',
    ticker: 'TSLA',
    color: '#ef4444', // red-500
    searchKeywords: [
      'Tesla deliveries production',
      'Tesla FSD Robotaxi',
      'Tesla Cybercab',
      'Tesla Optimus humanoid',
      'Tesla Megapack energy',
      'Tesla auto margin capex',
    ],
    coreBusinesses: ['EV (Model 3/Y/Cybercab)', 'FSD & Autonomous AI', 'Optimus Humanoid Robot', 'Energy Storage / Megapack'],
    pinnedSearchKeywords: ['Tesla deliveries production', 'Tesla FSD Robotaxi'],
    pinnedCoreBusinesses: ['EV (Model 3/Y/Cybercab)', 'FSD & Autonomous AI'],
    autoWeeklyRenewalEnabled: true,
    version: 1,
    renewalHistory: [],
    importantKeywords: [
      '차량 판매량', 'deliveries', '생산량', 'production', '가격 인하', '가격 인상', 'price cut',
      '자동차 마진', 'auto gross margin', 'FSD', 'Robotaxi', '로보택시', 'Cybercab', '사이버캡',
      'Optimus', '옵티머스', '휴머노이드', '자율주행 규제', 'FSD 승인', 'FSD approval',
      '신규 공장', 'Gigafactory', '생산능력', '4680 배터리', 'Megapack', '메가팩', 'Energy Storage',
      '중국 판매', '중국 인도량', '미국 판매', '유럽 판매', '신규 차량', 'Next-gen vehicle',
      'CAPEX', '실적', '매출', '영업이익', 'Elon Musk 경영 이슈', 'Musk compensation'
    ],
    lowImportanceKeywords: [
      'minor car crash', '단순 사고', 'SNS 발언', 'celebrity tweet'
    ],
    competitorKeywords: ['Waymo', 'BYD', 'Lucid', 'Rivian', 'Cruise'],
    enabled: true,
  },
  {
    id: 'msft',
    name: 'Microsoft',
    ticker: 'MSFT',
    color: '#10b981', // emerald-500
    searchKeywords: [
      'Microsoft Azure growth',
      'Microsoft Copilot AI',
      'Microsoft OpenAI investment',
      'Microsoft AI capex datacenters',
      'Microsoft Nvidia GPU purchase',
      'Microsoft Maia AI chip',
    ],
    coreBusinesses: ['Azure Cloud', 'Microsoft 365 / Copilot', 'OpenAI Alliance', 'Enterprise AI & Security'],
    pinnedSearchKeywords: ['Microsoft Azure growth', 'Microsoft Copilot AI'],
    pinnedCoreBusinesses: ['Azure Cloud', 'Microsoft 365 / Copilot'],
    autoWeeklyRenewalEnabled: true,
    version: 1,
    renewalHistory: [],
    importantKeywords: [
      'Azure', '애저', 'Azure 성장률', 'Azure growth', 'Microsoft 365', 'M365', 'Copilot',
      '코파일럿', 'AI 데이터센터', 'AI CAPEX', 'OpenAI', '오픈AI', 'Anthropic', '앤트로픽',
      'AI 투자', 'NVIDIA GPU 구매', 'GPU purchase', '자체 AI 칩', 'Maia', 'Cobalt',
      '클라우드 시장 점유율', 'Cloud market share', '기업용 AI', 'Enterprise AI',
      'Windows', 'GitHub', '깃허브', 'Activision', '액티비전', '인수합병', 'M&A',
      '독점 규제', '실적', '매출', '영업이익', 'AI 투자 수익성', 'AI monetization'
    ],
    lowImportanceKeywords: [
      'windows update', 'patch tuesday', '단순 윈도우 패치', '단순 버그 수정'
    ],
    competitorKeywords: ['Google Cloud', 'Amazon AWS', 'Meta', 'Salesforce'],
    enabled: true,
  },
  {
    id: 'nvda',
    name: 'NVIDIA',
    ticker: 'NVDA',
    color: '#84cc16', // lime-500
    searchKeywords: [
      'Nvidia Blackwell GPU',
      'Nvidia Rubin datacenter',
      'Nvidia datacenter revenue',
      'Nvidia TSMC HBM supply',
      'Nvidia China chip export restrictions',
      'Nvidia Hyperscaler capex',
    ],
    coreBusinesses: ['AI Accelerators (Blackwell / Rubin / H100 / B200)', 'Data Center GPU Systems', 'CUDA Software Ecosystem', 'Networking (NVLink / Spectrum-X)'],
    pinnedSearchKeywords: ['Nvidia Blackwell GPU', 'Nvidia datacenter revenue'],
    pinnedCoreBusinesses: ['AI Accelerators (Blackwell / Rubin / H100 / B200)', 'Data Center GPU Systems'],
    autoWeeklyRenewalEnabled: true,
    version: 1,
    renewalHistory: [],
    importantKeywords: [
      'GPU', 'AI Accelerator', 'AI 가속기', 'Blackwell', '블랙웰', 'Rubin', '루빈',
      '차세대 GPU', '데이터센터 매출', 'Datacenter revenue', 'GPU 수요', 'GPU demand',
      'GPU 공급', 'GPU supply', 'TSMC', 'HBM', 'SK hynix', 'SK하이닉스', 'Micron',
      '마이크론', 'Samsung Electronics', '삼성전자', 'CUDA', '쿠다', 'AI inference',
      'AI 추론', 'AI training', 'Hyperscaler CAPEX', '하이퍼스케일러 투자', 'Microsoft GPU',
      'Google GPU', 'Meta GPU', 'Amazon GPU', 'OpenAI GPU', '중국 수출규제', '중국 반도체 규제',
      'China export control', '중국용 GPU', '네트워킹', 'NVLink', 'Spectrum-X', '실적',
      '매출', '영업이익', '마진율', 'gross margin', '공급망', '대형 고객 주문'
    ],
    lowImportanceKeywords: [
      'geforce driver', 'gaming driver update', '단순 그래픽카드 드라이버'
    ],
    competitorKeywords: ['AMD Instinct', 'Intel Gaudi', 'Google TPU', 'AWS Trainium', 'Meta MTIA'],
    enabled: true,
  },
];
