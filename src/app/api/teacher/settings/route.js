import { NextResponse } from 'next/server';

import { FieldValue, adminDb, serializeData } from '@/lib/serverDb';
import { authenticateFirebaseRequest, RequestError } from '@/lib/serverAuth';

export async function GET(request) {
  try {
    const teacher = await authenticateFirebaseRequest(request);
    const snapshot = await adminDb.collection('teachers').doc(teacher.uid).get();

    return NextResponse.json({
      success: true,
      settings: snapshot.exists ? serializeData(snapshot.data()) : null,
    });
  } catch (error) {
    if (error instanceof RequestError) {
      return NextResponse.json({ success: false, error: error.message }, { status: error.status });
    }

    console.error('Teacher settings GET error:', error);
    return NextResponse.json({ success: false, error: '서버 오류' }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const teacher = await authenticateFirebaseRequest(request);
    const { growndClassId = '', growndApiKey = '', email = '', displayName = '' } = await request.json();

    const ref = adminDb.collection('teachers').doc(teacher.uid);
    const snapshot = await ref.get();

    const payload = {
      growndClassId: growndClassId.trim(),
      growndApiKey: growndApiKey.trim(),
      email: email || teacher.email || '',
      displayName: displayName || teacher.name || '',
      updatedAt: FieldValue.serverTimestamp(),
    };

    if (snapshot.exists) {
      await ref.update(payload);
    } else {
      await ref.set({
        ...payload,
        createdAt: FieldValue.serverTimestamp(),
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof RequestError) {
      return NextResponse.json({ success: false, error: error.message }, { status: error.status });
    }

    console.error('Teacher settings POST error:', error);
    return NextResponse.json({ success: false, error: '서버 오류' }, { status: 500 });
  }
}
