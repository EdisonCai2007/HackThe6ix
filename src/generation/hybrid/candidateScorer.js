export function scoreCompiledCandidate(candidate) {
  if (!candidate?.validation?.valid) {
    return {
      score: Number.NEGATIVE_INFINITY,
      disqualified: true,
      metrics: {
        coverage: candidate?.coverage ?? 0,
        exteriorCoverage: candidate?.exteriorCoverage ?? 0,
        colorCoherence: candidate?.colorCoherence ?? 0,
      },
    };
  }

  const metrics = {
    coverage: candidate.coverage ?? 0,
    exteriorCoverage: candidate.exteriorCoverage ?? 0,
    colorCoherence: candidate.colorCoherence ?? 0,
  };

  return {
    score: metrics.exteriorCoverage * 60 + metrics.coverage * 30 + metrics.colorCoherence * 10,
    disqualified: false,
    metrics,
  };
}

export function selectBestCandidate(candidates) {
  return [...candidates]
    .map((candidate, index) => ({
      candidate,
      index,
      evaluation: scoreCompiledCandidate(candidate),
    }))
    .sort((first, second) => {
      if (second.evaluation.score !== first.evaluation.score) {
        return second.evaluation.score - first.evaluation.score;
      }

      const firstSeed = Number.isFinite(first.candidate.sourceSeed)
        ? first.candidate.sourceSeed
        : Number.POSITIVE_INFINITY;
      const secondSeed = Number.isFinite(second.candidate.sourceSeed)
        ? second.candidate.sourceSeed
        : Number.POSITIVE_INFINITY;

      return firstSeed - secondSeed || first.index - second.index;
    })[0]?.candidate ?? null;
}
