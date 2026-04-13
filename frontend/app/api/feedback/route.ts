export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { type, message, email, page } = body;

    // TODO: Wire up email sending (e.g., SendGrid, Resend, or internal service)
    console.log("[FEEDBACK]", {
      type,
      message,
      email,
      page,
      timestamp: new Date().toISOString(),
    });

    return Response.json({ success: true });
  } catch (error) {
    console.error("[FEEDBACK] Error:", error);
    return Response.json({ success: false, error: "Failed to submit feedback" }, { status: 500 });
  }
}
