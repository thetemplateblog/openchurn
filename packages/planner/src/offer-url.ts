// The bonus's offer page as a link. Only http(s) web addresses become links, so a saved value can never run script.

const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;

/** A safe absolute http(s) URL for what the user typed, adding https:// when they left it off; null otherwise. */
export function offerLink(raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;
  let url: URL;
  try {
    url = new URL(SCHEME_RE.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  // A real site has a dotted host name; this also rejects "localhost" and other bare words.
  if (!url.hostname.includes(".")) return null;
  return url.href;
}

