import { cookies } from "next/headers";

const DEMO_USER_ID = "bytegrad@gmail.com";

async function ensureSession() {
  const store = await cookies();
  const existingUserId = store.get("arcade_user_id")?.value;

  if (existingUserId !== DEMO_USER_ID) {
    store.set("arcade_user_id", DEMO_USER_ID, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
  }

  return Response.json({ userId: DEMO_USER_ID });
}

export async function GET() {
  return ensureSession();
}

export async function POST() {
  return ensureSession();
}
