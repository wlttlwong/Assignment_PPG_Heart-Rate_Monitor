import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    // 1. Parse the base64 model and scaler data from the frontend
    const body = await request.json();

    if (!body.model || !body.scaler) {
      return NextResponse.json(
        { success: false, error: "Missing model or scaler data in request body" },
        { status: 400 }
      );
    }

    // 2. Forward the data to your Flask backend
    // IMPORTANT: We use 127.0.0.1:5000 to match your app.run(port=5000)
    const flaskBackendUrl = `${process.env.FLASK_URL || 'http://127.0.0.1:5000'}/upload-model`;

    console.log("Connecting to:", flaskBackendUrl);

    const response = await fetch(flaskBackendUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    // 3. Check if Flask handled the request successfully
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Flask Backend Error (${response.status}): ${errorText}`);
    }

    const data = await response.json();

    // 4. Return the Flask response (success: true) back to the UI
    return NextResponse.json(data);

  } catch (error: any) {
    console.error("Next.js API Route Error:", error);

    // If Flask isn't running, this catch block will trigger
    return NextResponse.json(
      { 
        success: false, 
        error: "Could not connect to Flask. Ensure 'python app.py' is running on port 5000." 
      },
      { status: 502 }
    );
  }
}