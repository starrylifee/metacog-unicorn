import { NextResponse } from 'next/server';
import { authenticateFirebaseRequest, RequestError } from '@/lib/serverAuth';
import { FieldValue, adminDb } from '@/lib/serverDb';

async function getOwnedConversation(conversationId, teacherUid) {
  const convRef = adminDb.collection('conversations').doc(conversationId);
  const convSnap = await convRef.get();

  if (!convSnap.exists) {
    throw new RequestError('대화를 찾을 수 없습니다.', 404);
  }

  const conv = convSnap.data();
  if (!conv.assignmentId) {
    throw new RequestError('과제 정보가 없는 대화입니다.', 400);
  }

  const assignmentRef = adminDb.collection('assignments').doc(conv.assignmentId);
  const assignmentSnap = await assignmentRef.get();

  if (!assignmentSnap.exists) {
    throw new RequestError('연결된 과제를 찾을 수 없습니다.', 404);
  }

  const assignment = assignmentSnap.data();
  if (assignment.teacherId !== teacherUid) {
    throw new RequestError('이 대화를 관리할 권한이 없습니다.', 403);
  }

  return { convRef, conv, assignment };
}

async function parseGrowndResponse(response) {
  const raw = await response.text();
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch {
    return { raw };
  }
}

// 승인: Grownd 포인트 부여
export async function POST(request) {
  try {
    const teacher = await authenticateFirebaseRequest(request);
    const { conversationId } = await request.json();

    if (!conversationId) {
      return NextResponse.json({ success: false, error: '대화 ID가 필요합니다.' }, { status: 400 });
    }

    const { convRef, conv } = await getOwnedConversation(conversationId, teacher.uid);

    if (conv.approved) {
      return NextResponse.json({ success: false, error: '이미 승인된 대화입니다.' }, { status: 409 });
    }

    if (!conv.score) {
      return NextResponse.json({ success: false, error: '아직 채점되지 않은 대화입니다.' }, { status: 409 });
    }

    // 교사의 Grownd 설정 가져오기
    const teacherRef = adminDb.collection('teachers').doc(teacher.uid);
    const teacherSnap = await teacherRef.get();

    if (!teacherSnap.exists) {
      return NextResponse.json(
        { success: false, error: '교사 설정을 찾을 수 없습니다.' },
        { status: 400 }
      );
    }

    const teacherSettings = teacherSnap.data();
    const { growndApiKey, growndClassId } = teacherSettings;

    if (!growndApiKey || !growndClassId) {
      return NextResponse.json(
        { success: false, error: 'Grownd 설정이 완료되지 않았습니다.' },
        { status: 400 }
      );
    }

    const growndResponse = await fetch(
      `https://growndcard.com/api/v1/classes/${growndClassId}/students/${conv.studentCode}/points`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': growndApiKey,
        },
        body: JSON.stringify({
          type: 'reward',
          points: conv.score,
          description: `유니콘 메타인지 학습 완료 (${conv.score}점/3점)`,
          source: 'MetacogUnicorn',
        }),
      }
    );

    const growndResult = await parseGrowndResponse(growndResponse);

    if (!growndResponse.ok) {
      await convRef.update({
        lastGrowndError: {
          message: growndResult?.message || 'Grownd 포인트 지급 실패',
          status: growndResponse.status,
          at: FieldValue.serverTimestamp(),
        },
      });

      return NextResponse.json(
        {
          success: false,
          error: growndResult?.message || 'Grownd 포인트 지급에 실패했습니다.',
          growndResult,
        },
        { status: 502 }
      );
    }

    // 승인 상태 업데이트
    await convRef.update({
      approved: true,
      approvedAt: FieldValue.serverTimestamp(),
      approvedBy: teacher.uid,
      growndAwardedAt: FieldValue.serverTimestamp(),
      lastGrowndError: null,
    });

    return NextResponse.json({
      success: true,
      growndResult,
      message: '승인 완료! 포인트가 부여되었습니다.',
    });
  } catch (err) {
    if (err instanceof RequestError) {
      return NextResponse.json({ success: false, error: err.message }, { status: err.status });
    }
    console.error('Approve error:', err);
    return NextResponse.json({ success: false, error: '서버 오류' }, { status: 500 });
  }
}

// 리셋: 대화 기록 삭제 (재참여 가능하게)
export async function DELETE(request) {
  try {
    const teacher = await authenticateFirebaseRequest(request);
    const { searchParams } = new URL(request.url);
    const conversationId = searchParams.get('id');

    if (!conversationId) {
      return NextResponse.json({ success: false, error: '대화 ID가 필요합니다.' }, { status: 400 });
    }

    const { convRef } = await getOwnedConversation(conversationId, teacher.uid);
    await convRef.delete();

    return NextResponse.json({
      success: true,
      message: '리셋 완료! 학생이 다시 참여할 수 있습니다.',
    });
  } catch (err) {
    if (err instanceof RequestError) {
      return NextResponse.json({ success: false, error: err.message }, { status: err.status });
    }
    console.error('Reset error:', err);
    return NextResponse.json({ success: false, error: '서버 오류' }, { status: 500 });
  }
}
