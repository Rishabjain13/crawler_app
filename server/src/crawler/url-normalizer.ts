import { createHash } from 'node:crypto';

/**
 * SSRF guard — returns true for private / loopback / link-local addresses
 * that must never be fetched by the crawler.
 *
 * Blocked ranges:
 *   127.0.0.0/8   loopback
 *   10.0.0.0/8    RFC-1918 private
 *   172.16.0.0/12 RFC-1918 private
 *   192.168.0.0/16 RFC-1918 private
 *   169.254.0.0/16 link-local / AWS metadata (169.254.169.254)
 *   ::1 / [::1]   IPv6 loopback
 *   localhost / 0.0.0.0
 */
export function isPrivateUrl(rawUrl: string): boolean {
  try {
    const { hostname } = new URL(rawUrl);

    if (hostname === 'localhost' || hostname === '0.0.0.0') return true;

    // IPv6 loopback
    if (hostname === '::1' || hostname === '[::1]') return true;

    // IPv4 private / reserved ranges
    const m = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (m) {
      const [, a, b] = m.map(Number);
      if (a === 127) return true;                         // 127.0.0.0/8  loopback
      if (a === 10)  return true;                         // 10.0.0.0/8   private
      if (a === 169 && b === 254) return true;            // 169.254.0.0/16 link-local / metadata
      if (a === 172 && b >= 16 && b <= 31) return true;  // 172.16.0.0/12 private
      if (a === 192 && b === 168) return true;            // 192.168.0.0/16 private
    }

    return false;
  } catch {
    return true; // unparseable → block
  }
}

/**
 * Canonical URL normalization.
 * - Lowercases scheme + hostname
 * - Strips fragment
 * - Sorts query params
 * - Removes trailing slash on non-root paths
 * - Upgrades http → https
 * - Returns null for non-http/https schemes
 * - Returns null for private/internal IP ranges (SSRF protection)
 */
export function normalizeUrl(rawUrl: string, base?: string): string | null {
  try {
    const u = new URL(rawUrl, base);

    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;

    // SSRF guard — check before upgrade so both http and https forms are caught
    if (isPrivateUrl(u.href)) return null;

    // Upgrade to https
    u.protocol  = 'https:';
    u.hostname  = u.hostname.toLowerCase();
    u.hash      = '';
    u.searchParams.sort();

    // Strip trailing slash except on root
    if (u.pathname !== '/' && u.pathname.endsWith('/')) {
      u.pathname = u.pathname.slice(0, -1);
    }

    return u.href;
  } catch {
    return null;
  }
}

/** SHA-256 hex fingerprint used as the dedup key in the seen-set. */
export function hashUrl(url: string): string {
  return createHash('sha256').update(url).digest('hex');
}
