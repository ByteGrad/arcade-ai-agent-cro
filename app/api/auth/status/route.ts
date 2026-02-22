import { Arcade } from "@arcadeai/arcadejs";
import { cookies } from "next/headers";

export async function POST(req: Request) {
  const { authorizationId } = (await req.json()) as {
    authorizationId?: string;
  };

  if (!authorizationId) {
    return Response.json({ error: "authorizationId required" }, { status: 400 });
  }

  const arcade = new Arcade();
  const store = await cookies();
  const userId = store.get("arcade_user_id")?.value;
  if (!userId) {
    return Response.json({ error: "Session not initialized" }, { status: 401 });
  }

  try {
    const authResponse = await arcade.auth.status({
      id: authorizationId,
      wait: 45,
    });

    return Response.json({ status: authResponse.status });
  } catch (error) {
    console.error("Auth status check error:", error);
    return Response.json(
      { status: "error", error: String(error) },
      { status: 500 }
    );
  }
}
