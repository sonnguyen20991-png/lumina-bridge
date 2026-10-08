/** Shape validation, not deliverability or ownership verification. */
export function isContactEmail(value) {
  if (typeof value !== 'string') return false;
  const input = value.trim();
  if (input.length > 254 || /\s/.test(input)) return false;
  const parts = input.split('@');
  if (parts.length !== 2) return false;
  const [local, domain] = parts;
  if (!local || local.length > 64 || !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/i.test(local) || /^\.|\.$|\.\./.test(local)) return false;
  const labels = domain.split('.');
  return labels.length > 1 && labels.every(label => label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label));
}
export function isCompanyWebsite(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 1000) return false;
  const input = value.trim();
  if (/\s|\\/.test(input)) return false;
  try {
    const u = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`);
    return ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password &&
      !/(^|\.)linkedin\.com$/i.test(u.hostname) &&
      u.hostname.split('.').length > 1 && u.hostname.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label));
  } catch { return false; }
}

/** A domain identity may be a hostname or an HTTP(S) root URL, never a profile/path. */
export function isCompanyDomain(value) {
  if (!isCompanyWebsite(value)) return false;
  try {
    const input = value.trim();
    const u = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`);
    return !u.port && u.pathname === '/' && !u.search && !u.hash;
  } catch { return false; }
}
