import axios from 'axios';
import http  from 'node:http';
import https from 'node:https';

/** Round-robin UA rotation — real browser strings. */
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
];

let uaIndex = 0;
function nextUA(): string {
  return USER_AGENTS[uaIndex++ % USER_AGENTS.length];
}

/**
 * Persistent keep-alive agents — reuse TCP/TLS connections across requests,
 * avoiding repeated DNS + handshake overhead for the same host.
 */
const httpAgent  = new http.Agent({ keepAlive: true, maxSockets: 10 });
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 10 });

/** Charset label → Node.js BufferEncoding for the most common cases. */
const CHARSET_MAP: Record<string, BufferEncoding> = {
  utf8:        'utf8',
  'utf-8':     'utf8',
  latin1:      'latin1',
  iso88591:    'latin1',
  'iso-8859-1': 'latin1',
  windows1252: 'latin1',
  ascii:       'ascii',
};

export interface FetchResult {
  html:       string;
  statusCode: number;
  finalUrl:   string;
}

/**
 * Fetch a page using plain HTTP (no JavaScript execution).
 *
 * Improvements over v1:
 *  - Persistent keep-alive connection pool (httpAgent / httpsAgent)
 *  - 5 MB hard content-length cap (maxContentLength)
 *  - Reads raw bytes (arraybuffer) then decodes using the response charset,
 *    so ISO-8859-1 / Windows-1252 pages render correctly instead of mojibake
 *  - Does NOT throw on 4xx / 5xx — caller inspects statusCode
 */
export async function fetchStatic(url: string): Promise<FetchResult> {
  const response = await axios.get<ArrayBuffer>(url, {
    timeout:          15_000,
    maxRedirects:     5,
    responseType:     'arraybuffer',          // raw bytes — we decode below
    maxContentLength: 5 * 1024 * 1024,        // 5 MB hard cap
    validateStatus:   () => true,             // never throw on HTTP error codes
    httpAgent,
    httpsAgent,
    headers: {
      'User-Agent':      nextUA(),
      'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
    },
  });

  // Decode bytes with the charset declared in Content-Type (fall back to UTF-8)
  const contentType  = String(response.headers['content-type'] ?? '');
  const charsetMatch = contentType.match(/charset=([^\s;]+)/i);
  const rawCharset   = (charsetMatch?.[1] ?? 'utf-8').toLowerCase().replace(/[^a-z0-9]/g, '');
  const encoding     = CHARSET_MAP[rawCharset] ?? 'utf8';
  const html         = Buffer.from(response.data as ArrayBuffer).toString(encoding);

  // axios stores the final URL after redirects here
  const finalUrl: string =
    (response.request as { res?: { responseUrl?: string } })?.res?.responseUrl ?? url;

  return { html, statusCode: response.status, finalUrl };
}
