import { Injectable, Logger } from '@nestjs/common';
import { env } from '../config/env.js';

export const TRANSLATE_LANGUAGES: Record<string, string> = { en: 'English', fr: 'French', ar: 'Arabic' };

/**
 * Machine translation for "Translate" on messages. One provider, chosen by TRANSLATE_PROVIDER:
 * DeepL, a LibreTranslate server, or Anthropic's API. Text goes to that provider only when a member
 * taps Translate; results are stored per message and language so each is translated once.
 */
@Injectable()
export class TranslateService {
  private readonly logger = new Logger('Translate');

  enabled(): boolean {
    const e = env();
    switch (e.TRANSLATE_PROVIDER) {
      case 'deepl':
        return !!e.DEEPL_API_KEY;
      case 'libretranslate':
        return !!e.LIBRETRANSLATE_URL;
      case 'anthropic':
        return !!e.ANTHROPIC_API_KEY;
      case 'fake':
        return true;
      default:
        return false;
    }
  }

  /** Translates into `to` (en, fr or ar). Throws when the provider fails. */
  async translate(text: string, to: string): Promise<string> {
    const e = env();
    const target = TRANSLATE_LANGUAGES[to] ? to : 'en';
    switch (e.TRANSLATE_PROVIDER) {
      case 'fake':
        return `[${target}] ${text}`;
      case 'deepl': {
        const key = e.DEEPL_API_KEY!;
        const host = key.endsWith(':fx') ? 'https://api-free.deepl.com' : 'https://api.deepl.com';
        const res = await fetch(`${host}/v2/translate`, {
          method: 'POST',
          headers: { Authorization: `DeepL-Auth-Key ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: [text], target_lang: target === 'en' ? 'EN-GB' : target.toUpperCase() }),
          signal: AbortSignal.timeout(15_000),
        });
        if (!res.ok) throw new Error(`DeepL ${res.status}`);
        const data = (await res.json()) as { translations?: { text: string }[] };
        return data.translations?.[0]?.text ?? text;
      }
      case 'libretranslate': {
        const res = await fetch(`${e.LIBRETRANSLATE_URL!.replace(/\/+$/, '')}/translate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ q: text, source: 'auto', target, format: 'text', api_key: e.LIBRETRANSLATE_API_KEY }),
          signal: AbortSignal.timeout(15_000),
        });
        if (!res.ok) throw new Error(`LibreTranslate ${res.status}`);
        const data = (await res.json()) as { translatedText?: string };
        return data.translatedText ?? text;
      }
      case 'anthropic': {
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'x-api-key': e.ANTHROPIC_API_KEY!, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: e.TRANSLATE_MODEL,
            max_tokens: 2048,
            system: `Translate the user's chat message into ${TRANSLATE_LANGUAGES[target]}. Reply with the translation only, keeping names, links, emoji and line breaks. If it is already in ${TRANSLATE_LANGUAGES[target]}, return it unchanged.`,
            messages: [{ role: 'user', content: text }],
          }),
          signal: AbortSignal.timeout(30_000),
        });
        if (!res.ok) throw new Error(`Anthropic ${res.status}`);
        const data = (await res.json()) as { content?: { type: string; text?: string }[] };
        return data.content?.find((c) => c.type === 'text')?.text?.trim() || text;
      }
      default:
        throw new Error('Translation is not configured');
    }
  }

  warn(err: unknown) {
    this.logger.warn(`translation failed: ${String(err)}`);
  }
}
