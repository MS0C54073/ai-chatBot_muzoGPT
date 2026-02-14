import { NextResponse } from "next/server";
import { deleteThread, updateThread } from "@/lib/db";

type RouteParams = {
  params: Promise<{
    threadId: string;
  }>;
};

export async function DELETE(request: Request, { params }: RouteParams) {
  const { threadId } = await params;
  if (!threadId) {
    return NextResponse.json({ error: "threadId is required" }, { status: 400 });
  }
  await deleteThread(threadId);
  return NextResponse.json({ ok: true });
}

/**
 * PATCH handler to update thread properties (e.g., title)
 */
export async function PATCH(request: Request, { params }: RouteParams) {
  const { threadId } = await params;
  if (!threadId) {
    return NextResponse.json({ error: "threadId is required" }, { status: 400 });
  }
  
  const body = (await request.json()) as { title?: string };
  if (!body.title) {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }
  
  await updateThread(threadId, body.title);
  return NextResponse.json({ ok: true });
}
