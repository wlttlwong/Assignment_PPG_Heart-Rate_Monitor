// app/api/upload-model/route.ts
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const body = await request.json();

    // This forwards the base64 files to your Python FastAPI/Flask server
    const response = await fetch('http://127.0.0.1:8000/upload-model', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`Backend responded with ${response.status}`);
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error: any) {
    console.error("Upload API Error:", error);
    return NextResponse.json(
      { success: false, error: "Backend unreachable. Ensure your Python server is running on port 8000." },
      { status: 502 }
    );
  }
}