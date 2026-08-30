import { NextResponse } from "next/server";
import { runAction, type ActionRequest } from "@/lib/store";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ActionRequest;
    const nextState = runAction(body);
    return NextResponse.json(nextState);
  } catch (err) {
    console.error("Error in POST /api/actions:", err);
    return NextResponse.json({ error: "Failed to run action" }, { status: 500 });
  }
}
