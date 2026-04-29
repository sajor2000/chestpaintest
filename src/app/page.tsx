"use client";

import { useChat } from "@ai-sdk/react";
import { useState, useRef, useEffect } from "react";

const RISK_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  LOW: { bg: "bg-emerald-50", border: "border-emerald-400", text: "text-emerald-800" },
  INTERMEDIATE: { bg: "bg-amber-50", border: "border-amber-400", text: "text-amber-800" },
  CHRONIC_INJURY: { bg: "bg-orange-50", border: "border-orange-400", text: "text-orange-800" },
  HIGH: { bg: "bg-red-50", border: "border-red-400", text: "text-red-800" },
  STEMI_PATHWAY: { bg: "bg-red-100", border: "border-red-600", text: "text-red-900" },
};

function RiskCard({ data }: { data: Record<string, unknown> }) {
  const risk = (data.risk as string) ?? (data.action as string) ?? "";
  const colors = RISK_COLORS[risk] ?? RISK_COLORS.INTERMEDIATE;
  const disposition = data.disposition as string | undefined;
  const rationale = data.rationale as string | undefined;
  const message = data.message as string | undefined;
  const footnotes = (data.footnotes as string[]) ?? [];

  return (
    <div className={`my-2 rounded-lg border-l-4 p-3 ${colors.bg} ${colors.border}`}>
      <div className={`font-bold text-sm ${colors.text}`}>
        {risk.replace(/_/g, " ")}
      </div>
      {disposition && <div className="text-sm mt-1">{disposition}</div>}
      {rationale && <div className="text-xs text-gray-600 mt-1">{rationale}</div>}
      {message && !disposition && <div className="text-sm mt-1">{message}</div>}
      {footnotes.length > 0 && (
        <div className="text-xs text-gray-500 mt-1 italic">
          {footnotes.join(" ")}
        </div>
      )}
    </div>
  );
}

function ToolResult({ part }: { part: { type: string; result?: Record<string, unknown> } }) {
  const data = part.result;
  if (!data) return null;

  if (data.risk || data.action === "STEMI_PATHWAY") {
    return <RiskCard data={data} />;
  }

  const message = data.message as string | undefined;
  const footnote = data.footnote as string | undefined;
  const footnotes = data.footnotes as string[] | undefined;

  if (!message) return null;

  return (
    <div className="my-1.5 rounded-md bg-slate-50 border border-slate-200 px-3 py-2 text-sm">
      <div className="font-mono text-xs text-slate-700">{message}</div>
      {(footnote ?? (footnotes && footnotes.length > 0)) && (
        <div className="text-xs text-slate-500 mt-1 italic">
          {footnote ?? footnotes?.join(" ")}
        </div>
      )}
    </div>
  );
}

export default function Chat() {
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const { messages, sendMessage, status } = useChat();
  const isLoading = status === "streaming" || status === "submitted";

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  return (
    <div className="flex flex-col h-dvh bg-white">
      {/* Header */}
      <header className="bg-[#003366] text-white px-4 py-3 flex items-center gap-3 shrink-0">
        <div className="w-8 h-8 rounded bg-white/20 flex items-center justify-center text-xs font-bold">
          R
        </div>
        <div>
          <h1 className="text-base font-semibold leading-tight">
            Chest Pain CDS
          </h1>
          <p className="text-xs text-white/70">hs-TnI Pathway — Rush USOH</p>
        </div>
      </header>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {messages.length === 0 && (
          <div className="text-center text-sm text-slate-400 mt-12">
            Send a message to start the chest pain pathway.
          </div>
        )}
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                msg.role === "user"
                  ? "bg-[#003366] text-white"
                  : "bg-slate-100 text-slate-800"
              }`}
            >
              {msg.parts.map((part, i) => {
                if (part.type === "text") {
                  return (
                    <span key={`${msg.id}-${i}`} className="whitespace-pre-wrap">
                      {part.text}
                    </span>
                  );
                }
                if (part.type.startsWith("tool-")) {
                  return (
                    <ToolResult
                      key={`${msg.id}-${i}`}
                      part={part as { type: string; result?: Record<string, unknown> }}
                    />
                  );
                }
                return null;
              })}
            </div>
          </div>
        ))}
        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-slate-100 rounded-2xl px-4 py-3 flex gap-1">
              <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce" />
              <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce [animation-delay:150ms]" />
              <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce [animation-delay:300ms]" />
            </div>
          </div>
        )}
      </div>

      {/* Disclaimer */}
      <div className="px-4 py-1 text-center">
        <p className="text-[10px] text-slate-400">
          Decision support tool only. Final clinical judgment rests with the
          treating physician.
        </p>
      </div>

      {/* Input */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!input.trim() || isLoading) return;
          sendMessage({ text: input });
          setInput("");
        }}
        className="px-4 pb-4 pt-1"
      >
        <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">
          <input
            className="flex-1 bg-transparent outline-none text-sm text-slate-800 placeholder:text-slate-400"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Describe findings or answer the question..."
            disabled={isLoading}
          />
          <button
            type="submit"
            disabled={!input.trim() || isLoading}
            className="shrink-0 w-8 h-8 rounded-lg bg-[#003366] text-white flex items-center justify-center disabled:opacity-40 transition-opacity"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
            </svg>
          </button>
        </div>
      </form>
    </div>
  );
}
