/**
 * Chat API Route Handler
 * 
 * This endpoint handles streaming chat interactions with the OpenAI API.
 * It manages message persistence, file uploads, and tool-enabled interactions
 * for reading/updating XLSX files and confirming destructive actions.
 * 
 * Key features:
 * - Persists user and assistant messages to SQLite
 * - Streams responses using the Vercel AI SDK
 * - Supports optional XLSX tools (getRange, updateCell, explainFormula)
 * - Injects uploaded file contents as context to the model
 * - Handles tool calls with confirmation for destructive operations
 */

import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import {
  convertToModelMessages,
  jsonSchema,
  streamText,
  tool,
  type UIMessage,
} from "ai";
import { openai } from "@ai-sdk/openai";
import { saveMessage } from "@/lib/db";
import { getUploadById } from "@/lib/db";
import {
  explainFormula,
  getRange,
  updateCell,
  type CellValue,
} from "@/lib/tools/xlsx";

export const runtime = "nodejs";

/**
 * ChatRequest type definition
 * @property {string} threadId - UUID of the conversation thread (required)
 * @property {UIMessage[]} messages - Array of chat messages (user/assistant) to send to the model
 * @property {boolean} stream - Whether to stream the response (default: true)
 * @property {string[]} fileIds - Array of upload IDs to inject into model context
 */
type ChatRequest = {
  threadId?: string;
  messages?: UIMessage[];
  stream?: boolean;
  fileIds?: string[];
};

/**
 * POST handler for chat requests
 * 
 * Workflow:
 * 1. Validate and parse the incoming request JSON
 * 2. Extract threadId, messages, and file IDs from the request body
 * 3. Persist the user message to the database
 * 4. Check for OpenAI API key
 * 5. Determine if XLSX tools should be enabled (based on @ mentions)
 * 6. Load and inject uploaded file contents as system context
 * 7. Stream the response from OpenAI and persist the assistant reply
 * 
 * @param {Request} request - NextRequest containing ChatRequest JSON body
 * @returns {Response} Streaming text response or JSON error response
 */
