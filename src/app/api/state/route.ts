import { NextResponse } from "next/server";
import { getState } from "@/lib/store";

export const runtime = "nodejs";

export async function GET() {
  try {
    const state = getState();
    return NextResponse.json(state);
  } catch (err) {
    console.error("Error in GET /api/state:", err);
    return NextResponse.json({ error: "Failed to fetch state" }, { status: 500 });
  }
}
