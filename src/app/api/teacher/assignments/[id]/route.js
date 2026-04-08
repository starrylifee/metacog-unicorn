import { NextResponse } from 'next/server';

import { generateUniqueEntryCode } from '@/lib/assignmentEntryCode';
import { normalizeAssignmentConstraints } from '@/lib/chatConstraints';
import { authenticateFirebaseRequest, RequestError } from '@/lib/serverAuth';
import {
  getAssignmentScoreOptions,
  normalizeScoringStyle,
  validateScoreOptions,
} from '@/lib/scoreConfig';
import { FieldValue, adminDb, serializeDoc } from '@/lib/serverDb';

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

function buildCopiedTitle(title) {
  const normalizedTitle = String(title || '').trim();

  if (!normalizedTitle) {
    return '복사된 과제';
  }

  return normalizedTitle.endsWith('(복사본)')
    ? normalizedTitle
    : `${normalizedTitle} (복사본)`;
}

async function duplicateAssignment(assignmentId, assignment, teacherUid) {
  const validatedScoreOptions = validateScoreOptions(getAssignmentScoreOptions(assignment));
  if (!validatedScoreOptions.ok) {
    throw new RequestError(validatedScoreOptions.error, 400);
  }

  const normalizedConstraints = normalizeAssignmentConstraints(assignment);

  let entryCode;
  try {
    entryCode = await generateUniqueEntryCode();
  } catch (error) {
    throw new RequestError(
      error instanceof Error ? error.message : '입장 코드를 생성하지 못했습니다.',
      503
    );
  }

  const duplicatedAssignment = {
    teacherId: teacherUid,
    entryCode,
    type: assignment.type === 'art' ? 'art' : 'math',
    title: buildCopiedTitle(assignment.title),
    subject: String(assignment.subject || '').trim(),
    grade: String(assignment.grade || '').trim(),
    learningObjective: String(assignment.learningObjective || '').trim(),
    content: String(assignment.content || '').trim(),
    keywords: Array.isArray(assignment.keywords)
      ? assignment.keywords.map((keyword) => String(keyword).trim()).filter(Boolean)
      : [],
    standards: Array.isArray(assignment.standards)
      ? assignment.standards.map((standard) => String(standard).trim()).filter(Boolean)
      : [],
    scoreOptions: validatedScoreOptions.scoreOptions,
    maxScore: validatedScoreOptions.maxScore,
    scoringStyle: normalizeScoringStyle(assignment.scoringStyle),
    minTurns: normalizedConstraints.minTurns,
    maxTurns: normalizedConstraints.maxTurns,
    minStudentMessageBytes: normalizedConstraints.minStudentMessageBytes,
    maxStudentMessageBytes: normalizedConstraints.maxStudentMessageBytes,
    isActive: true,
    copiedFromAssignmentId: assignmentId,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };

  if (duplicatedAssignment.type === 'art') {
    duplicatedAssignment.paintingTitle = String(assignment.paintingTitle || '').trim();
    duplicatedAssignment.artist = String(assignment.artist || '').trim();
    duplicatedAssignment.year = String(assignment.year || '').trim();
    duplicatedAssignment.imageUrl = String(assignment.imageUrl || '').trim();
    duplicatedAssignment.paintingContext = String(assignment.paintingContext || '').trim();
    duplicatedAssignment.appreciationLevel = assignment.appreciationLevel ?? null;
    duplicatedAssignment.appreciationLevelLabel = String(assignment.appreciationLevelLabel || '').trim();
    duplicatedAssignment.appreciationPrompt = String(assignment.appreciationPrompt || '').trim();
    duplicatedAssignment.difficultyLevel = String(assignment.difficultyLevel || '').trim();
    duplicatedAssignment.difficultyLabel = String(assignment.difficultyLabel || '').trim();
    duplicatedAssignment.difficultyPrompt = String(assignment.difficultyPrompt || '').trim();
  }

  const docRef = await adminDb.collection('assignments').add(duplicatedAssignment);

  return {
    id: docRef.id,
    entryCode,
  };
}

async function getAssignmentId(paramsPromise) {
  const params = await paramsPromise;
  const id = params?.id;

  if (!id) {
    throw new RequestError('과제 ID가 필요합니다.', 400);
  }

  return id;
}

export async function GET(request, { params }) {
  try {
    const teacher = await authenticateFirebaseRequest(request);
    const assignmentId = await getAssignmentId(params);
    const { ref } = await getOwnedAssignment(assignmentId, teacher.uid);
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
    return NextResponse.json({ success: false, error: '과제 정보를 불러오지 못했습니다.' }, { status: 500 });
  }
}

export async function POST(request, { params }) {
  try {
    const teacher = await authenticateFirebaseRequest(request);
    const assignmentId = await getAssignmentId(params);
    const { snapshot } = await getOwnedAssignment(assignmentId, teacher.uid);
    const assignment = snapshot.data();
    const duplicated = await duplicateAssignment(assignmentId, assignment, teacher.uid);

    return NextResponse.json({
      success: true,
      assignment: duplicated,
    });
  } catch (error) {
    if (error instanceof RequestError) {
      return NextResponse.json({ success: false, error: error.message }, { status: error.status });
    }

    console.error('Assignment detail POST error:', error);
    return NextResponse.json({ success: false, error: '과제를 복사하지 못했습니다.' }, { status: 500 });
  }
}

export async function PATCH(request, { params }) {
  try {
    const teacher = await authenticateFirebaseRequest(request);
    const assignmentId = await getAssignmentId(params);
    const { ref } = await getOwnedAssignment(assignmentId, teacher.uid);
    const { isActive } = await request.json();

    if (typeof isActive !== 'boolean') {
      return NextResponse.json({ success: false, error: '과제 상태 값이 올바르지 않습니다.' }, { status: 400 });
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
    return NextResponse.json({ success: false, error: '과제 상태를 변경하지 못했습니다.' }, { status: 500 });
  }
}

export async function DELETE(request, { params }) {
  try {
    const teacher = await authenticateFirebaseRequest(request);
    const assignmentId = await getAssignmentId(params);
    const { ref } = await getOwnedAssignment(assignmentId, teacher.uid);
    const conversationsSnapshot = await adminDb
      .collection('conversations')
      .where('assignmentId', '==', assignmentId)
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
    return NextResponse.json({ success: false, error: '과제를 삭제하지 못했습니다.' }, { status: 500 });
  }
}
