import { NextResponse } from 'next/server';

import { FieldValue, adminDb, serializeDoc } from '@/lib/serverDb';
import { authenticateFirebaseRequest, RequestError } from '@/lib/serverAuth';

async function getOwnedAssignment(id, teacherUid) {
  const snapshot = await adminDb.collection('assignments').doc(id).get();

  if (!snapshot.exists) {
    throw new RequestError('과제를 찾을 수 없습니다.', 404);
  }

  const assignment = snapshot.data();
  if (assignment.teacherId !== teacherUid) {
    throw new RequestError('이 과제를 관리할 권한이 없습니다.', 403);
  }

  return { ref: snapshot.ref, snapshot };
}

export async function GET(request, { params }) {
  try {
    const teacher = await authenticateFirebaseRequest(request);
    const { ref } = await getOwnedAssignment(params.id, teacher.uid);
    const snapshot = await ref.get();

    return NextResponse.json({
      success: true,
      assignment: serializeDoc(snapshot),
    });
  } catch (error) {
    if (error instanceof RequestError) {
      return NextResponse.json({ success: false, error: error.message }, { status: error.status });
    }

    console.error('Assignment detail GET error:', error);
    return NextResponse.json({ success: false, error: '서버 오류' }, { status: 500 });
  }
}

export async function PATCH(request, { params }) {
  try {
    const teacher = await authenticateFirebaseRequest(request);
    const { ref } = await getOwnedAssignment(params.id, teacher.uid);
    const { isActive } = await request.json();

    if (typeof isActive !== 'boolean') {
      return NextResponse.json({ success: false, error: '상태 값이 올바르지 않습니다.' }, { status: 400 });
    }

    await ref.update({
      isActive,
      updatedAt: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof RequestError) {
      return NextResponse.json({ success: false, error: error.message }, { status: error.status });
    }

    console.error('Assignment detail PATCH error:', error);
    return NextResponse.json({ success: false, error: '서버 오류' }, { status: 500 });
  }
}

export async function DELETE(request, { params }) {
  try {
    const teacher = await authenticateFirebaseRequest(request);
    const { ref } = await getOwnedAssignment(params.id, teacher.uid);
    const conversationsSnapshot = await adminDb
      .collection('conversations')
      .where('assignmentId', '==', params.id)
      .get();

    const batch = adminDb.batch();
    batch.delete(ref);

    conversationsSnapshot.docs.forEach((conversationDoc) => {
      batch.delete(conversationDoc.ref);
    });

    await batch.commit();

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof RequestError) {
      return NextResponse.json({ success: false, error: error.message }, { status: error.status });
    }

    console.error('Assignment detail DELETE error:', error);
    return NextResponse.json({ success: false, error: '서버 오류' }, { status: 500 });
  }
}
