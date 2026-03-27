import { NextResponse } from 'next/server';

import { authenticateFirebaseRequest, RequestError } from '@/lib/serverAuth';
import { FieldValue, adminDb } from '@/lib/serverDb';

export const maxDuration = 30; // Vercel Pro+ 에서 최대 30초 허용

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

async function reserveApproval(conversationId, teacherUid) {
  const convRef = adminDb.collection('conversations').doc(conversationId);

  return adminDb.runTransaction(async (transaction) => {
    const convSnap = await transaction.get(convRef);

    if (!convSnap.exists) {
      throw new RequestError('대화를 찾을 수 없습니다.', 404);
    }

    const conv = convSnap.data();
    if (!conv.assignmentId) {
      throw new RequestError('과제 정보가 없는 대화입니다.', 400);
    }

    const assignmentRef = adminDb.collection('assignments').doc(conv.assignmentId);
    const assignmentSnap = await transaction.get(assignmentRef);

    if (!assignmentSnap.exists) {
      throw new RequestError('연결된 과제를 찾을 수 없습니다.', 404);
    }

    const assignment = assignmentSnap.data();
    if (assignment.teacherId !== teacherUid) {
      throw new RequestError('이 대화를 관리할 권한이 없습니다.', 403);
    }

    if (conv.approved) {
      throw new RequestError('이미 승인된 제출입니다.', 409);
    }

    if (conv.approvalStatus === 'processing') {
      throw new RequestError('현재 승인 처리 중입니다. 잠시 후 상태를 다시 확인해 주세요.', 409);
    }

    if (conv.status !== 'completed' || !Number.isFinite(conv.score)) {
      throw new RequestError('아직 채점이 완료되지 않은 제출입니다.', 409);
    }

    transaction.update(convRef, {
      approvalStatus: 'processing',
      approvalRequestedAt: FieldValue.serverTimestamp(),
      approvalRequestedBy: teacherUid,
      lastGrowndError: null,
    });

    return { convRef, conv };
  });
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

async function updateApprovalFailure(convRef, message, status, options = {}) {
  const { keepProcessing = false } = options;

  await convRef.update({
    approvalStatus: keepProcessing ? 'processing' : 'failed',
    lastGrowndError: {
      message,
      status: status ?? null,
      ambiguous: keepProcessing,
      at: FieldValue.serverTimestamp(),
    },
  });
}

export async function POST(request) {
  let reservedConversationRef = null;

  try {
    const teacher = await authenticateFirebaseRequest(request);
    const { conversationId } = await request.json();

    if (!conversationId) {
      return NextResponse.json({ success: false, error: '대화 ID가 필요합니다.' }, { status: 400 });
    }

    // teacherSettings 조회와 approval 예약을 병렬로 실행해 시간 절약
    const teacherRef = adminDb.collection('teachers').doc(teacher.uid);
    const [teacherSnap, { convRef, conv }] = await Promise.all([
      teacherRef.get(),
      reserveApproval(conversationId, teacher.uid),
    ]);
    reservedConversationRef = convRef;

    if (!teacherSnap.exists) {
      // 이미 processing으로 예약됐으므로 실패로 마킹
      await updateApprovalFailure(convRef, '교사 설정을 찾을 수 없습니다.', null);
      return NextResponse.json(
        { success: false, error: '교사 설정을 찾을 수 없습니다.' },
        { status: 400 }
      );
    }

    const teacherSettings = teacherSnap.data();
    const { growndApiKey, growndClassId } = teacherSettings;

    if (!growndApiKey || !growndClassId) {
      await updateApprovalFailure(convRef, 'Grownd 설정이 완료되지 않았습니다.', null);
      return NextResponse.json(
        { success: false, error: 'Grownd 설정이 완료되지 않았습니다.' },
        { status: 400 }
      );
    }

    const growndAbort = new AbortController();
    const growndTimeout = setTimeout(() => growndAbort.abort(), 5000);

    let growndResponse;
    try {
      growndResponse = await fetch(
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
            description: `메타인지 유니콘 학습 완료 (${conv.score}점)`,
            source: 'MetacogUnicorn',
          }),
          signal: growndAbort.signal,
        }
      );
    } catch (fetchError) {
      clearTimeout(growndTimeout);
      const isTimeout = fetchError?.name === 'AbortError';
      const errMsg = isTimeout
        ? 'Grownd 서버 응답 시간 초과 (8초). 잠시 후 다시 시도해 주세요.'
        : `Grownd 연결 실패: ${fetchError?.message || '알 수 없는 오류'}`;
      await updateApprovalFailure(reservedConversationRef ?? convRef, errMsg, null);
      return NextResponse.json({ success: false, error: errMsg }, { status: 502 });
    }
    clearTimeout(growndTimeout);

    const growndResult = await parseGrowndResponse(growndResponse);

    const growndErrorDetail = growndResult?.message
      || growndResult?.error
      || growndResult?.detail
      || growndResult?.msg
      || (growndResult?.raw
          ? `Grownd 응답(${growndResponse.status}): ${String(growndResult.raw).slice(0, 300)}`
          : null)
      || (growndResult
          ? `Grownd 응답(${growndResponse.status}): ${JSON.stringify(growndResult).slice(0, 300)}`
          : null)
      || `Grownd 포인트 지급 실패 (HTTP ${growndResponse.status})`;

    console.log('[Grownd] status:', growndResponse.status, '| result:', JSON.stringify(growndResult));

    if (!growndResponse.ok) {
      await updateApprovalFailure(
        convRef,
        growndErrorDetail,
        growndResponse.status
      );

      return NextResponse.json(
        {
          success: false,
          error: growndErrorDetail,
          growndResult,
        },
        { status: 502 }
      );
    }

    await convRef.update({
      approved: true,
      approvedAt: FieldValue.serverTimestamp(),
      approvedBy: teacher.uid,
      growndAwardedAt: FieldValue.serverTimestamp(),
      approvalStatus: 'approved',
      lastGrowndError: null,
    });

    return NextResponse.json({
      success: true,
      growndResult,
      message: '승인이 완료되었습니다.',
    });
  } catch (error) {
    if (error instanceof RequestError) {
      return NextResponse.json({ success: false, error: error.message }, { status: error.status });
    }

    if (reservedConversationRef) {
      try {
        await updateApprovalFailure(
          reservedConversationRef,
          error?.message || '승인 처리 상태를 확인할 수 없는 오류가 발생했습니다.',
          null,
          { keepProcessing: true }
        );
      } catch (updateError) {
        console.error('Failed to persist ambiguous approval state:', updateError);
      }
    }

    console.error('Approve error:', error);
    return NextResponse.json(
      {
        success: false,
        error: reservedConversationRef
          ? '승인 처리 상태를 확정하지 못했습니다. 중복 지급을 막기 위해 자동 재시도는 막아 두었습니다.'
          : '서버 오류',
      },
      { status: 500 }
    );
  }
}

export async function DELETE(request) {
  try {
    const teacher = await authenticateFirebaseRequest(request);
    const { searchParams } = new URL(request.url);
    const conversationId = searchParams.get('id');

    if (!conversationId) {
      return NextResponse.json({ success: false, error: '대화 ID가 필요합니다.' }, { status: 400 });
    }

    const { convRef, conv } = await getOwnedConversation(conversationId, teacher.uid);

    if (conv.approved) {
      return NextResponse.json(
        { success: false, error: '이미 승인된 제출은 리셋할 수 없습니다.' },
        { status: 409 }
      );
    }

    if (conv.approvalStatus === 'processing') {
      return NextResponse.json(
        { success: false, error: '현재 승인 처리 중인 제출은 리셋할 수 없습니다.' },
        { status: 409 }
      );
    }

    await convRef.delete();

    return NextResponse.json({
      success: true,
      message: '리셋이 완료되었습니다. 학생이 다시 참여할 수 있습니다.',
    });
  } catch (error) {
    if (error instanceof RequestError) {
      return NextResponse.json({ success: false, error: error.message }, { status: error.status });
    }

    console.error('Reset error:', error);
    return NextResponse.json({ success: false, error: '서버 오류' }, { status: 500 });
  }
}
