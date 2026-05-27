'use strict';
/**
 * Lightweight entity extraction from document text:
 * Tanzanian TIN / VRN, dates and monetary amounts.
 */
const uniq = (a, n = 12) => Array.from(new Set(a)).slice(0, n);

function extract(text = '') {
  const t = String(text || '');
  if (!t) return { tins: [], vrns: [], dates: [], amounts: [] };

  const tins = uniq((t.match(/\b\d{3}-\d{3}-\d{3}\b/g) || []));
  const vrns = uniq((t.match(/\b\d{2}-\d{6}-[A-Z]\b/g) || []));
  const dates = uniq([
    ...(t.match(/\b\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}\b/g) || []),
    ...(t.match(/\b\d{4}-\d{2}-\d{2}\b/g) || []),
    ...(t.match(/\b\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4}\b/gi) || []),
  ]);
  const amounts = uniq([
    ...(t.match(/(?:TZS|TSh|Tsh|USD|\$)\s?[\d,]+(?:\.\d{1,2})?/g) || []),
    ...(t.match(/\b\d{1,3}(?:,\d{3}){2,}(?:\.\d{1,2})?\b/g) || []),
  ]);

  return { tins, vrns, dates, amounts };
}

module.exports = { extract };
