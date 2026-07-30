/**
 * OCR Candidate Matcher (Pack 7A)
 * Provides fuzzy matching against master product list and returns Top N candidates.
 */

function calculateLevenshteinDistance(a, b) {
  const str1 = String(a || '').toLowerCase().trim();
  const str2 = String(b || '').toLowerCase().trim();

  const matrix = Array.from({ length: str1.length + 1 }, () =>
    new Array(str2.length + 1).fill(0)
  );

  for (let i = 0; i <= str1.length; i++) matrix[i][0] = i;
  for (let j = 0; j <= str2.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= str1.length; i++) {
    for (let j = 1; j <= str2.length; j++) {
      const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }

  return matrix[str1.length][str2.length];
}

function calculateSimilarityScore(query, target) {
  const q = String(query || '').toLowerCase().trim();
  const t = String(target || '').toLowerCase().trim();

  if (!q || !t) return 0;
  if (q === t) return 1.0;
  if (t.includes(q) || q.includes(t)) return 0.85;

  const maxLen = Math.max(q.length, t.length);
  if (maxLen === 0) return 0;

  const distance = calculateLevenshteinDistance(q, t);
  return Math.max(0, 1 - distance / maxLen);
}

class OcrCandidateMatcher {
  static findTopCandidates(query, masterList = [], topN = 3) {
    if (!Array.isArray(masterList) || masterList.length === 0) {
      return [];
    }

    const scored = masterList.map(item => {
      const productCode = typeof item === 'string' ? item : (item.productCode || item.code || '');
      const score = calculateSimilarityScore(query, productCode);
      return {
        productCode,
        score
      };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topN);
  }
}

module.exports = {
  OcrCandidateMatcher,
  calculateSimilarityScore
};
