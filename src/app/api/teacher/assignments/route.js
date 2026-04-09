import { NextResponse } from 'next/server';

import { buildArtAssignmentContent, buildArtAssignmentTitle } from '@/lib/artAssignment';
import { generateUniqueEntryCode } from '@/lib/assignmentEntryCode';
import { normalizeAssignmentConstraints } from '@/lib/chatConstraints';
import { authenticateFirebaseRequest, RequestError } from '@/lib/serverAuth';
import {
  DEFAULT_SCORE_OPTIONS,
  DEFAULT_SCORING_STYLE,
  normalizeScoringStyle,
  validateScoreOptions,
} from '@/lib/scoreConfig';
import { FieldValue, adminDb, serializeDoc } from '@/lib/serverDb';

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
    return NextResponse.json({ success: false, error: '과제 목록을 불러오지 못했습니다.' }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const teacher = await authenticateFirebaseRequest(request);
    const body = await request.json();
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
      minTurns = 2,
      maxTurns = null,
      minStudentMessageBytes = null,
      maxStudentMessageBytes = null,
      type = 'math',
      paintingTitle = '',
      artist = '',
      year = '',
      imageUrl = '',
      paintingContext = '',
      appreciationLevel = null,
      appreciationLevelLabel = '',
      appreciationPrompt = '',
      difficultyLevel = '',
      difficultyLabel = '',
      difficultyPrompt = '',
    } = body;

    const normalizedConstraints = normalizeAssignmentConstraints({
      type,
      minTurns,
      maxTurns,
      minStudentMessageBytes,
      maxStudentMessageBytes,
    });

    const normalizedTitle =
      type === 'art'
        ? buildArtAssignmentTitle({ title, paintingTitle, artist })
        : title.trim();

    if (type !== 'art' && !normalizedTitle) {
      return NextResponse.json(
        { success: false, error: '과제 제목을 입력해 주세요.' },
        { status: 400 }
      );
    }

    if (type !== 'art' && !content.trim()) {
      return NextResponse.json(
        { success: false, error: '수업 내용을 입력해 주세요.' },
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

    let entryCode;
    try {
      entryCode = await generateUniqueEntryCode();
    } catch (error) {
      throw new RequestError(
        error instanceof Error ? error.message : '입장 코드를 생성하지 못했습니다.',
        503
      );
    }

    const assignmentData = {
      teacherId: teacher.uid,
      entryCode,
      type,
      title: normalizedTitle,
      subject: subject.trim(),
      grade: grade.trim(),
      learningObjective: learningObjective.trim(),
      content:
        type === 'art'
          ? content.trim() || buildArtAssignmentContent({ paintingTitle, artist, year })
          : content.trim(),
      keywords: Array.isArray(keywords)
        ? keywords.map((keyword) => String(keyword).trim()).filter(Boolean)
        : [],
      standards: Array.isArray(standards)
        ? standards.map((standard) => String(standard).trim()).filter(Boolean)
        : [],
      scoreOptions: validatedScoreOptions.scoreOptions,
      maxScore: validatedScoreOptions.maxScore,
      scoringStyle: normalizeScoringStyle(scoringStyle),
      minTurns: normalizedConstraints.minTurns,
      maxTurns: normalizedConstraints.maxTurns,
      minStudentMessageBytes: normalizedConstraints.minStudentMessageBytes,
      maxStudentMessageBytes: normalizedConstraints.maxStudentMessageBytes,
      isActive: true,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };

    if (type === 'art') {
      assignmentData.paintingTitle = String(paintingTitle).trim();
      assignmentData.artist = String(artist).trim();
      assignmentData.year = String(year).trim();
      assignmentData.imageUrl = String(imageUrl).trim();
      assignmentData.paintingContext = String(paintingContext).trim();
      assignmentData.appreciationLevel = appreciationLevel;
      assignmentData.appreciationLevelLabel = String(appreciationLevelLabel).trim();
      assignmentData.appreciationPrompt = String(appreciationPrompt).trim();
      assignmentData.difficultyLevel = String(difficultyLevel).trim();
      assignmentData.difficultyLabel = String(difficultyLabel).trim();
      assignmentData.difficultyPrompt = String(difficultyPrompt).trim();
    }

    const docRef = await adminDb.collection('assignments').add(assignmentData);

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
    return NextResponse.json({ success: false, error: '과제 생성에 실패했습니다.' }, { status: 500 });
  }
}
