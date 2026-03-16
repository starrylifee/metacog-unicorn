import { NextResponse } from 'next/server';
import { CHAT_SESSION_COOKIE, createChatSessionToken, hashChatSessionToken } from '@/lib/chatSession';
import { FieldValue, adminDb } from '@/lib/serverDb';

export async function POST(request) {
  try {
    const { assignmentId, studentCode } = await request.json();
    const normalizedStudentCode = Number(studentCode);

    if (!assignmentId || !Number.isInteger(normalizedStudentCode) || normalizedStudentCode <= 0) {
      return NextResponse.json(
        { success: false, error: '필수 정보가 누락되었거나 형식이 올바르지 않습니다.' },
        { status: 400 }
      );
    }

    const assignmentSnap = await adminDb.collection('assignments').doc(assignmentId).get();
    if (!assignmentSnap.exists || !assignmentSnap.data()?.isActive) {
      return NextResponse.json(
        { success: false, error: '참여할 수 없는 과제입니다.' },
        { status: 404 }
      );
    }

    // 중복 참여 방지: 같은 과제 + 같은 출석번호로 이미 참여했는지 확인
    const existingSnap = await adminDb
      .collection('conversations')
      .where('assignmentId', '==', assignmentId)
      .where('studentCode', '==', normalizedStudentCode)
      .limit(1)
      .get();

    if (!existingSnap.empty) {
      return NextResponse.json({
        success: false,
        error: '이 출석번호로 이미 참여했어요! 선생님에게 문의하세요.',
        alreadyExists: true,
      });
    }

    const sessionToken = createChatSessionToken();
    const docRef = await adminDb.collection('conversations').add({
      assignmentId,
      studentCode: normalizedStudentCode,
      studentName: `학생 ${studentCode}`,
      messages: [],
      score: null,
      feedback: null,
      status: 'in_progress',
      approved: false,
      sessionTokenHash: hashChatSessionToken(sessionToken),
      startedAt: FieldValue.serverTimestamp(),
      completedAt: null,
    });

    const response = NextResponse.json({
      success: true,
      conversationId: docRef.id,
    });

    response.cookies.set(CHAT_SESSION_COOKIE, sessionToken, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
    });

    return response;
  } catch (err) {
    console.error('Create conversation error:', err);
    return NextResponse.json({ success: false, error: '서버 오류' }, { status: 500 });
  }
}
