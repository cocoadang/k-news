/** OpenAI text adapter for the existing CEO summary ledger. Local byte-bound preflight; one Responses request, no retries/tools. */
import { ThinkingLevel } from '@google/genai';
import { OpenAITextClient as GoogleGenAI, resolveOpenAIModel } from '../openaiClient';
import { KoClient } from './koSummary';

export function createKoGeminiClient(): KoClient | null {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || apiKey === 'MY_OPENAI_API_KEY' || !apiKey.trim()) return null;
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
