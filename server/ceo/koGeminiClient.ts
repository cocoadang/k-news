/**
 * CEO 한국어 요약 전용 Gemini 어댑터 — 기존 서버의 GEMINI_API_KEY와 @google/genai(설치 2.19.0)를 재사용(새 키·별도 서비스 없음).
 * 기존 뉴스 분석(geminiAnalyzer)·수집·알림 함수는 불러오지 않습니다. 이 파일만 SDK를 import합니다.
 * 단일 요청 경로 (PC 실제 SDK 2.19.0 + 가짜 네트워크로 확인):
 * - 재시도 차단: httpOptions.retryOptions.attempts = 1 (SDK가 인식, 429·500 각 1회 요청)
 * - 도구·MCP·채팅 세션·스트리밍 없이 models.generateContent만 사용 → SDK의 자동 함수 호출 루프에 들어가지 않음
 *   (callable tools가 없으면 내부 요청 1회 반환; MAX_TOKENS·functionCall 응답도 각 1요청)
 * - 후보 1개, JSON 텍스트, 사고 수준 LOW, maxOutputTokens(사고 포함) 고정, 그라운딩·캐시·배치 없음
 * - countTokens와 generateContent에 같은 contents(한 문자열)만 보냄(systemInstruction·responseSchema 없음 → 계수 누락 없음)
 * 설정 객체는 SDK 타입 그대로(as any 없음) — SDK에 없는 필드는 타입 검사에서 드러납니다.
 */
import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import { KoClient } from './koSummary';

export function createKoGeminiClient(): KoClient | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY' || !apiKey.trim()) return null;
  const ai = new GoogleGenAI({ apiKey, httpOptions: { headers: { 'User-Agent': 'aistudio-build' }, retryOptions: { attempts: 1 } } });
  return {
    countTokens: async ({ model, contents }) => {
      const r = await ai.models.countTokens({ model, contents, config: { httpOptions: { retryOptions: { attempts: 1 }, timeout: 10_000 } } });
      return { totalTokens: r.totalTokens };
    },
    generate: async ({ model, contents, maxOutputTokens, timeoutMs }) => {
      const r = await ai.models.generateContent({
        model, contents,
        config: {
          responseMimeType: 'application/json', candidateCount: 1, maxOutputTokens, temperature: 0.2,
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          httpOptions: { retryOptions: { attempts: 1 }, timeout: timeoutMs },
        },
      });
      return { text: r.text, modelVersion: r.modelVersion, usageMetadata: r.usageMetadata };
    },
  };
}
