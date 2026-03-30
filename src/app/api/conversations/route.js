import { NextResponse } from 'next/server';

import {
  CHAT_SESSION_COOKIE,
  createChatSessionToken,
  hashChatSessionToken,
} from '@/lib/chatSession';
import { FieldValue, adminDb } from '@/lib/serverDb';

function serializeConversation(doc) {
  const data = doc.data();

  return {
    id: doc.id,
    studentCode: data.studentCode,
    messages: Array.isArray(data.messages) ? data.messages : [],
    score: data.score ?? null,
    feedback: data.feedback ?? '',
    higherScoreTip: data.higherScoreTip ?? '',
    status: data.status || 'in_progress',
    approved: Boolean(data.approved),
    approvalStatus: data.approvalStatus || null,
  };
}

export async function POST(request) {
  try {
    const { assignmentId, studentCode } = await request.json();
    const normalizedStudentCode = Number(studentCode);

    if (
      !assignmentId ||
      !Number.isInteger(normalizedStudentCode) ||
      normalizedStudentCode <= 0 ||
      normalizedStudentCode > 99
    ) {
      return NextResponse.json(
        { success: false, error: '필수 정보가 없거나 형식이 올바르지 않습니다.' },
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

    const sessionToken = request.cookies.get(CHAT_SESSION_COOKIE)?.value || null;
    const sessionTokenHash = sessionToken ? hashChatSessionToken(sessionToken) : null;

    const existingSnap = await adminDb
      .collection('conversations')
      .where('assignmentId', '==', assignmentId)
      .where('studentCode', '==', normalizedStudentCode)
      .limit(1)
      .get();

    if (!existingSnap.empty) {
      const existingDoc = existingSnap.docs[0];
      const existing = existingDoc.data();
      const canResume =
        existing.status === 'in_progress' &&
        sessionTokenHash &&
        existing.sessionTokenHash &&
        existing.sessionTokenHash === sessionTokenHash;

      if (canResume) {
        return NextResponse.json({
          success: true,
          resumed: true,
          conversationId: existingDoc.id,
          conversation: serializeConversation(existingDoc),
        });
      }

      return NextResponse.json({
        success: false,
        error:
          existing.status === 'completed'
            ? '이미 참여가 완료된 번호입니다. 교사에게 문의해 주세요.'
            : '이미 진행 중인 대화가 있습니다. 같은 기기에서 다시 접속해 주세요.',
        alreadyExists: true,
      });
    }

    const newSessionToken = createChatSessionToken();
    const docRef = await adminDb.collection('conversations').add({
      assignmentId,
      studentCode: normalizedStudentCode,
      studentName: `학생 ${studentCode}`,
      messages: [],
      score: null,
      feedback: null,
      higherScoreTip: null,
      status: 'in_progress',
      approved: false,
      approvalStatus: null,
      sessionTokenHash: hashChatSessionToken(newSessionToken),
      startedAt: FieldValue.serverTimestamp(),
      completedAt: null,
    });

    const response = NextResponse.json({
      success: true,
      resumed: false,
      conversationId: docRef.id,
    });

    response.cookies.set(CHAT_SESSION_COOKIE, newSessionToken, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
    });

    return response;
  } catch (error) {
    console.error('=== Create Conversation Error Details ===');
    console.error('Error message:', error?.message || 'Unknown error');
    console.error('Error name:', error?.name || 'Unknown');
    console.error('Error stack:', error?.stack || 'No stack trace');
    if (error?.code) {
      console.error('Error code:', error.code);
    }
    console.error('=== End Create Conversation Error ===');
    return NextResponse.json(
      { success: false, error: `서버 오류: ${error?.message || '알 수 없는 오류'}` },
      { status: 500 }
    );
  }
}
