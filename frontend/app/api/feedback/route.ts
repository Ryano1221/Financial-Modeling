import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { type, message, email, page } = body;

    const typeLabel = type === "question" ? "💬 Question" : "🐛 Bug Report";
    const fromUser = email ? `From: ${email}` : "From: Anonymous";
    const pageInfo = page ? `Page: ${page}` : "";

    // Always log regardless of email success
    console.log("[FEEDBACK]", { type, message, email, page, timestamp: new Date().toISOString() });

    if (process.env.RESEND_API_KEY) {
      await resend.emails.send({
        from: "CRE Model Feedback <onboarding@resend.dev>",
        to: "ryan@thecremodel.com",
        subject: `${typeLabel} — CRE Model Feedback`,
        html: `
          <div style="font-family: monospace; background: #0a0a0a; color: #e4e4e7; padding: 32px; border-radius: 12px; max-width: 600px;">
            <div style="border-bottom: 1px solid #27272a; padding-bottom: 16px; margin-bottom: 24px;">
              <span style="color: #06b6d4; font-size: 12px; letter-spacing: 0.1em; text-transform: uppercase;">THE CRE MODEL</span>
              <h2 style="color: #ffffff; margin: 8px 0 0; font-size: 20px;">${typeLabel}</h2>
            </div>

            <div style="background: #18181b; border: 1px solid #27272a; border-radius: 8px; padding: 20px; margin-bottom: 20px;">
              <p style="color: #a1a1aa; font-size: 11px; text-transform: uppercase; letter-spacing: 0.1em; margin: 0 0 8px;">Message</p>
              <p style="color: #f4f4f5; margin: 0; line-height: 1.6; white-space: pre-wrap;">${message}</p>
            </div>

            <div style="display: flex; gap: 16px; color: #71717a; font-size: 12px;">
              <span>${fromUser}</span>
              ${pageInfo ? `<span style="color: #3f3f46;">·</span><span>${pageInfo}</span>` : ""}
              <span style="color: #3f3f46;">·</span>
              <span>${new Date().toLocaleString("en-US", { timeZone: "America/Chicago" })} CT</span>
            </div>
          </div>
        `,
      });
    }

    return Response.json({ success: true });
  } catch (error) {
    console.error("[FEEDBACK] Error:", error);
    return Response.json({ success: false, error: "Failed to submit feedback" }, { status: 500 });
  }
}
