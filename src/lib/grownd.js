export const GROWND_BASE_URL = 'https://growndcard.com';

function getNestedMessage(payload) {
  if (!payload || typeof payload !== 'object') {
    return '';
  }

  if (typeof payload.message === 'string' && payload.message.trim()) {
    return payload.message.trim();
  }

  if (typeof payload.error === 'string' && payload.error.trim()) {
    return payload.error.trim();
  }

  if (payload.error && typeof payload.error === 'object') {
    if (typeof payload.error.message === 'string' && payload.error.message.trim()) {
      return payload.error.message.trim();
    }

    if (typeof payload.error.detail === 'string' && payload.error.detail.trim()) {
      return payload.error.detail.trim();
    }
  }

  if (typeof payload.detail === 'string' && payload.detail.trim()) {
    return payload.detail.trim();
  }

  if (typeof payload.msg === 'string' && payload.msg.trim()) {
    return payload.msg.trim();
  }

  return '';
}

function getErrorCodes(payload) {
  if (!payload || typeof payload !== 'object') {
    return [];
  }

  return [
    payload.code,
    payload.errorCode,
    payload.error?.code,
    payload.error?.errorCode,
  ]
    .map((value) => String(value || '').trim().toLowerCase())
    .filter(Boolean);
}

export async function parseGrowndResponse(response) {
  const raw = await response.text();

  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw);
  } catch {
    return { raw };
  }
}

export function extractGrowndErrorDetail(response, payload) {
  const directMessage = getNestedMessage(payload);
  if (directMessage) {
    return directMessage;
  }

  if (payload?.raw) {
    return `Grownd 응답(${response.status}): ${String(payload.raw).slice(0, 300)}`;
  }

  if (payload) {
    return `Grownd 응답(${response.status}): ${JSON.stringify(payload).slice(0, 300)}`;
  }

  return `Grownd 요청이 실패했습니다. (HTTP ${response.status})`;
}

export function isGrowndStudentNotFound(response, payload) {
  const codes = getErrorCodes(payload);
  if (codes.includes('student_not_found')) {
    return true;
  }

  const haystack = [
    getNestedMessage(payload),
    typeof payload?.raw === 'string' ? payload.raw : '',
  ]
    .join(' ')
    .toLowerCase();

  if (/student[_\s-]?not[_\s-]?found/.test(haystack)) {
    return true;
  }

  if (/학생.*찾을 수 없|해당 학생 번호|존재하지 않는 학생/.test(haystack)) {
    return true;
  }

  return response.status === 404 && /student|학생/.test(haystack);
}

export function buildGrowndStudentNotFoundMessage(studentCode) {
  return `${studentCode}번 학생은 Grownd 반 명단에 없습니다. 학생 번호를 확인한 뒤 다시 시도해 주세요.`;
}
