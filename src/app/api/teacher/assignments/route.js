import { NextResponse } from 'next/server';

import { authenticateFirebaseRequest, RequestError } from '@/lib/serverAuth';
import {
  DEFAULT_SCORE_OPTIONS,
  DEFAULT_SCORING_STYLE,
  normalizeScoringStyle,
  validateScoreOptions,
} from '@/lib/scoreConfig';
import { FieldValue, adminDb, serializeDoc } from '@/lib/serverDb';

const ENTRY_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateEntryCode() {
  let code = '';

  for (let index = 0; index < 6; index += 1) {
    code += ENTRY_CODE_CHARS.charAt(Math.floor(Math.random() * ENTRY_CODE_CHARS.length));
  }

  return code;
}

async function generateUniqueEntryCode() {
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

  throw new RequestError('입장 코드를 생성하지 못했습니다. 다시 시도해 주세요.', 503);
}

export async function GET(request) {
  try {
    const teacher = await authenticateFirebaseRequest(request);
    const snapshot = await adminDb
      .collection('assignments')
      .where('teacherId', '==', teacher.uid)
      .orderBy('createdAt', 'desc')
      .get();

    return NextResponse.json({
      success: true,
      assignments: snapshot.docs.map(serializeDoc),
    });
  } catch (error) {
    if (error instanceof RequestError) {
      return NextResponse.json({ success: false, error: error.message }, { status: error.status });
    }

    console.error('Assignments GET error:', error);
    return NextResponse.json({ success: false, error: '서버 오류' }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const teacher = await authenticateFirebaseRequest(request);
    const {
      title = '',
      subject = '',
      grade = '',
      learningObjective = '',
      content = '',
      keywords = [],
      standards = [],
      scoreOptions = DEFAULT_SCORE_OPTIONS,
      scoringStyle = DEFAULT_SCORING_STYLE,
    } = await request.json();

    if (!title.trim() || !content.trim()) {
      return NextResponse.json(
        { success: false, error: '과제 제목과 학습 내용은 필수입니다.' },
        { status: 400 }
      );
    }

    const validatedScoreOptions = validateScoreOptions(scoreOptions);
    if (!validatedScoreOptions.ok) {
      return NextResponse.json(
        { success: false, error: validatedScoreOptions.error },
        { status: 400 }
      );
    }

    const entryCode = await generateUniqueEntryCode();
    const docRef = await adminDb.collection('assignments').add({
      teacherId: teacher.uid,
      entryCode,
      title: title.trim(),
      subject: subject.trim(),
      grade: grade.trim(),
      learningObjective: learningObjective.trim(),
      content: content.trim(),
      keywords: Array.isArray(keywords)
        ? keywords.map((keyword) => String(keyword).trim()).filter(Boolean)
        : [],
      standards: Array.isArray(standards)
        ? standards.map((standard) => String(standard).trim()).filter(Boolean)
        : [],
      scoreOptions: validatedScoreOptions.scoreOptions,
      maxScore: validatedScoreOptions.maxScore,
      scoringStyle: normalizeScoringStyle(scoringStyle),
      isActive: true,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({
      success: true,
      assignment: {
        id: docRef.id,
        entryCode,
      },
    });
  } catch (error) {
    if (error instanceof RequestError) {
      return NextResponse.json({ success: false, error: error.message }, { status: error.status });
    }

    console.error('Assignments POST error:', error);
    return NextResponse.json({ success: false, error: '서버 오류' }, { status: 500 });
  }
}
