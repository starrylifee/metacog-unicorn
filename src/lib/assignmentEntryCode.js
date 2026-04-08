import { adminDb } from './serverDb';

const ENTRY_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateEntryCode() {
  let code = '';

  for (let index = 0; index < 6; index += 1) {
    code += ENTRY_CODE_CHARS.charAt(Math.floor(Math.random() * ENTRY_CODE_CHARS.length));
  }

  return code;
}

export async function generateUniqueEntryCode() {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const entryCode = generateEntryCode();
    const existing = await adminDb
      .collection('assignments')
      .where('entryCode', '==', entryCode)
      .limit(1)
      .get();

    if (existing.empty) {
      return entryCode;
    }
  }

  throw new Error('입장 코드를 생성하지 못했습니다. 잠시 후 다시 시도해 주세요.');
}
