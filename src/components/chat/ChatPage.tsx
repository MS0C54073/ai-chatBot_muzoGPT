"use client";

import React, { useEffect, useMemo, useState } from "react";
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
};

type UploadedFile = {
  id: string;
  filename: string;
  mime_type: string;
};

function ChatThread({ threadId, initialMessages, onLocalMessageUpdate }: ChatThreadProps) {
  // Extract the visible text from streamed or persisted messages.
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
  const [chatError, setChatError] = useState<string | null>(null);
  const [isTableModalOpen, setIsTableModalOpen] = useState(false);
  const [attachedFiles, setAttachedFiles] = useState<UploadedFile[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const {
    messages,
    input,
    handleInputChange,
    handleSubmit,
    isLoading,
    addToolResult,
    setInput,
    append,
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

  const [editingMessage, setEditingMessage] = useState<{
    id: string;
    content: string;
  } | null>(null);
  const [pendingDeleteMessage, setPendingDeleteMessage] =
    useState<{ id: string } | null>(null);

  const handleConfirmAction = (toolCallId: string, actionId?: string) => {
    // Send tool result to the model so it can perform the confirmed action.
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
    addToolResult({
      toolCallId,
      result: { confirmed: false, actionId, cancelled: true },
    });
    append({
      role: "user",
      content: `Cancelled action${actionId ? ` (${actionId})` : ""}.`,
    });
  };

  async function handleSaveEdit() {
    if (!editingMessage) {
      return;
    }
    const response = await fetch(`/api/threads/${threadId}/messages`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: editingMessage.id,
        content: editingMessage.content,
      }),
    });
    if (response.ok && onLocalMessageUpdate) {
      onLocalMessageUpdate((prev) =>
        prev.map((message) =>
          message.id === editingMessage.id
            ? { ...message, content: editingMessage.content }
            : message
        )
      );
    }
    setEditingMessage(null);
  }

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
    setInput((current) =>
      current.trim().length === 0 ? rangeRef : `${current} ${rangeRef}`
    );
    setIsTableModalOpen(false);
  }

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

  function handleRemoveFile(id: string) {
    setAttachedFiles((prev) => prev.filter((file) => file.id !== id));
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-4 overflow-y-auto px-6 py-6">
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
        onSubmit={(event) => {
          setChatError(null);
          setAttachedFiles([]);
          handleSubmit(event);
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
        <div className="select-none text-[180px] font-bold tracking-tight text-white/5 sm:text-[260px] lg:text-[320px]">
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
            <div>Create a thread to start chatting.</div>
            <button
              type="button"
              onClick={handleNewThread}
              className="rounded-md bg-blue-600 px-3 py-2 text-xs font-semibold text-white"
            >
              New thread
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
