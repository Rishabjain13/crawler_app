import * as cheerio from 'cheerio';
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import type { ExtractedContent } from '../types.js';

/**
 * Full content extraction pipeline for a single HTML page.
 *
 * Layers (in order):
 *  1. Cheerio   — fast, lightweight: title, meta description, og tags,
 *                 outgoing links, schema.org JSON-LD
 *  2. Readability — article-quality plain text (same algorithm as Firefox
 *                 Reader View), requires a real DOM via jsdom
 *
 * If jsdom / Readability throw for any reason we fall back to cheerio
 * body text so the caller always gets *something*.
 */
export function extractContent(html: string, pageUrl: string): ExtractedContent {
  const $ = cheerio.load(html);

  // ── Title ─────────────────────────────────────────────────────────────────
  const title =
    $('meta[property="og:title"]').attr('content')?.trim() ||
    $('title').first().text().trim() ||
    '';

  // ── Description ──────────────────────────────────────────────────────────
  const description =
    $('meta[property="og:description"]').attr('content')?.trim() ||
    $('meta[name="description"]').attr('content')?.trim()        ||
    '';

  // ── Meta tags ─────────────────────────────────────────────────────────────
  const metaTags: Record<string, string> = {};
  $('meta[name], meta[property]').each((_, el) => {
    const key   = $(el).attr('name') ?? $(el).attr('property') ?? '';
    const value = $(el).attr('content') ?? '';
    if (key && value) metaTags[key] = value;
  });

  // ── Outgoing links ────────────────────────────────────────────────────────
  const outgoingLinks: string[] = [];
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;
    try {
      const resolved = new URL(href, pageUrl).href;
      if (resolved.startsWith('http')) outgoingLinks.push(resolved);
    } catch { /* skip malformed */ }
  });

  // ── Schema.org JSON-LD ────────────────────────────────────────────────────
  const schemaOrgData: unknown[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      schemaOrgData.push(JSON.parse($(el).html() ?? ''));
    } catch { /* skip invalid */ }
  });

  // ── Text content via Readability ──────────────────────────────────────────
  let textContent = '';
  try {
    const dom    = new JSDOM(html, { url: pageUrl });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();
    textContent  = article?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  } catch {
    // jsdom / Readability failed — fall back to cheerio body text
    textContent = $('body').text().replace(/\s+/g, ' ').trim();
  }

  return {
    title,
    description,
    textContent,
    outgoingLinks,
    schemaOrgData,
    metaTags,
  };
}
