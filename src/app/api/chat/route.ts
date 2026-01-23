import { NextResponse } from "next/server";
import {
  convertToModelMessages,
  jsonSchema,
  streamText,
  tool,
  type UIMessage,
} from "ai";
import { openai } from "@ai-sdk/openai";
import { saveMessage } from "@/lib/db";
import {
  explainFormula,
  getRange,
  updateCell,
  type CellValue,
} from "@/lib/tools/xlsx";

export const runtime = "nodejs";

type ChatRequest = {
  threadId?: string;
  messages?: UIMessage[];
  stream?: boolean;
};

export async function POST(request: Request) {
  let body: ChatRequest;
  try {
    body = (await request.json()) as ChatRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const threadId = body.threadId?.trim();
  const uiMessages = Array.isArray(body.messages) ? body.messages : [];
  const shouldStream = body.stream !== false;

  if (!threadId) {
    return NextResponse.json({ error: "threadId is required" }, { status: 400 });
  }

  const lastMessage = uiMessages[uiMessages.length - 1];
  if (lastMessage?.role === "user" && typeof lastMessage.content === "string") {
    try {
      await saveMessage({
        threadId,
        role: "user",
        content: lastMessage.content,
      });
    } catch {
      return NextResponse.json(
        { error: "Failed to persist user message" },
        { status: 500 }
      );
    }
  }

  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json(
      { error: "Missing OPENAI_API_KEY in .env.local" },
      { status: 500 }
    );
  }

  try {
    // Enable tool calls only when the user provides an XLSX range mention.
    const shouldUseTools =
      lastMessage?.role === "user" &&
      typeof lastMessage.content === "string" &&
      lastMessage.content.includes("@");

    const tools = shouldUseTools
      ? {
        confirmAction: tool({
          description:
            "Request explicit user confirmation before performing a destructive action. You MUST use this tool before calling updateCell or any other tool that modifies data.",
          parameters: jsonSchema({
            type: "object",
            additionalProperties: false,
            properties: {
              title: { type: "string" },
              description: { type: "string" },
              actionId: { type: "string" },
              confirmLabel: { type: "string" },
              cancelLabel: { type: "string" },
            },
            required: [],
          }),
          execute: async (args) => ({
            status: "needs_confirmation",
            ...args,
          }),
        }),
        getRange: tool({
          description: "Read a cell range from /data/example.xlsx.",
          parameters: jsonSchema({
            type: "object",
            additionalProperties: false,
            properties: {
              sheet: { type: "string" },
              range: { type: "string" },
            },
            required: ["range"],
          }),
          execute: async (args) => {
            try {
              return { status: "ok", result: getRange(args.range, args.sheet) };
            } catch (error) {
              return {
                status: "error",
                message:
                  error instanceof Error
                    ? error.message
                    : "Failed to read range.",
              };
            }
          },
        }),
        updateCell: tool({
          description:
            "Update a single cell in /data/example.xlsx. You MUST ask for user confirmation using the confirmAction tool BEFORE calling this tool.",
          parameters: jsonSchema({
            type: "object",
            additionalProperties: false,
            properties: {
              sheet: { type: "string" },
              cell: { type: "string" },
              value: {
                oneOf: [
                  { type: "string" },
                  { type: "number" },
                  { type: "boolean" },
                  { type: "null" },
                ],
              },
              confirmed: { type: "boolean" },
            },
            required: ["cell", "value"],
          }),
          execute: async (args) => {
            if (!args.confirmed) {
              return {
                status: "needs_confirmation",
                sheet: args.sheet,
                cell: args.cell,
                value: args.value as CellValue,
              };
            }
            try {
              return {
                status: "updated",
                result: updateCell(
                  args.cell,
                  args.value as CellValue,
                  args.sheet
                ),
              };
            } catch (error) {
              return {
                status: "error",
                message:
                  error instanceof Error
                    ? error.message
                    : "Failed to update cell.",
              };
            }
          },
        }),
        openTable: tool({
          description: "Render a table preview for the user.",
          parameters: jsonSchema({
            type: "object",
            additionalProperties: false,
            properties: {
              title: { type: "string" },
              columns: { type: "array", items: { type: "string" } },
              rows: { type: "array", items: { type: "array" } },
            },
            required: ["columns", "rows"],
          }),
          execute: async (args) => ({
            status: "ok",
            ...args,
          }),
        }),
        highlightCells: tool({
          description: "Highlight specific cells within a table preview.",
          parameters: jsonSchema({
            type: "object",
            additionalProperties: false,
            properties: {
              title: { type: "string" },
              columns: { type: "array", items: { type: "string" } },
              rows: { type: "array", items: { type: "array" } },
              highlights: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    row: { type: "number" },
                    col: { type: "number" },
                    color: { type: "string" },
                  },
                  required: ["row", "col"],
                },
              },
            },
            required: ["columns", "rows", "highlights"],
          }),
          execute: async (args) => ({
            status: "ok",
            ...args,
          }),
        }),
        explainFormula: tool({
          description:
            "Explain the formula in a cell from /data/example.xlsx, if present.",
          parameters: jsonSchema({
            type: "object",
            additionalProperties: false,
            properties: {
              sheet: { type: "string" },
              cell: { type: "string" },
            },
            required: ["cell"],
          }),
          execute: async (args) => {
            try {
              return {
                status: "ok",
                result: explainFormula(args.cell, args.sheet),
              };
            } catch (error) {
              return {
                status: "error",
                message:
                  error instanceof Error
                    ? error.message
                    : "Failed to explain formula.",
              };
            }
          },
        }),
      }
      : undefined;

    // Convert UI messages into model messages compatible with the provider.
    const modelMessages = await convertToModelMessages(
      uiMessages.map((message) => {
        const { id, ...rest } = message;
        return rest;
      }),
      tools ? { tools } : undefined
    );

    // Stream the response and persist the assistant reply on completion.
    const result = await streamText({
      model: openai("gpt-4o-mini"),
      messages: modelMessages,
      tools,
      async onFinish({ text }) {
        if (text.trim().length === 0) {
          return;
        }
        try {
          await saveMessage({
            threadId,
            role: "assistant",
            content: text,
          });
        } catch {
          // Best-effort persistence; avoid crashing the stream on DB errors.
        }
      },
    });

    if (shouldStream) {
      return result.toTextStreamResponse();
    }
    const text = await result.text;
    return NextResponse.json({ text });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to generate response";
    console.error("Chat API error:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
