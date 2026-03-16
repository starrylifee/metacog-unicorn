import { NextResponse } from 'next/server';

import { adminDb, serializeDoc } from '@/lib/serverDb';
import { authenticateFirebaseRequest, RequestError } from '@/lib/serverAuth';

async function assertOwnedAssignment(id, teacherUid) {
  const snapshot = await adminDb.collection('assignments').doc(id).get();

  if (!snapshot.exists) {
    throw new RequestError('과제를 찾을 수 없습니다.', 404);
  }

  if (snapshot.data()?.teacherId !== teacherUid) {
    throw new RequestError('이 과제를 조회할 권한이 없습니다.', 403);
  }
}

export async function GET(request, { params }) {
  try {
    const teacher = await authenticateFirebaseRequest(request);
    await assertOwnedAssignment(params.id, teacher.uid);

    const snapshot = await adminDb
      .collection('conversations')
      .where('assignmentId', '==', params.id)
      .orderBy('startedAt', 'desc')
      .get();

    return NextResponse.json({
      success: true,
      conversations: snapshot.docs.map(serializeDoc),
    });
  } catch (error) {
    if (error instanceof RequestError) {
      return NextResponse.json({ success: false, error: error.message }, { status: error.status });
    }

    console.error('Assignment conversations GET error:', error);
    return NextResponse.json({ success: false, error: '서버 오류' }, { status: 500 });
  }
}
