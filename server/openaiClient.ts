/** Text-only OpenAI Responses adapter. Legacy result fields keep existing validators and ledgers intact. */
export const OPENAI_MODEL = 'gpt-6-luna';
export const resolveOpenAIModel = () => process.env.OPENAI_MODEL?.trim() || OPENAI_MODEL;

export function responseSchema(schema: any): any {
  if (!schema || typeof schema !== 'object') throw Error('AI_SCHEMA_INVALID');
  const type = String(schema.type || 'object').toLowerCase();
  const out: any = { type };
  if (schema.description) out.description = schema.description;
  if (schema.enum) out.enum = schema.enum;
  if (type === 'array') out.items = responseSchema(schema.items);
  if (type === 'object') {
    out.properties = {};
    const required = new Set(schema.required || []);
    for (const [key, value] of Object.entries(schema.properties || {})) {
      const child = responseSchema(value);
      out.properties[key] = required.has(key) ? child : { anyOf: [child, { type: 'null' }] };
    }
    out.required = Object.keys(out.properties);
    out.additionalProperties = false;
  }
  return out;
}

export function plainText(contents: any): string {
  if (typeof contents === 'string') return contents;
  if (Array.isArray(contents)) return contents.map(plainText).join('\n');
  if (contents && typeof contents.text === 'string') return contents.text;
  if (contents?.parts) return plainText(contents.parts);
  throw Error('AI_TEXT_INPUT_REQUIRED');
}

export class OpenAITextClient {
  private apiKey: string;
  private timeout: number;
  private fetcher: typeof fetch;
  constructor(options: { apiKey: string; httpOptions?: any; fetcher?: typeof fetch }) {
    if (!options.apiKey?.trim()) throw Error('OPENAI_API_KEY_REQUIRED');
    this.apiKey = options.apiKey;
    this.timeout = options.httpOptions?.timeout || 45000;
    this.fetcher = options.fetcher || fetch;
  }
  models = {
    // UTF-8 byte count is a deliberately conservative local bound, not a paid count request.
    countTokens: async (args: any): Promise<any> => ({ totalTokens: Buffer.byteLength(plainText(args.contents), 'utf8') + 256 }),
    generateContent: async (args: any): Promise<any> => {
      const config = args.config || {};
      if (config.tools?.length) throw Error('AI_TOOLS_NOT_SUPPORTED');
      const body: any = {
        model: resolveOpenAIModel(), store: false, stream: false,
        reasoning: { effort: 'none' },
        max_output_tokens: config.maxOutputTokens || 4096,
        input: plainText(args.contents),
      };
      if (config.systemInstruction) body.instructions = plainText(config.systemInstruction);
      if (config.responseSchema) body.text = { format: { type: 'json_schema', name: 'analysis', strict: true, schema: responseSchema(config.responseSchema) } };
      else if (config.responseMimeType === 'application/json') {
        body.instructions = [body.instructions, 'Return valid JSON only.'].filter(Boolean).join('\n');
        body.text = { format: { type: 'json_object' } };
      }
      let r: Response;
      try {
        r = await this.fetcher('https://api.openai.com/v1/responses', {
          method: 'POST', redirect: 'error',
          headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(body), signal: AbortSignal.timeout(config.httpOptions?.timeout || this.timeout),
        });
      } catch (e: any) { throw Error(/timeout|abort/i.test(e?.name || '') ? 'AI_TIMEOUT' : 'AI_NETWORK_ERROR'); }
      if (!r.ok) throw Object.assign(Error(`AI_HTTP_${r.status}`), { status: r.status });
      const result: any = await r.json();
      const parts = (result.output || []).filter((x: any) => x.type === 'message').flatMap((x: any) => x.content || []);
      if (result.status !== 'completed' || parts.some((x: any) => x.type === 'refusal')) throw Error('AI_RESPONSE_INCOMPLETE');
      const text = parts.filter((x: any) => x.type === 'output_text').map((x: any) => x.text).join('');
      if (!text) throw Error('AI_RESPONSE_EMPTY');
      const u = result.usage;
      if (!Number.isSafeInteger(u?.input_tokens) || !Number.isSafeInteger(u?.output_tokens)) throw Error('AI_USAGE_MISSING');
      const thinking = u.output_tokens_details?.reasoning_tokens || 0;
      const usageMetadata = { promptTokenCount: u.input_tokens, candidatesTokenCount: u.output_tokens - thinking,
        thoughtsTokenCount: thinking, totalTokenCount: u.input_tokens + u.output_tokens,
        cachedContentTokenCount: u.input_tokens_details?.cached_tokens || 0 };
      console.log('[OPENAI_USAGE]', JSON.stringify({ model: body.model, ...usageMetadata }));
      return { text, modelVersion: result.model || body.model, usageMetadata, candidates: [{ finishReason: 'STOP' }] };
    },
  };
}
