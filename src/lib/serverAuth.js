import { adminAuth } from './serverDb';

export class RequestError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'RequestError';
    this.status = status;
  }
}

function getBearerToken(request) {
  const authorization = request.headers.get('authorization') || '';
  const [scheme, token] = authorization.split(' ');

  if (scheme?.toLowerCase() !== 'bearer' || !token) {
    return null;
  }

  return token;
}

export async function authenticateFirebaseRequest(request) {
  const idToken = getBearerToken(request);
  if (!idToken) {
    throw new RequestError('로그인이 필요합니다.', 401);
  }

  try {
    const payload = await adminAuth.verifyIdToken(idToken);

    return {
      uid: payload.uid,
      email: payload.email || null,
      name: payload.name || null,
    };
  } catch (error) {
    const message =
      error?.code === 'auth/id-token-expired'
        ? '로그인 정보가 만료되었습니다. 다시 로그인해주세요.'
        : '로그인 정보가 올바르지 않습니다.';
    throw new RequestError(message, 401);
  }
}
