/**
 * Redaction applied to text before it is sent to a scoring model. Hiring evaluation must be based
 * on job-related content only, so we strip the most common direct identifiers (emails, phone
 * numbers, URLs, and the candidate's own name when known). This is best-effort, not a guarantee.
 */
export function redactPii(text: string, names: string[] = []): string {
  let out = text
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email]')
    // Phone-like runs: 10+ digits with optional separators (avoids eating years like "2019 2020").
    .replace(/\+?\d[\d\s().-]{8,}\d/g, (m) => ((m.match(/\d/g) ?? []).length >= 10 ? '[phone]' : m))
    .replace(/https?:\/\/\S+/g, '[link]')
    .replace(/\b(?:linkedin|github)\.com\/\S+/gi, '[link]');
  for (const name of names) {
    const parts = name.trim().split(/\s+/).filter((p) => p.length >= 3);
    for (const p of parts) {
      out = out.replace(new RegExp(`\\b${escapeRegExp(p)}\\b`, 'gi'), '[candidate]');
    }
  }
  return out;
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Wrap untrusted text so the model treats it as data, never as instructions. */
export function asUntrusted(label: string, text: string): string {
  const safe = text.replace(/<\/?untrusted[^>]*>/gi, '');
  return `<untrusted source="${label}">\n${safe}\n</untrusted>`;
}

/** Remove any untrusted-wrapper tags a model (or the offline provider) may echo back into quotes. */
export function stripUntrusted(text: string): string {
  return text.replace(/<\/?untrusted[^>]*>/gi, '').replace(/\s+/g, ' ').trim();
}
