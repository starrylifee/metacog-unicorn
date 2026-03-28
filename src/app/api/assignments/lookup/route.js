import { NextResponse } from 'next/server';

import { getAssignmentMaxScore, getAssignmentScoreOptions } from '@/lib/scoreConfig';
import { adminDb } from '@/lib/serverDb';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');

  if (!code) {
    return NextResponse.json({ success: false, error: '입장 코드가 필요합니다.' });
  }

  try {
    const snapshot = await adminDb
      .collection('assignments')
      .where('entryCode', '==', code.toUpperCase())
      .where('isActive', '==', true)
      .limit(1)
      .get();

    if (snapshot.empty) {
      return NextResponse.json({ success: false, error: '유효하지 않은 입장 코드입니다.' });
    }

    const doc = snapshot.docs[0];
    const assignment = doc.data();
    const scoreOptions = getAssignmentScoreOptions(assignment);

    return NextResponse.json({
      success: true,
      assignment: {
        id: doc.id,
        title: assignment.title,
        subject: assignment.subject,
        grade: assignment.grade,
        entryCode: assignment.entryCode,
        scoreOptions,
        maxScore: getAssignmentMaxScore(assignment),
        type: assignment.type || 'math',
        imageUrl: assignment.imageUrl || null,
        paintingTitle: assignment.paintingTitle || null,
        artist: assignment.artist || null,
        year: assignment.year || null,
      },
    });
  } catch (error) {
    console.error('Lookup error:', error);
    return NextResponse.json({ success: false, error: '서버 오류' }, { status: 500 });
  }
}
