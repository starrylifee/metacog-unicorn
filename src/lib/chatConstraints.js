const TURN_LIMITS = {
  math: {
    minTurns: 2,
    maxTurns: 3,
    legacyMaxTurns: 3,
  },
  art: {
    minTurns: 5,
    maxTurns: 5,
    legacyMaxTurns: 10,
  },
};

const BYTE_LIMITS = {
  minStudentMessageBytes: 15,
  maxStudentMessageBytes: 220,
};

export const CHAT_LENGTH_EXAMPLES = [
  {
    label: '짧은 한 문장',
    text: '파란색이 가장 눈에 띄어요.',
  },
  {
    label: '설명 한두 문장',
    text: '하늘이 소용돌이처럼 보여서 바람이 세게 부는 밤 같아요.',
  },
  {
    label: '이유까지 붙인 답변',
    text: '저는 가운데 큰 나무가 눈에 띄고, 주변 하늘이 움직이는 것처럼 보여서 그림이 살아 있는 느낌이 들어요.',
  },
];

function clampInteger(value, min, max, fallback) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, Math.round(parsed)));
}

export function getUtf8ByteLength(text) {
  return new TextEncoder().encode(String(text ?? '')).length;
}

export function getChatLengthExamples() {
  return CHAT_LENGTH_EXAMPLES.map((example) => ({
    ...example,
    bytes: getUtf8ByteLength(example.text),
  }));
}

export function getDefaultTurnLimits(type = 'math') {
  return TURN_LIMITS[type === 'art' ? 'art' : 'math'];
}

export function getDefaultAssignmentConstraints(type = 'math') {
  const turnDefaults = getDefaultTurnLimits(type);

  return {
    minTurns: turnDefaults.minTurns,
    maxTurns: turnDefaults.maxTurns,
    minStudentMessageBytes: BYTE_LIMITS.minStudentMessageBytes,
    maxStudentMessageBytes: BYTE_LIMITS.maxStudentMessageBytes,
  };
}

export function getLegacyMaxTurns(type = 'math') {
  return getDefaultTurnLimits(type).legacyMaxTurns;
}

export function getTeacherConstraintDefaults(settings = {}, type = 'math') {
  const isArt = type === 'art';
  const assignmentDefaults = getDefaultAssignmentConstraints(type);
  const maxTurnsFallback = assignmentDefaults.maxTurns;
  const minTurnsFallback = assignmentDefaults.minTurns;

  const maxTurns = clampInteger(
    isArt ? settings.defaultArtMaxTurns : settings.defaultMathMaxTurns,
    1,
    12,
    maxTurnsFallback
  );

  const minTurns = clampInteger(
    isArt ? settings.defaultArtMinTurns : settings.defaultMathMinTurns,
    1,
    maxTurns,
    Math.min(minTurnsFallback, maxTurns)
  );

  const minStudentMessageBytes = clampInteger(
    settings.defaultMinStudentMessageBytes,
    1,
    1000,
    BYTE_LIMITS.minStudentMessageBytes
  );

  const maxStudentMessageBytes = clampInteger(
    settings.defaultMaxStudentMessageBytes,
    minStudentMessageBytes,
    4000,
    Math.max(BYTE_LIMITS.maxStudentMessageBytes, minStudentMessageBytes)
  );

  return {
    minTurns,
    maxTurns,
    minStudentMessageBytes,
    maxStudentMessageBytes,
  };
}

export function normalizeAssignmentConstraints(assignment = {}) {
  const type = assignment.type === 'art' ? 'art' : 'math';
  const defaults = getDefaultAssignmentConstraints(type);
  const legacyMaxTurns = getLegacyMaxTurns(type);

  const explicitMaxTurns = Number(assignment.maxTurns);
  const maxTurns = Number.isFinite(explicitMaxTurns) && explicitMaxTurns >= 1
    ? clampInteger(explicitMaxTurns, 1, 12, defaults.maxTurns)
    : legacyMaxTurns;

  const minTurns = clampInteger(
    assignment.minTurns,
    1,
    maxTurns,
    Math.min(defaults.minTurns, maxTurns)
  );

  const minStudentMessageBytes = clampInteger(
    assignment.minStudentMessageBytes,
    1,
    1000,
    defaults.minStudentMessageBytes
  );

  const maxStudentMessageBytes = clampInteger(
    assignment.maxStudentMessageBytes,
    minStudentMessageBytes,
    4000,
    Math.max(defaults.maxStudentMessageBytes, minStudentMessageBytes)
  );

  return {
    minTurns,
    maxTurns,
    minStudentMessageBytes,
    maxStudentMessageBytes,
  };
}

export function formatStudentMessageByteRange(minBytes, maxBytes) {
  if (!Number.isFinite(minBytes) || !Number.isFinite(maxBytes)) {
    return '-';
  }

  return `${minBytes}B ~ ${maxBytes}B`;
}
