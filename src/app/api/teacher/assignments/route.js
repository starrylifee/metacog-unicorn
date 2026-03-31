import { NextResponse } from 'next/server';

import { authenticateFirebaseRequest, RequestError } from '@/lib/serverAuth';
import { normalizeAssignmentConstraints } from '@/lib/chatConstraints';
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

  throw new RequestError('???怨멸텑 ?熬곣뫀????ｏ쭗???獄쏅똻???? 癲ル슢履뉑쾮?彛?????? ???怨뺣빰 ??筌먲퐣?????낆뒩??뗫빝??', 503);
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
    return NextResponse.json({ success: false, error: '??筌먦끉裕?????곸씔' }, { status: 500 });
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

    if (!title.trim()) {
      return NextResponse.json(
        { success: false, error: '??貫?????筌먯룄肄?? ??ш끽維?????낇돲??' },
        { status: 400 }
      );
    }
    if (type !== 'art' && !content.trim()) {
      return NextResponse.json(
        { success: false, error: '????? ???⑤챶裕?? ??ш끽維?????낇돲??' },
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
    const assignmentData = {
      teacherId: teacher.uid,
      entryCode,
      type,
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
      minTurns: normalizedConstraints.minTurns,
      maxTurns: normalizedConstraints.maxTurns,
      minStudentMessageBytes: normalizedConstraints.minStudentMessageBytes,
      maxStudentMessageBytes: normalizedConstraints.maxStudentMessageBytes,
      isActive: true,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };

    // 雅?퍔瑗띰㎖????貫?????ш끽維????ш끽維????⑤베堉?
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
    return NextResponse.json({ success: false, error: '??筌먦끉裕?????곸씔' }, { status: 500 });
  }
}
