export const DEFAULT_RUBRIC = {
  technicalKnowledge: 25,
  problemSolving: 25,
  communication: 15,
  projectDepth: 15,
  codingCorrectness: 20
};

export function validateRubric(rubric) {
  if (!rubric || typeof rubric !== "object" || Array.isArray(rubric)) {
    throw new Error("rubric must be an object of category weights");
  }
  const entries = Object.entries(rubric);
  if (!entries.length) throw new Error("rubric must contain at least one category");
  for (const [key, value] of entries) {
    if (!/^[a-zA-Z][a-zA-Z0-9_]{1,49}$/.test(key)) throw new Error(`Invalid rubric category: ${key}`);
    if (!Number.isFinite(value) || value < 0 || value > 100) throw new Error(`Invalid weight for ${key}`);
  }
  const total = entries.reduce((sum, [, value]) => sum + value, 0);
  if (Math.abs(total - 100) > 0.001) throw new Error("Rubric weights must total 100");
  return rubric;
}

export function calculateWeightedScore(rubric, categoryScores) {
  validateRubric(rubric);
  let total = 0;
  for (const [category, weight] of Object.entries(rubric)) {
    const score = Number(categoryScores?.[category]);
    if (Number.isFinite(score)) total += Math.max(0, Math.min(100, score)) * weight / 100;
  }
  return Math.round(total * 100) / 100;
}
