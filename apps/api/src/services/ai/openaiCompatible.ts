import OpenAI, { toFile } from 'openai';
import type { AiProvider, JsonCompletionOptions, TextStreamOptions } from './provider.js';
import { env } from '../../config/env.js';
import { aiCalls } from '../../plugins/metrics.js';

/**
 * Works with any OpenAI-compatible chat completions endpoint: OpenAI, Gemini's compatibility layer,
 * DashScope (Qwen) compatible mode, Groq, Together, Ollama, vLLM, …
 */
export class OpenAiCompatibleProvider implements AiProvider {
  readonly name: string;
  readonly model: string;
  readonly configured = true;
  readonly audio: boolean;
  private readonly client: OpenAI;
  private readonly strongModel: string;

  constructor() {
    const e = env();
    this.client = new OpenAI({ apiKey: e.AI_API_KEY, baseURL: e.AI_BASE_URL, timeout: e.AI_TIMEOUT_MS, maxRetries: 2 });
    this.model = e.AI_MODEL;
    this.strongModel = e.AI_REASONING_MODEL ?? e.AI_MODEL;
    this.audio = e.AI_ENABLE_AUDIO;
    this.name = e.AI_BASE_URL ? `openai-compatible(${new URL(e.AI_BASE_URL).hostname})` : 'openai';
  }

  async completeJson<T>(opts: JsonCompletionOptions<T>): Promise<T> {
    const model = opts.strong ? this.strongModel : this.model;
    const messages = [
      { role: 'system' as const, content: `${opts.system}\n\nRespond with a single JSON object and nothing else.` },
      { role: 'user' as const, content: opts.user },
    ];
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await this.client.chat.completions.create({
          model,
          temperature: opts.temperature ?? 0.2,
          max_tokens: opts.maxTokens ?? 2000,
          response_format: { type: 'json_object' },
          messages:
            attempt === 0
              ? messages
              : [...messages, { role: 'user' as const, content: `Your previous answer was not valid for the required schema: ${String(lastError).slice(0, 500)}. Return corrected JSON only.` }],
        });
        const content = res.choices[0]?.message?.content ?? '';
        const parsed = opts.schema.safeParse(JSON.parse(stripFences(content)));
        if (parsed.success) {
          aiCalls.inc({ task: opts.task, provider: this.name, outcome: 'ok' });
          return parsed.data;
        }
        lastError = parsed.error.message;
      } catch (err) {
        lastError = err;
      }
    }
    aiCalls.inc({ task: opts.task, provider: this.name, outcome: 'error' });
    throw new Error(`AI task ${opts.task} failed: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
  }

  async *streamText(opts: TextStreamOptions): AsyncIterable<string> {
    const stream = await this.client.chat.completions.create({
      model: this.model,
      temperature: opts.temperature ?? 0.5,
      max_tokens: opts.maxTokens ?? 400,
      stream: true,
      messages: [
        { role: 'system', content: opts.system },
        { role: 'user', content: opts.user },
      ],
    });
    try {
      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content;
        if (delta) yield delta;
      }
      aiCalls.inc({ task: opts.task, provider: this.name, outcome: 'ok' });
    } catch (err) {
      aiCalls.inc({ task: opts.task, provider: this.name, outcome: 'error' });
      throw err;
    }
  }

  async transcribe(audio: Buffer, filename: string, mime: string): Promise<string> {
    const file = await toFile(audio, filename, { type: mime });
    const res = await this.client.audio.transcriptions.create({ file, model: env().AI_STT_MODEL, response_format: 'json' });
    return (res as { text: string }).text;
  }

  async speak(text: string): Promise<{ audio: Buffer; mime: string }> {
    const res = await this.client.audio.speech.create({
      model: env().AI_TTS_MODEL,
      voice: env().AI_TTS_VOICE,
      input: text.slice(0, 4000),
      response_format: 'mp3',
    });
    return { audio: Buffer.from(await res.arrayBuffer()), mime: 'audio/mpeg' };
  }
}

const stripFences = (s: string) => s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
