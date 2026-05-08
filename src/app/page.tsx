"use client";

import { useChat } from "@ai-sdk/react";
import Image from "next/image";
import { useState, useRef, useEffect, useCallback } from "react";
import type { FileUIPart } from "ai";
import {
  getPathwayStep,
  normalizeQuickReplyOptions,
  PATHWAY_STEPS,
  type PathwayStepId,
} from "@/lib/pathway-ui";

const ALLOWED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
const MAX_IMAGE_BYTES = 1024 * 1024; // 1 MB

const RISK_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  LOW: { bg: "bg-emerald-50", border: "border-emerald-500", text: "text-emerald-800" },
  INTERMEDIATE: { bg: "bg-amber-50", border: "border-amber-500", text: "text-amber-800" },
  CHRONIC_INJURY: { bg: "bg-orange-50", border: "border-orange-500", text: "text-orange-800" },
  HIGH: { bg: "bg-red-50", border: "border-red-500", text: "text-red-800" },
  STEMI_PATHWAY: { bg: "bg-red-100", border: "border-red-700", text: "text-red-900" },
};

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function RiskCard({ data }: { data: Record<string, unknown> }) {
  const risk = str(data.risk) ?? str(data.action) ?? "";
  const colors = RISK_COLORS[risk] ?? RISK_COLORS.INTERMEDIATE;
  const disposition = str(data.disposition);
  const rationale = str(data.rationale);
  const message = str(data.message);
  const footnotes = isStringArray(data.footnotes) ? data.footnotes : [];
  const recommendations = isStringArray(data.recommendations)
    ? data.recommendations
    : [];
  const isLowRiskDischarge = risk === "LOW" && recommendations.length > 0;

  return (
    <div
      className={`my-2 rounded-lg border-l-4 p-3 ${colors.bg} ${colors.border}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className={`font-bold text-sm ${colors.text} uppercase tracking-wide`}>
            {risk.replace(/_/g, " ")}
          </div>
          {isLowRiskDischarge && (
            <div className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-[#006332]">
              Low-risk discharge pathway confirmed
            </div>
          )}
        </div>
        {isLowRiskDischarge && (
          <div className="rounded-full border border-[#006332]/20 bg-white px-2.5 py-1 text-[11px] font-semibold text-[#006332]">
            Discharge
          </div>
        )}
      </div>
      {disposition && (
        <div className="text-sm mt-1 text-[#353535] font-medium">{disposition}</div>
      )}
      {rationale && (
        <div className="text-xs text-[#494949] mt-1">{rationale}</div>
      )}
      {isLowRiskDischarge && (
        <div className="mt-3 rounded-md border border-[#006332]/15 bg-white px-3 py-2.5">
          <div className="text-xs font-bold uppercase tracking-wide text-[#006332]">
            Discharge recommendations
          </div>
          <ul className="mt-2 space-y-2">
            {recommendations.map((recommendation) => (
              <li
                key={recommendation}
                className="flex gap-2 text-xs leading-snug text-[#353535]"
              >
                <span
                  className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[#006332]/10 text-[#006332]"
                  aria-hidden="true"
                >
                  <svg
                    width="11"
                    height="11"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                </span>
                <span>{recommendation}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {message && !disposition && (
        <div className="text-sm mt-1 text-[#353535]">{message}</div>
      )}
      {footnotes.length > 0 && (
        <div className="text-xs text-[#494949] mt-1.5 italic border-t border-black/5 pt-1">
          {footnotes.join(" ")}
        </div>
      )}
    </div>
  );
}

type ToolPart = { type: string; state?: string; output?: Record<string, unknown> };

type ChatMessage = ReturnType<typeof useChat>["messages"][number];

function getMessageText(msg: ChatMessage): string {
  return msg.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}

function PathwayRail({ activeStep }: { activeStep: PathwayStepId }) {
  const activeIndex = PATHWAY_STEPS.findIndex((step) => step.id === activeStep);

  return (
    <nav
      aria-label="hs-TnI pathway progress"
      className="bg-white border-b border-gray-200 px-4 py-2.5 overflow-x-auto shrink-0"
    >
      <ol className="flex min-w-max items-center gap-2">
        {PATHWAY_STEPS.map((step, index) => {
          const isActive = step.id === activeStep;
          const isComplete = index < activeIndex;
          return (
            <li key={step.id} className="flex items-center gap-2">
              <div
                className={`flex items-center gap-2 rounded-md border px-2.5 py-1.5 ${
                  isActive
                    ? "border-[#006332] bg-[#e8f5ee] text-[#004d27]"
                    : isComplete
                      ? "border-[#006332]/25 bg-white text-[#006332]"
                      : "border-gray-200 bg-white text-[#6b6b6b]"
                }`}
              >
                <span
                  className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold ${
                    isActive
                      ? "bg-[#006332] text-white"
                      : isComplete
                        ? "bg-[#006332]/10 text-[#006332]"
                        : "bg-gray-100 text-[#6b6b6b]"
                  }`}
                >
                  {index + 1}
                </span>
                <span className="text-xs font-semibold">{step.label}</span>
                {isActive && (
                  <span className="hidden text-[11px] text-[#494949] sm:inline">
                    {step.detail}
                  </span>
                )}
              </div>
              {index < PATHWAY_STEPS.length - 1 && (
                <div className="h-px w-4 bg-gray-200" aria-hidden="true" />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

const HEART_COMPONENT_NAMES: Record<string, string> = {
  history: "History",
  ekg: "EKG",
  age: "Age",
  risk_factors: "Risk Factors",
  troponin: "Troponin",
};

const HEART_RISK_COLORS: Record<string, { accent: string; bg: string; text: string }> = {
  Low: { accent: "bg-emerald-500", bg: "bg-emerald-50", text: "text-emerald-700" },
  Moderate: { accent: "bg-amber-500", bg: "bg-amber-50", text: "text-amber-700" },
  High: { accent: "bg-red-500", bg: "bg-red-50", text: "text-red-700" },
};

function HeartScoreCard({ data }: { data: Record<string, unknown> }) {
  const components = data.components as Record<string, number> | undefined;
  const labels = data.labels as Record<string, string> | undefined;
  const total = typeof data.total === "number" ? data.total : 0;
  const risk_level = str(data.risk_level) ?? "Moderate";
  const footnote = str(data.footnote);
  const message = str(data.message);
  const colors = HEART_RISK_COLORS[risk_level] ?? HEART_RISK_COLORS.Moderate;

  if (!components || !labels) {
    return message ? (
      <div className="my-1.5 rounded-md bg-[#e8f5ee] border border-[#006332]/15 px-3 py-2 text-sm">
        <div className="font-mono text-xs text-[#353535]">{message}</div>
      </div>
    ) : null;
  }

  return (
    <div className="my-2 rounded-lg border border-gray-200 bg-white shadow-sm overflow-hidden">
      <div className={`px-3 py-2 flex items-center justify-between ${colors.bg}`}>
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold uppercase tracking-wide text-[#353535]">
            HEART Score
          </span>
          <span className={`text-xs font-semibold ${colors.text}`}>
            {risk_level} Risk
          </span>
        </div>
        <div className={`rounded-full px-2.5 py-0.5 text-sm font-bold ${colors.text} ${colors.bg} border ${
          risk_level === "Low" ? "border-emerald-200" : risk_level === "High" ? "border-red-200" : "border-amber-200"
        }`}>
          {total}/10
        </div>
      </div>
      <div className="divide-y divide-gray-100">
        {["history", "ekg", "age", "risk_factors", "troponin"].map((key) => {
          const score = components[key] ?? 0;
          return (
            <div key={key} className="flex items-center gap-3 px-3 py-2">
              <div className="w-24 shrink-0">
                <div className="text-xs font-semibold text-[#353535]">
                  {HEART_COMPONENT_NAMES[key]}
                </div>
              </div>
              <div className="flex gap-1">
                {[0, 1, 2].map((level) => (
                  <div
                    key={level}
                    className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                      level === score
                        ? `${colors.accent} text-white`
                        : "bg-gray-100 text-gray-400"
                    }`}
                  >
                    {level}
                  </div>
                ))}
              </div>
              <div className="flex-1 min-w-0 text-xs text-[#494949] truncate">
                {labels[key]}
              </div>
            </div>
          );
        })}
      </div>
      {footnote && (
        <div className="px-3 py-1.5 border-t border-gray-100 text-xs text-[#494949] italic">
          {footnote}
        </div>
      )}
    </div>
  );
}

function ToolResult({ part }: { part: ToolPart }) {
  const data = part.output;
  if (!data) return null;

  if (data.risk || data.action === "STEMI_PATHWAY") {
    return <RiskCard data={data} />;
  }

  if (part.type === "tool-calculate_heart_score" && data.components) {
    return <HeartScoreCard data={data} />;
  }

  const message = str(data.message);
  const footnote = str(data.footnote);
  const footnotes = isStringArray(data.footnotes) ? data.footnotes : undefined;

  if (!message) return null;

  return (
    <div className="my-1.5 rounded-md bg-[#e8f5ee] border border-[#006332]/15 px-3 py-2 text-sm">
      <div className="font-mono text-xs text-[#353535]">{message}</div>
      {(footnote ?? (footnotes && footnotes.length > 0)) && (
        <div className="text-xs text-[#494949] mt-1 italic">
          {footnote ?? footnotes?.join(" ")}
        </div>
      )}
    </div>
  );
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function Chat() {
  const [input, setInput] = useState("");
  const [showPathway, setShowPathway] = useState(false);
  const [pendingImage, setPendingImage] = useState<{ url: string; name: string; mediaType: string } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { messages, sendMessage, status } = useChat();
  const isLoading = status === "streaming" || status === "submitted";
  const latestAssistantMessage = [...messages]
    .reverse()
    .find((msg) => msg.role === "assistant");
  const latestAssistantText = latestAssistantMessage
    ? getMessageText(latestAssistantMessage)
    : "";
  const activeStep = getPathwayStep(latestAssistantText);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const handleImageSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) return;
    if (file.size > MAX_IMAGE_BYTES) {
      alert("Image must be under 1 MB. Please crop or compress the ECG image.");
      return;
    }
    try {
      const url = await fileToDataUrl(file);
      setPendingImage({ url, name: file.name, mediaType: file.type });
    } catch {
      alert("Could not read the image file. Please try again.");
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text && !pendingImage) return;
    if (isLoading) return;

    const files: FileUIPart[] = pendingImage
      ? [{ type: "file", mediaType: pendingImage.mediaType, url: pendingImage.url, filename: pendingImage.name }]
      : [];

    sendMessage({ text: text || "Please review this ECG image.", files });
    setInput("");
    setPendingImage(null);
  }, [input, pendingImage, isLoading, sendMessage]);

  return (
    <div className="flex flex-col h-dvh bg-[#f7f7f7]">
      {/* Header */}
      <header className="bg-[#006332] text-white px-4 py-3 flex items-center gap-3 shrink-0 shadow-sm">
        <div className="w-9 h-9 rounded-lg bg-white/20 flex items-center justify-center text-sm font-bold tracking-tight">
          R
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-[15px] font-semibold leading-tight tracking-tight">
            Chest Pain CDS
          </h1>
          <p className="text-[11px] text-white/70 tracking-wide">
            hs-TnI Pathway &mdash; Rush University System for Health
          </p>
        </div>
        <button
          onClick={() => setShowPathway((p) => !p)}
          className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all ${
            showPathway
              ? "bg-white text-[#006332] shadow-sm"
              : "bg-white/15 text-white hover:bg-white/25"
          }`}
        >
          {showPathway ? "Hide Pathway" : "View Pathway"}
        </button>
      </header>

      {/* Gold accent line */}
      <div className="h-[3px] bg-[#c8902e] shrink-0" />

      <PathwayRail activeStep={activeStep} />

      {/* Collapsible pathway reference */}
      {showPathway && (
        <div className="border-b border-gray-200 bg-white overflow-auto max-h-[50vh] shrink-0">
          <Image
            src="/troponin-pathway.png"
            alt="Rush High Sensitivity Troponin I Algorithm"
            width={837}
            height={647}
            priority
            className="w-full min-w-[700px] p-2"
          />
        </div>
      )}

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {messages.length === 0 && (
          <div className="text-center mt-12 space-y-4">
            <div className="w-14 h-14 rounded-2xl bg-[#006332]/10 flex items-center justify-center mx-auto">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#006332" strokeWidth="1.5">
                <path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z" />
                <path d="M12 8v4l2 2" />
              </svg>
            </div>
            <p className="text-sm text-[#494949] font-medium">
              Ready to guide you through the hs-TnI pathway.
            </p>
            <p className="text-xs text-[#494949]/60">
              Type &ldquo;start&rdquo; or describe your patient&rsquo;s EKG findings.
            </p>
            <div className="flex flex-wrap justify-center gap-2 pt-1">
              <button
                type="button"
                onClick={() => sendMessage({ text: "Start the Rush hs-TnI pathway." })}
                disabled={isLoading}
                className="rounded-md bg-[#006332] px-4 py-2 text-xs font-semibold text-white hover:bg-[#004d27] disabled:opacity-40"
              >
                Start pathway
              </button>
              <button
                type="button"
                onClick={() => sendMessage({ text: "No STEMI. No ischemic ST or T-wave changes." })}
                disabled={isLoading}
                className="rounded-md border border-[#006332] bg-white px-4 py-2 text-xs font-semibold text-[#006332] hover:bg-[#e8f5ee] disabled:opacity-40"
              >
                No STEMI or ischemic changes
              </button>
            </div>
          </div>
        )}
        {messages.map((msg) => {
          return (
            <div
              key={msg.id}
              className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
            <div
              className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-[14px] leading-relaxed ${
                msg.role === "user"
                  ? "bg-[#006332] text-white"
                  : "bg-white text-[#353535] shadow-sm border border-gray-100"
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
                if (
                  part.type === "file" &&
                  "mediaType" in part &&
                  typeof part.mediaType === "string" &&
                  part.mediaType.startsWith("image/")
                ) {
                  return (
                    <Image
                      key={`${msg.id}-${i}`}
                      src={(part as FileUIPart).url}
                      alt="ECG upload"
                      width={640}
                      height={480}
                      unoptimized
                      className="rounded-lg max-w-full h-auto mt-1 mb-1"
                    />
                  );
                }
                if (part.type === "tool-suggest_followups") {
                  const tp = part as ToolPart;
                  const opts = tp.output?.options;
                  if (!Array.isArray(opts) || opts.length === 0) return null;
                  const lastText = [...msg.parts]
                    .slice(0, i)
                    .filter((p) => p.type === "text")
                    .pop();
                  const questionText = lastText && "text" in lastText ? lastText.text : "";
                  const replyOptions = normalizeQuickReplyOptions(
                    questionText,
                    opts as string[]
                  );
                  const isLast = msg.id === messages[messages.length - 1]?.id;
                  return (
                    <div key={`${msg.id}-${i}`} className="flex flex-wrap gap-2 mt-2">
                      {replyOptions.map((opt) => (
                        <button
                          key={opt}
                          disabled={!isLast || isLoading}
                          onClick={() => {
                            if (!isLast || isLoading) return;
                            sendMessage({ text: opt });
                          }}
                          className={`px-3 py-1.5 text-xs font-medium rounded-full border transition-all ${
                            isLast && !isLoading
                              ? "border-[#006332] text-[#006332] bg-white hover:bg-[#006332] hover:text-white cursor-pointer"
                              : "border-gray-200 text-gray-400 bg-gray-50 cursor-default"
                          }`}
                        >
                          {opt}
                        </button>
                      ))}
                    </div>
                  );
                }
                if (part.type.startsWith("tool-")) {
                  return (
                    <ToolResult
                      key={`${msg.id}-${i}`}
                      part={part as ToolPart}
                    />
                  );
                }
                return null;
              })}
            </div>
          </div>
          );
        })}
        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-white shadow-sm border border-gray-100 rounded-2xl px-4 py-3 flex gap-1.5">
              <span className="w-2 h-2 bg-[#006332]/40 rounded-full animate-bounce" />
              <span className="w-2 h-2 bg-[#006332]/40 rounded-full animate-bounce [animation-delay:150ms]" />
              <span className="w-2 h-2 bg-[#006332]/40 rounded-full animate-bounce [animation-delay:300ms]" />
            </div>
          </div>
        )}
      </div>

      {/* Disclaimer */}
      <div className="px-4 py-1.5 text-center border-t border-gray-100">
        <p className="text-[10px] text-[#494949]/50 tracking-wide">
          Decision support tool only. Final clinical judgment rests with the
          treating physician.
        </p>
      </div>

      {/* Image preview */}
      {pendingImage && (
        <div className="px-4 py-2 bg-white border-t border-gray-100 flex items-center gap-3">
          <Image
            src={pendingImage.url}
            alt="ECG preview"
            width={128}
            height={64}
            unoptimized
            className="h-16 w-auto rounded-md border border-gray-200"
          />
          <div className="flex-1 min-w-0">
            <p className="text-xs text-[#353535] font-medium truncate">{pendingImage.name}</p>
            <p className="text-[10px] text-[#494949]/60">ECG image attached — AI will provide a preliminary read for your review</p>
          </div>
          <button
            onClick={() => setPendingImage(null)}
            className="text-[#494949]/40 hover:text-red-500 transition-colors"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* Input */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleSend();
        }}
        className="px-4 pb-4 pt-1 bg-white border-t border-gray-100"
      >
        <div className="flex items-center gap-2 bg-[#f7f7f7] border border-gray-200 rounded-xl px-3 py-2.5 focus-within:border-[#006332]/40 focus-within:ring-1 focus-within:ring-[#006332]/20 transition-all">
          <input
            type="file"
            ref={fileInputRef}
            accept="image/*"
            className="hidden"
            onChange={handleImageSelect}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isLoading}
            className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-[#494949]/50 hover:text-[#006332] hover:bg-[#006332]/5 disabled:opacity-30 transition-colors"
            title="Upload ECG image"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
            </svg>
          </button>
          <input
            className="flex-1 bg-transparent outline-none text-[14px] text-[#353535] placeholder:text-[#494949]/40"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={pendingImage ? "Add a note about this ECG (optional)..." : "Describe findings or answer the question..."}
            disabled={isLoading}
          />
          <button
            type="submit"
            disabled={(!input.trim() && !pendingImage) || isLoading}
            className="shrink-0 w-9 h-9 rounded-lg bg-[#006332] text-white flex items-center justify-center disabled:opacity-30 hover:bg-[#004d27] transition-colors"
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