export async function POST(request: Request) {
  let body: ChatRequest;
  try {
    body = (await request.json()) as ChatRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Extract and validate request parameters
  const threadId = body.threadId?.trim();
  const uiMessages = Array.isArray(body.messages) ? body.messages : [];
  const shouldStream = body.stream !== false;
  const fileIds = Array.isArray(body.fileIds) ? body.fileIds : [];

  // Thread ID is required to link messages to a conversation
  if (!threadId) {
    return NextResponse.json({ error: "threadId is required" }, { status: 400 });
  }

  // Persist the user message to the database so it's not lost
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

  // Ensure OpenAI API key is configured before attempting to call the API
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json(
      { error: "Missing OPENAI_API_KEY in .env.local" },
      { status: 500 }
    );
  }

  try {
    // Tools are only enabled if the user's message contains XLSX range mentions (e.g., @Sheet!A1:B3)
    // This prevents unnecessary tool definitions and keeps the model focused on pure chat when not needed
    const shouldUseTools =
      lastMessage?.role === "user" &&
      typeof lastMessage.content === "string" &&
      lastMessage.content.includes("@");

    // Define all available tools. These are only passed to the model if shouldUseTools is true
    const tools = shouldUseTools
      ? {
      // confirmAction: Prompts user to confirm before destructive operations
      // Used as a gate before updateCell or any other mutating tools
      confirmAction: tool({
        description:
          "Request explicit user confirmation before performing a destructive action. You MUST use this tool before calling updateCell or any other tool that modifies data.",
        inputSchema: jsonSchema({
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
      // getRange: Reads a rectangular range of cells from the XLSX file
      // Returns the values in a 2D array format
      getRange: tool({
        description: "Read a cell range from /data/example.xlsx.",
        inputSchema: jsonSchema({
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
      // updateCell: Updates a single cell value in the XLSX file
      // Requires explicit user confirmation before executing
      updateCell: tool({
        description:
          "Update a single cell in /data/example.xlsx. You MUST ask for user confirmation using the confirmAction tool BEFORE calling this tool.",
        inputSchema: jsonSchema({
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
      // openTable: Renders a formatted table in the chat UI
      // Can be used to display ranges or query results
      openTable: tool({
        description: "Render a table preview for the user.",
        inputSchema: jsonSchema({
          type: "object",
          additionalProperties: false,
          properties: {
            title: { type: "string" },
            columns: { type: "array", items: { type: "string" } },
            rows: {
              type: "array",
              items: {
                type: "array",
                items: {
                  oneOf: [
                    { type: "string" },
                    { type: "number" },
                    { type: "boolean" },
                    { type: "null" },
                  ],
                },
              },
            },
          },
          required: ["columns", "rows"],
        }),
        execute: async (args) => ({
          status: "ok",
          ...args,
        }),
      }),
      // highlightCells: Highlights specific cells in a table with colors
      // Useful for drawing attention to important data or anomalies
      highlightCells: tool({
        description: "Highlight specific cells within a table preview.",
        inputSchema: jsonSchema({
          type: "object",
          additionalProperties: false,
          properties: {
            title: { type: "string" },
            columns: { type: "array", items: { type: "string" } },
            rows: {
              type: "array",
              items: {
                type: "array",
                items: {
                  oneOf: [
                    { type: "string" },
                    { type: "number" },
                    { type: "boolean" },
                    { type: "null" },
                  ],
                },
              },
            },
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
      // explainFormula: Explains a formula (if present) in a specific cell
      // Returns the formula text and a human-readable explanation
      explainFormula: tool({
        description:
          "Explain the formula in a cell from /data/example.xlsx, if present.",
        inputSchema: jsonSchema({
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

    // Load and prepare uploaded file contents as additional context for the model
    // Only text/JSON files are injected; binary files are skipped
    const fileContext: string[] = [];
    for (const fileId of fileIds) {
      const upload = await getUploadById(fileId);
      if (!upload) {
        continue;
      }
      
      // Start with file metadata (name and mime type)
      let preview = `File: ${upload.filename} (${upload.mime_type})`;
      
      // For text and JSON files, read and include file contents (capped at 5KB)
      if (
        upload.mime_type.startsWith("text/") ||
        upload.mime_type.includes("json")
      ) {
        try {
          const raw = await fs.readFile(upload.storage_path, "utf8");
          preview = `${preview}\n${raw.slice(0, 5000)}`;
        } catch {
          preview = `${preview}\n[Unable to read file contents]`;
        }
      } else {
        // Binary files are only identified; contents are not included
        preview = `${preview}\n[Binary file contents not included]`;
      }
      
      fileContext.push(preview);
    }

    // Convert UI-compatible messages into OpenAI API format
    const modelMessages = await convertToModelMessages(
      uiMessages.map((message) => {
        const { id, ...rest } = message; // Remove UI-only message IDs
        return rest;
      }),
      tools ? { tools } : undefined
    );

    // If files were uploaded, prepend them as system context so the model knows about them
    const contextMessages =
      fileContext.length > 0
        ? [
            {
              role: "system" as const,
              content:
                "User uploaded files:\n\n" + fileContext.join("\n\n---\n\n"),
            },
          ]
        : [];

    // Stream the response from OpenAI and persist the assistant reply to the database
    // The onFinish callback ensures the full response is saved after streaming completes
    const result = await streamText({
      model: openai("gpt-4o-mini"),
      messages: [...contextMessages, ...modelMessages],
      tools, // Tools are undefined if no XLSX range mentions are detected
      async onFinish({ text }) {
        // Skip persisting empty responses
        if (text.trim().length === 0) {
          return;
        }
        try {
          // Persist the assistant's response to the database for thread history
          await saveMessage({
            threadId,
            role: "assistant",
            content: text,
          });
        } catch {
          // Log database errors but don't crash the stream response
          // The stream has already begun sending data, so failures here are non-critical
        }
      },
    });

    // Return response in the requested format (streaming or JSON)
    if (shouldStream) {
      return result.toTextStreamResponse();
    }
    
    // Fallback: wait for full response and return as JSON (non-streaming)
    const text = await result.text;
    return NextResponse.json({ text });
  } catch (error) {
    // Catch any unexpected errors and return a generic error response
    const message =
      error instanceof Error ? error.message : "Failed to generate response";
    console.error("Chat API error:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
