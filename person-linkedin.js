/** Validate identity shape; this does not verify ownership of a profile. */
export function isPersonLinkedIn(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 1000) return false;
  const input = value.trim();
  if (/\s|\\/.test(input)) return false;
  try {
    const url = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port) return false;
    if (!/^(?:(?:www|m|[a-z]{2})\.)?linkedin\.com$/i.test(url.hostname)) return false;
    const path = decodeURIComponent(url.pathname);
    if (/\s|\\|%/.test(path)) return false;
    return /^\/in\/[^/]+\/?$/i.test(path) || /^\/pub\/[^/]+\/[a-f0-9]+\/[a-f0-9]+\/[a-f0-9]+\/?$/i.test(path);
  } catch { return false; }
}
