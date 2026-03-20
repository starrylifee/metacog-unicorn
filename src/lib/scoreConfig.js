export const DEFAULT_SCORE_OPTIONS = [0, 1, 2, 3, 4, 5];
export const DEFAULT_SCORING_STYLE = 'balanced';

export const SCORE_PRESETS = [
  { id: 'default-0-5', label: '기본 0,1,2,3,4,5', values: DEFAULT_SCORE_OPTIONS },
  { id: 'compact-0-3', label: '0,1,2,3', values: [0, 1, 2, 3] },
  { id: 'inflation-0-10-20-30', label: '0,10,20,30', values: [0, 10, 20, 30] },
];

export const SCORING_STYLE_OPTIONS = [
  {
    value: 'strict',
    label: '짜게',
    description: '핵심과 이유가 분명해야 중간 이상 점수를 줍니다.',
  },
  {
    value: 'balanced',
    label: '보통',
    description: '핵심 이해와 설명 수준을 균형 있게 봅니다.',
  },
  {
    value: 'generous',
    label: '후하게',
    description: '핵심 일부만 맞아도 중간 점수를 조금 더 열어 둡니다.',
  },
];

function toInteger(value) {
  const normalized = Number(value);

  if (!Number.isFinite(normalized) || !Number.isInteger(normalized)) {
    return null;
  }

  return normalized;
}

export function normalizeScoreOptions(rawScoreOptions) {
  if (!Array.isArray(rawScoreOptions)) {
    return [];
  }

  const normalized = rawScoreOptions
    .map(toInteger)
    .filter((value) => value !== null)
    .filter((value) => value >= 0);

  return Array.from(new Set(normalized)).sort((left, right) => left - right);
}

export function validateScoreOptions(rawScoreOptions) {
  if (!Array.isArray(rawScoreOptions)) {
    return {
      ok: false,
      error: '점수 단계는 배열 형식이어야 합니다.',
      scoreOptions: [],
      maxScore: null,
    };
  }

  const containsInvalidValue = rawScoreOptions.some((value) => toInteger(value) === null);
  if (containsInvalidValue) {
    return {
      ok: false,
      error: '점수 단계에는 0 이상의 정수만 넣어 주세요.',
      scoreOptions: [],
      maxScore: null,
    };
  }

  const hasNegativeValue = rawScoreOptions.some((value) => Number(value) < 0);
  if (hasNegativeValue) {
    return {
      ok: false,
      error: '점수 단계에는 음수를 사용할 수 없습니다.',
      scoreOptions: [],
      maxScore: null,
    };
  }

  const scoreOptions = normalizeScoreOptions(rawScoreOptions);

  if (scoreOptions.length < 2) {
    return {
      ok: false,
      error: '점수 단계는 최소 2개 이상 필요합니다.',
      scoreOptions,
      maxScore: null,
    };
  }

  if (scoreOptions[0] !== 0) {
    return {
      ok: false,
      error: '점수 단계는 0점부터 시작해 주세요.',
      scoreOptions,
      maxScore: null,
    };
  }

  return {
    ok: true,
    error: '',
    scoreOptions,
    maxScore: scoreOptions[scoreOptions.length - 1],
  };
}

export function parseScoreOptionsInput(input) {
  if (typeof input !== 'string') {
    return {
      ok: false,
      error: '점수 단계를 입력해 주세요.',
      scoreOptions: [],
      maxScore: null,
    };
  }

  const tokens = input
    .split(/[,\n\s]+/)
    .map((value) => value.trim())
    .filter(Boolean);

  if (tokens.length === 0) {
    return {
      ok: false,
      error: '점수 단계를 하나 이상 입력해 주세요.',
      scoreOptions: [],
      maxScore: null,
    };
  }

  return validateScoreOptions(tokens.map((value) => Number(value)));
}

export function normalizeScoringStyle(value) {
  return SCORING_STYLE_OPTIONS.some((option) => option.value === value)
    ? value
    : DEFAULT_SCORING_STYLE;
}

export function getScoringStyleLabel(value) {
  const normalized = normalizeScoringStyle(value);
  return SCORING_STYLE_OPTIONS.find((option) => option.value === normalized)?.label || '보통';
}

export function getScoringStyleDescription(value) {
  const normalized = normalizeScoringStyle(value);
  return (
    SCORING_STYLE_OPTIONS.find((option) => option.value === normalized)?.description ||
    '핵심 이해와 설명 수준을 균형 있게 봅니다.'
  );
}

export function getAssignmentScoreOptions(assignment) {
  const validatedConfiguredScores = validateScoreOptions(assignment?.scoreOptions);
  if (validatedConfiguredScores.ok) {
    return validatedConfiguredScores.scoreOptions;
  }

  const legacyMaxScore = toInteger(assignment?.maxScore);
  if (legacyMaxScore !== null && legacyMaxScore >= 1) {
    return Array.from({ length: legacyMaxScore + 1 }, (_, index) => index);
  }

  return [...DEFAULT_SCORE_OPTIONS];
}

export function getAssignmentMaxScore(assignment) {
  const scoreOptions = getAssignmentScoreOptions(assignment);
  return scoreOptions[scoreOptions.length - 1];
}

export function formatScoreOptions(scoreOptions, separator = ', ') {
  return scoreOptions.join(separator);
}

export function getClosestAllowedScore(scoreOptions, proposedScore) {
  if (!Number.isFinite(proposedScore) || scoreOptions.length === 0) {
    return null;
  }

  return scoreOptions.reduce((closest, candidate) => {
    if (closest === null) {
      return candidate;
    }

    const currentDistance = Math.abs(candidate - proposedScore);
    const closestDistance = Math.abs(closest - proposedScore);

    if (currentDistance < closestDistance) {
      return candidate;
    }

    if (currentDistance === closestDistance && candidate < closest) {
      return candidate;
    }

    return closest;
  }, null);
}

export function getFallbackScore(scoreOptions) {
  if (!Array.isArray(scoreOptions) || scoreOptions.length === 0) {
    return 0;
  }

  return scoreOptions[Math.floor((scoreOptions.length - 1) / 2)];
}

export function getNextHigherScore(scoreOptions, currentScore) {
  return scoreOptions.find((score) => score > currentScore) ?? null;
}
