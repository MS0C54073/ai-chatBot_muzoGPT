"use client";

/**
 * Chat Interface Component
 * 
 * Main UI for conversing with the AI assistant.
 * Features:
 * - Thread creation and management via sidebar
 * - Real-time message streaming using Vercel AI SDK
 * - Message editing and regeneration
 * - File upload injection into model context
 * - Tool calling with confirmation cards
 * - Table preview modal for XLSX ranges
 * 
 * Component hierarchy:
 * - ChatPage (main layout) 
 *   - ThreadsSidebar (left sidebar with thread list)
 *   - ChatThread (conversation area, one per thread)
 *     - ConfirmActionCard (confirmation UI)
 *     - TableModal (XLSX preview)
 *     - Message rendering
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useChat, type Message as AiMessage } from "@ai-sdk/react";
import ThreadsSidebar, {
  type Thread as SidebarThread,
} from "@/components/chat/ThreadsSidebar";
import ConfirmActionCard, {
  type ConfirmActionArgs,
} from "@/components/tools/ConfirmActionCard";
import TableModal from "@/components/tools/TableModal";
import OpenTableCard from "@/components/tools/OpenTableCard";
import HighlightCellsCard from "@/components/tools/HighlightCellsCard";

type Thread = SidebarThread;

type MessageRecord = {
  id: string;
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  created_at: number;
};

type ChatThreadProps = {
  threadId: string;
  initialMessages: AiMessage[];
  onLocalMessageUpdate?: (updater: (prev: MessageRecord[]) => MessageRecord[]) => void;
  messageRecords?: MessageRecord[];
  onTitleUpdate?: (newTitle: string) => void;
};

type UploadedFile = {
  id: string;
  filename: string;
  mime_type: string;
};

function ChatThread({
  threadId,
  initialMessages,
  onLocalMessageUpdate,
  messageRecords = [],
  onTitleUpdate,
}: ChatThreadProps) {
  /**
   * Extracts visible text from AI SDK message formats.
   * Handles both string content and streamed message parts.
   * Used to display message content in the UI.
   * @param {AiMessage} message - Message from useChat hook
   * @returns {string} Displayable text content
   */
  const getMessageText = (message: AiMessage) => {
    if ("content" in message && typeof message.content === "string") {
      return message.content;
    }
    if ("parts" in message && Array.isArray(message.parts)) {
      return message.parts
        .map((part) => (part.type === "text" ? part.text : ""))
        .join("");
    }
    return "";
  };
  
  // UI state for errors, modals, and file uploads
  const [chatError, setChatError] = useState<string | null>(null);
  const [isTableModalOpen, setIsTableModalOpen] = useState(false);
  const [attachedFiles, setAttachedFiles] = useState<UploadedFile[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  
  // Initialize chat session with Vercel AI SDK
  // Handles streaming, tool calling, and message state management
  const {
    messages,
    input,
    handleInputChange,
    handleSubmit,
    isLoading,
    addToolResult,
    setInput,
    append,
    setMessages,
    reload,
  } = useChat({
    api: "/api/chat",
    body: { threadId, fileIds: attachedFiles.map((file) => file.id) },
    initialMessages,
    streamProtocol: "text",
    onError(error) {
      setChatError(
        error.message ||
        "Unable to reach the chat API. Check your OpenAI key and server logs."
      );
    },
  });

  // Refs for keyboard handling and UI interaction
  const keyboardSubmitRef = useRef(false);
  const [showKeyboardToast, setShowKeyboardToast] = useState(false);

  // State for editing and deleting messages
  const [editingMessage, setEditingMessage] = useState<{
    id: string;
    content: string;
  } | null>(null);
  const [pendingDeleteMessage, setPendingDeleteMessage] =
    useState<{ id: string } | null>(null);

  // Track if we've already generated a summary title for this thread
  const [titleGenerated, setTitleGenerated] = useState(false);

  /**
   * Generates a short summary title (3-5 words) from the first user message.
   * Uses simple text extraction instead of calling the AI model again.
   * @param {string} userMessage - The first message from the user
   * @returns {string} A short summary title
   */
  function generateTitleFromMessage(userMessage: string): string {
    // Take the first 40 characters or first sentence, whichever is shorter
    let title = userMessage.replace(/\n/g, " ").trim();
    
    // Find first sentence (ends with . ! ?)
    const sentenceMatch = title.match(/^[^.!?]*[.!?]/);
    if (sentenceMatch) {
      title = sentenceMatch[0].replace(/[.!?]$/, "").trim();
    }
    
    // Limit to 50 characters
    if (title.length > 50) {
      title = title.substring(0, 50).trim();
      // Remove incomplete word at the end
      const lastSpace = title.lastIndexOf(" ");
      if (lastSpace > 0) {
        title = title.substring(0, lastSpace);
      }
    }
    
    return title || "Chat";
  }

  /**
   * Automatically generates and updates the thread title based on the first user message.
   * This effect runs when the first user message is sent.
   */
  useEffect(() => {
    if (titleGenerated || !threadId) {
      return;
    }

    // Find the first user message
    const firstUserMessage = messages.find((msg) => msg.role === "user");
    if (!firstUserMessage) {
      return;
    }

    const userContent = getMessageText(firstUserMessage);
    if (!userContent || userContent.trim().length === 0) {
      return;
    }

    // Generate title and update thread
    const newTitle = generateTitleFromMessage(userContent);
    setTitleGenerated(true);

    // Update thread title via API
    fetch(`/api/threads/${threadId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: newTitle }),
    })
      .then((response) => {
        if (response.ok && onTitleUpdate) {
          // Notify parent component to update the threads list
          onTitleUpdate(newTitle);
        }
      })
      .catch(() => {
        // Silently ignore errors - title generation is non-critical
      });
  }, [messages, threadId, titleGenerated, onTitleUpdate]);

  const handleConfirmAction = (toolCallId: string, actionId?: string) => {
    // Send tool result to the model so it can perform the confirmed action.
    /**
     * User confirmed a destructive action (e.g., cell update).
     * Sends confirmation to model through addToolResult and appends confirmation message.
     */
    addToolResult({
      toolCallId,
      result: { confirmed: true, actionId },
    });
    append({
      role: "user",
      content: `Confirmed action${actionId ? ` (${actionId})` : ""}. Proceed.`,
    });
  };

  const handleCancelAction = (toolCallId: string, actionId?: string) => {
    // Cancel the action and add a user-visible cancellation message.
    /**
     * User cancelled a destructive action.
     * Sends cancellation to model and appends user-visible message.
     */
    addToolResult({
      toolCallId,
      result: { confirmed: false, actionId, cancelled: true },
    });
    append({
      role: "user",
      content: `Cancelled action${actionId ? ` (${actionId})` : ""}.`,
    });
  };

  /**
   * Saves edited message and regenerates all follow-up messages.
   * Steps:
   * 1. Update the edited message via API
   * 2. Delete all messages after the edited one
   * 3. Update local state and trigger model regeneration
   */
  async function handleSaveEdit() {
    if (!editingMessage) {
      return;
    }
    const editedId = editingMessage.id;
    const editedRecord = messageRecords.find((message) => message.id === editedId);
    
    // Persist the edited message content to the database
    const response = await fetch(`/api/threads/${threadId}/messages`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: editedId,
        content: editingMessage.content,
      }),
    });
    if (!response.ok) {
      setEditingMessage(null);
      return;
    }

    // Delete all follow-up messages so the model can regenerate from this point
    if (editedRecord) {
      await fetch(`/api/threads/${threadId}/messages`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ afterId: editedRecord.id }),
      });
    }

    // Update local message state
    if (onLocalMessageUpdate) {
      onLocalMessageUpdate((prev) =>
        prev
          .map((message) =>
            message.id === editedId
              ? { ...message, content: editingMessage.content }
              : message
          )
          .filter((message) =>
            editedRecord ? message.created_at <= editedRecord.created_at : true
          )
      );
    }

    // Update AI SDK message state and trigger regeneration
    setMessages((prev) => {
      const index = prev.findIndex((message) => message.id === editedId);
      if (index === -1) {
        return prev;
      }
      const updated = prev.slice(0, index + 1).map((message) =>
        message.id === editedId
          ? {
              ...message,
              content: editingMessage.content,
              parts: [{ type: "text" as const, text: editingMessage.content }],
            }
          : message
      );
      return updated;
    });

    setEditingMessage(null);
    await reload();
  }

  /**
   * Deletes a message and updates local state.
   * Used by both user messages and assistant responses.
   */
  async function confirmDeleteMessage(message: { id: string }) {
    const response = await fetch(`/api/threads/${threadId}/messages`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: message.id }),
    });
    if (response.ok && onLocalMessageUpdate) {
      onLocalMessageUpdate((prev) =>
        prev.filter((item) => item.id !== message.id)
      );
    }
    setPendingDeleteMessage(null);
  }

  function cancelDeleteMessage() {
    setPendingDeleteMessage(null);
  }

  
  const tableSheet = "Sheet1";
  const tableColumns = ["A", "B", "C", "D", "E"];
  const tableRows: Array<Array<string | number | null>> = [
    ["Item", "Qty", "Price", "Total", "Notes"],
    ["Widget", 2, 9.99, 19.98, "Promo"],
    ["Gadget", 1, 14.5, 14.5, null],
    ["Adapter", 3, 4.25, 12.75, "Backorder"],
  ];

  function handleInsertRange(rangeRef: string) {
    // Insert the selected range mention into the input.
    /**
     * User selected a range from the table modal (e.g., "Sheet1!A1:B3").
     * Appends it to the current input text or replaces empty input.
     */
    setInput((current) =>
      current.trim().length === 0 ? rangeRef : `${current} ${rangeRef}`
    );
    setIsTableModalOpen(false);
  }

  /**
   * Handles file upload via form input.
   * Posts file to API, stores upload metadata, and attaches to message.
   * @param {File} file - The uploaded file
   */
  async function handleFileUpload(file: File) {
    setIsUploading(true);
    const formData = new FormData();
    formData.append("file", file);
    const response = await fetch("/api/uploads", {
      method: "POST",
      body: formData,
    });
    setIsUploading(false);
    if (!response.ok) {
      setChatError("Failed to upload file.");
      return;
    }
    const uploaded = (await response.json()) as UploadedFile;
    setAttachedFiles((prev) => [...prev, uploaded]);
  }

  /**
   * Removes an uploaded file from the attachment list.
   * @param {string} id - Upload ID to remove
   */
  function handleRemoveFile(id: string) {
    setAttachedFiles((prev) => prev.filter((file) => file.id !== id));
  }

  // DOM refs for scrolling and keyboard event handling
  const messagesContainerRef = useRef<HTMLDivElement | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);

  // Auto-scroll to bottom when new messages arrive or assistant is streaming
  useEffect(() => {
    const el = messagesContainerRef.current;
    if (!el) return;
    // Smooth scroll to bottom
    try {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    } catch {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, isLoading]);

  return (
    <div className="flex h-full flex-col">
      <div ref={messagesContainerRef} className="flex-1 space-y-4 overflow-y-auto px-6 py-6">
        {messages.length === 0 ? (
          <div className="rounded-md border border-dashed border-gray-800 px-4 py-6 text-center text-sm text-gray-400">
            Start the conversation by sending a message.
          </div>
        ) : (
          messages.map((message) => {
            const text = getMessageText(message);
            return (
              <div key={message.id} className="space-y-3">
                {text ? (
                  <div
                    className={
                      message.role === "user"
                        ? "flex justify-end"
                        : "flex justify-start"
                    }
                  >
                    <div
                      className={[
                        "max-w-2xl rounded-2xl px-4 py-3 text-sm leading-relaxed",
                        message.role === "user"
                          ? "bg-blue-600 text-white"
                          : "bg-gray-800 text-gray-100",
                      ].join(" ")}
                    >
                      {text}
                    </div>
                  </div>
                ) : null}
                <div
                  className={
                    message.role === "user"
                      ? "flex justify-end"
                      : "flex justify-start"
                  }
                >
                  <div className="flex gap-2 text-[11px] text-gray-400">
                    {message.role === "user" ? (
                      <button
                        type="button"
                        onClick={() =>
                          setEditingMessage({
                            id: message.id,
                            content: text,
                          })
                        }
                        className="rounded-md border border-gray-800 px-2 py-1 hover:bg-gray-900"
                      >
                        Edit
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() =>
      setPendingDeleteMessage({ id: message.id })
                      }
                      className="rounded-md border border-gray-800 px-2 py-1 hover:bg-gray-900"
                    >
                      Delete
                    </button>
                  </div>
                </div>
                {message.toolInvocations?.map((toolInvocation) => {
                  const toolCallId = toolInvocation.toolCallId;
                  const toolName = toolInvocation.toolName;

                  if (toolName === "confirmAction") {
                    const args = toolInvocation.args as ConfirmActionArgs;
                    const result =
                      toolInvocation.state === "result" &&
                        "result" in toolInvocation
                        ? ((
                          toolInvocation as {
                            result?: { confirmed?: boolean };
                          }
                        ).result ?? undefined)
                        : undefined;
                    const status =
                      toolInvocation.state === "result"
                        ? result?.confirmed
                          ? "confirmed"
                          : "cancelled"
                        : "pending";
                    return (
                      <ConfirmActionCard
                        key={toolCallId}
                        args={args}
                        status={status}
                        onConfirm={() =>
                          handleConfirmAction(toolCallId, args.actionId)
                        }
                        onCancel={() =>
                          handleCancelAction(toolCallId, args.actionId)
                        }
                      />
                    );
                  }

                  if (toolName === "openTable") {
                    return (
                      <OpenTableCard
                        key={toolCallId}
                        args={toolInvocation.args as any}
                      />
                    );
                  }

                  if (toolName === "highlightCells") {
                    return (
                      <HighlightCellsCard
                        key={toolCallId}
                        args={toolInvocation.args as any}
                      />
                    );
                  }

                  return null;
                })}
              </div>
            );
          })
        )}
        {isLoading ? (
          <div className="flex justify-start">
            <div className="rounded-2xl bg-gray-900 px-4 py-3 text-xs text-gray-400">
              Assistant is typing...
            </div>
          </div>
        ) : null}
      </div>
      <form
        ref={formRef}
        onSubmit={(event) => {
          setChatError(null);
          const wasKeyboard = keyboardSubmitRef.current;
          keyboardSubmitRef.current = false;
          // Submit while attached files are still present so fileIds are included
          handleSubmit(event);
          // Clear attached files after submitting
          setAttachedFiles([]);
          if (wasKeyboard) {
            setShowKeyboardToast(true);
            window.setTimeout(() => setShowKeyboardToast(false), 1400);
          }
        }}
        className="border-t border-gray-900 bg-gray-950 px-6 py-4"
      >
        <div className="flex items-end gap-3">
          <textarea
            value={input}
            onChange={handleInputChange}
            placeholder="Send a message..."
            className="min-h-[44px] flex-1 resize-none rounded-xl border border-gray-800 bg-gray-900 px-4 py-2 text-sm text-gray-100 outline-none focus:border-gray-600"
            rows={1}
            onKeyDown={(e) => {
              // Enter to submit (without Shift). Preserve Shift+Enter for newline.
              if (e.key === "Enter" && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
                e.preventDefault();
                // Mark keyboard submit and trigger the form onSubmit handler
                keyboardSubmitRef.current = true;
                formRef.current?.requestSubmit();
              }
            }}
            rows={1}
          />
          <button
            type="button"
            onClick={() => setIsTableModalOpen(true)}
            className="rounded-xl border border-gray-800 px-3 py-2 text-xs text-gray-300 hover:bg-gray-900"
          >
            Select range
          </button>
          <button
            type="submit"
            disabled={isLoading || input.trim().length === 0}
            className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-blue-900"
          >
            Send
          </button>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-gray-400">
          <label className="rounded-md border border-gray-800 px-2 py-1 text-xs text-gray-300 hover:bg-gray-900">
            <input
              type="file"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) {
                  handleFileUpload(file);
                  event.target.value = "";
                }
              }}
            />
            {isUploading ? "Uploading..." : "Attach file"}
          </label>
          {attachedFiles.map((file) => (
            <span
              key={file.id}
              className="flex items-center gap-2 rounded-full border border-gray-800 px-2 py-1"
            >
              {file.filename}
              <button
                type="button"
                onClick={() => handleRemoveFile(file.id)}
                className="text-gray-500 hover:text-gray-200"
              >
                ✕
              </button>
            </span>
          ))}
          {attachedFiles.length === 0 ? (
            <span>Attach a text/CSV/JSON file to provide context.</span>
          ) : null}
        </div>
      </form>
      <TableModal
        isOpen={isTableModalOpen}
        sheetName={tableSheet}
        columns={tableColumns}
        rows={tableRows}
        onClose={() => setIsTableModalOpen(false)}
        onInsert={handleInsertRange}
      />
      {chatError ? (
        <div className="border-t border-gray-900 bg-gray-950 px-6 py-3 text-xs text-rose-200">
          {chatError}
        </div>
      ) : null}
      {editingMessage ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6">
          <div className="w-full max-w-xl rounded-2xl border border-gray-800 bg-gray-950 p-4 text-sm text-gray-100">
            <div className="text-base font-semibold">Edit message</div>
            <textarea
              value={editingMessage.content}
              onChange={(event) =>
                setEditingMessage((current) =>
                  current ? { ...current, content: event.target.value } : current
                )
              }
              className="mt-3 min-h-[120px] w-full rounded-xl border border-gray-800 bg-gray-900 p-3 text-sm text-gray-100"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditingMessage(null)}
                className="rounded-md border border-gray-800 px-3 py-2 text-xs text-gray-300 hover:bg-gray-900"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveEdit}
                className="rounded-md bg-blue-600 px-3 py-2 text-xs font-semibold text-white"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {pendingDeleteMessage ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6">
          <ConfirmActionCard
            args={{
              title: "Delete message?",
              description:
                "Are you sure you want to delete this message? This cannot be undone.",
              actionId: pendingDeleteMessage.id,
              confirmLabel: "Yes, delete",
              cancelLabel: "No, keep it",
            }}
            onConfirm={() => confirmDeleteMessage(pendingDeleteMessage)}
            onCancel={cancelDeleteMessage}
          />
        </div>
      ) : null}
    </div>
  );
}

export default function () {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [threadMessages, setThreadMessages] = useState<MessageRecord[]>([]);
  const [isLoadingThreads, setIsLoadingThreads] = useState(true);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Thread | null>(null);
  const initialLoadRef = React.useRef(true);

  useEffect(() => {
    let cancelled = false;

    async function loadThreads() {
      // Load threads and ensure an initial thread exists for input visibility.
      setIsLoadingThreads(true);
      const response = await fetch("/api/threads", { cache: "no-store" });
      if (!response.ok) {
        setIsLoadingThreads(false);
        return;
      }
      const data = (await response.json()) as Thread[];
      if (cancelled) {
        return;
      }
      if (data.length === 0 && initialLoadRef.current) {
        const created = await createThread();
        if (!cancelled && created) {
          setThreads([created]);
          setActiveThreadId(created.id);
        }
      } else {
        setThreads(data);
        setActiveThreadId((current) => current ?? data[0]?.id ?? null);
      }
      setIsLoadingThreads(false);
      initialLoadRef.current = false;
    }

    void loadThreads();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!activeThreadId) {
      return;
    }

    let cancelled = false;

    async function loadMessages() {
      // Load messages for the active thread.
      setIsLoadingMessages(true);
      const response = await fetch(
        `/api/threads/${activeThreadId}/messages`,
        { cache: "no-store" }
      );
      if (!response.ok) {
        setIsLoadingMessages(false);
        return;
      }
      const data = (await response.json()) as MessageRecord[];
      if (!cancelled) {
        setThreadMessages(data);
      }
      setIsLoadingMessages(false);
    }

    void loadMessages();

    return () => {
      cancelled = true;
    };
  }, [activeThreadId]);

  const initialMessages = useMemo<AiMessage[]>(
    () =>
      threadMessages.map((message) => ({
        id: message.id,
        role: message.role === "tool" ? "data" : message.role,
        content: message.content,
      })),
    [threadMessages]
  );

  async function createThread() {
    const response = await fetch("/api/threads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "New Chat" }),
    });
    if (!response.ok) {
      return null;
    }
    return (await response.json()) as Thread;
  }

  async function handleNewThread() {
    // Create and activate a fresh thread.
    const created = await createThread();
    if (!created) {
      return;
    }
    setThreads((prev) => [created, ...prev]);
    setActiveThreadId(created.id);
    setThreadMessages([]);
  }

  async function handleDeleteThread(thread: Thread) {
    setPendingDelete(thread);
  }

  async function confirmDeleteThread(thread: Thread) {
    // Delete the thread and refresh the list.
    const response = await fetch(`/api/threads/${thread.id}`, {
      method: "DELETE",
    });
    if (!response.ok) {
      return;
    }
    setThreads((prev) => prev.filter((item) => item.id !== thread.id));
    if (activeThreadId === thread.id) {
      setActiveThreadId(null);
      setThreadMessages([]);
    }
    const refreshed = await fetch("/api/threads", { cache: "no-store" });
    if (refreshed.ok) {
      const data = (await refreshed.json()) as Thread[];
      setThreads(data);
      setActiveThreadId(data[0]?.id ?? null);
    }
    setPendingDelete(null);
  }

  async function cancelDeleteThread(thread: Thread) {
    if (activeThreadId) {
      const response = await fetch(
        `/api/threads/${activeThreadId}/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            role: "user",
            content: `Cancelled deletion of thread \"${thread.title}\".`,
          }),
        }
      );
      if (response.ok) {
        const message = (await response.json()) as MessageRecord;
        setThreadMessages((prev) => [...prev, message]);
      }
    }
    setPendingDelete(null);
  }

  function handleSelectThread(threadId: string) {
    setActiveThreadId(threadId);
  }

  return (
    <div className="relative flex h-screen bg-gray-950 text-gray-100">
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div className="select-none text-[150px] font-bold tracking-tight text-white/5 sm:text-[220px] lg:text-[280px]">
          muzoGPT
        </div>
      </div>
      <ThreadsSidebar
        threads={threads}
        activeThreadId={activeThreadId ?? undefined}
        onNewThread={handleNewThread}
        onSelectThread={handleSelectThread}
        onDeleteThread={handleDeleteThread}
      />
      <main className="relative z-10 flex flex-1 flex-col">
        {isLoadingThreads ? (
          <div className="flex flex-1 items-center justify-center text-sm text-gray-400">
            Loading threads...
          </div>
        ) : !activeThreadId ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 text-sm text-gray-400">
            <div>Hello! Write a text to chat with muzoGPT</div>
            <button
              type="button"
              onClick={handleNewThread}
              className="rounded-md bg-blue-600 px-3 py-2 text-xs font-semibold text-white"
            >
              New Chat
            </button>
          </div>
        ) : (
          <div className="flex h-full flex-col">
            {isLoadingMessages ? (
              <div className="flex flex-1 items-center justify-center text-sm text-gray-400">
                Loading messages...
              </div>
            ) : (
              <ChatThread
                key={activeThreadId}
                threadId={activeThreadId}
                initialMessages={initialMessages}
                onLocalMessageUpdate={setThreadMessages}
                messageRecords={threadMessages}
                onTitleUpdate={(newTitle) => {
                  // Update the thread title in the sidebar
                  setThreads((prev) =>
                    prev.map((thread) =>
                      thread.id === activeThreadId
                        ? { ...thread, title: newTitle }
                        : thread
                    )
                  );
                }}
              />
            )}
          </div>
        )}
      </main>
      {pendingDelete ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6">
          <ConfirmActionCard
            args={{
              title: "Delete thread?",
              description: `Are you sure you want to delete \"${pendingDelete.title}\"? This cannot be undone.`,
              actionId: pendingDelete.id,
              confirmLabel: "Yes, delete",
              cancelLabel: "No, keep it",
            }}
            onConfirm={() => confirmDeleteThread(pendingDelete)}
            onCancel={() => cancelDeleteThread(pendingDelete)}
          />
        </div>
      ) : null}
    </div>
  );
}
