import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/serverDb';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');

  if (!code) {
    return NextResponse.json({ success: false, error: '입장 코드가 필요합니다.' });
  }

  try {
    const snap = await adminDb
      .collection('assignments')
      .where('entryCode', '==', code.toUpperCase())
      .where('isActive', '==', true)
      .limit(1)
      .get();

    if (snap.empty) {
      return NextResponse.json({ success: false, error: '유효하지 않은 입장 코드입니다.' });
    }

    const doc = snap.docs[0];
    const data = doc.data();

    return NextResponse.json({
      success: true,
      assignment: {
        id: doc.id,
        title: data.title,
        subject: data.subject,
        grade: data.grade,
        entryCode: data.entryCode,
      },
    });
  } catch (err) {
    console.error('Lookup error:', err);
    return NextResponse.json({ success: false, error: '서버 오류' }, { status: 500 });
  }
}
