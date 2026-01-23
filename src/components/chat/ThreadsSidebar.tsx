"use client";

import React from "react";

 export type Thread = {
   id: string;
   title: string;
   created_at: number;
 };

 export type ThreadsSidebarProps = {
   threads: Thread[];
   activeThreadId?: string;
   onNewThread: () => void;
   onSelectThread: (threadId: string) => void;
  onDeleteThread?: (thread: Thread) => void;
 };

 export default function ThreadsSidebar({
   threads,
   activeThreadId,
   onNewThread,
   onSelectThread,
  onDeleteThread,
 }: ThreadsSidebarProps) {
   return (
    <aside className="relative z-10 flex h-full w-64 flex-col border-r border-gray-800 bg-gray-950 text-gray-100">
       <div className="flex items-center justify-between px-4 py-3">
         <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-400">
          History
         </h2>
         <button
           type="button"
           onClick={onNewThread}
           className="rounded-md bg-gray-800 px-2 py-1 text-xs font-medium text-gray-100 hover:bg-gray-700"
         >
           New
         </button>
       </div>
       <div className="flex-1 overflow-y-auto px-2 pb-3">
         {threads.length === 0 ? (
           <div className="rounded-md border border-dashed border-gray-800 px-3 py-2 text-xs text-gray-500">
             No threads yet.
           </div>
         ) : (
           <ul className="space-y-1">
              {threads.map((thread) => {
               const isActive = thread.id === activeThreadId;
               return (
                 <li key={thread.id}>
                    <div
                      className={[
                        "group relative w-full rounded-md px-3 py-2 text-left text-sm transition",
                        isActive
                          ? "bg-gray-800 text-white"
                          : "text-gray-300 hover:bg-gray-900 hover:text-white",
                      ].join(" ")}
                    >
                      <button
                        type="button"
                        onClick={() => onSelectThread(thread.id)}
                        className="w-full text-left pr-12"
                      >
                        <div className="truncate">
                          {thread.title || "Untitled"}
                        </div>
                        <div className="text-[11px] text-gray-500">
                          {new Date(thread.created_at).toLocaleString()}
                        </div>
                      </button>
                      {onDeleteThread ? (
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            onDeleteThread(thread);
                          }}
                          className="absolute right-2 top-2 z-10 rounded-md border border-gray-700 px-2 py-1 text-[10px] text-gray-300 hover:bg-gray-900"
                        >
                          Delete
                        </button>
                      ) : null}
                    </div>
                 </li>
               );
             })}
           </ul>
         )}
       </div>
     </aside>
   );
 }
