"use client";

import { useChat } from "@ai-sdk/react";
import { lastAssistantMessageIsCompleteWithApprovalResponses } from "ai";
import { useEffect, useRef, useState } from "react";
import {
  Conversation,
  ConversationContent,
} from "@/components/ai-elements/conversation";
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
} from "@/components/ai-elements/prompt-input";
import { Spinner } from "@/components/ui/spinner";

type ToolPart = {
  type: string;
  state?: string;
  toolCallId?: string;
  toolName?: string;
  output?: unknown;
  input?: unknown;
  approval?: {
    id: string;
  };
};

type ToolLink = {
  key: string;
  label: string;
  url: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isToolPart(part: { type: string }): part is ToolPart {
  return part.type.startsWith("tool-") || part.type === "dynamic-tool";
}

function getToolName(part: ToolPart): string {
  if (part.type === "dynamic-tool") {
    return part.toolName || "tool";
  }

  if (part.type.startsWith("tool-")) {
    return part.type.slice(5);
  }

  return "tool";
}

function getToolStatus(part: ToolPart): string {
  if (part.state === "output-available" && isRecord(part.output)) {
    if (part.output.authorization_required) {
      return "Authorization required";
    }
    return "Done";
  }

  switch (part.state) {
    case "input-streaming":
      return "Preparing";
    case "input-available":
      return "Queued";
    case "approval-requested":
      return "Needs approval";
    case "approval-responded":
      return "Approval recorded";
    case "output-denied":
      return "Denied";
    case "output-error":
      return "Failed";
    default:
      return "Pending";
  }
}

function getStringAtPath(
  value: unknown,
  path: readonly string[]
): string | null {
  let current: unknown = value;

  for (const segment of path) {
    if (!isRecord(current)) {
      return null;
    }
    current = current[segment];
  }

  return typeof current === "string" ? current : null;
}

function getToolLinks(parts: ToolPart[]): ToolLink[] {
  const links: ToolLink[] = [];

  for (const part of parts) {
    if (part.state !== "output-available") {
      continue;
    }

    const toolName = getToolName(part);

    if (toolName === "GoogleSheets_GenerateGoogleFilePickerUrl") {
      const pickerUrl =
        getStringAtPath(part.output, ["output", "value", "url"]) ??
        getStringAtPath(part.output, ["url"]);

      if (pickerUrl) {
        links.push({
          key: `${toolName}:${pickerUrl}`,
          label: "Open Google Drive File Picker",
          url: pickerUrl,
        });
      }
    }
  }

  return Array.from(new Map(links.map((link) => [link.key, link])).values());
}

function AuthPendingUI({
  authUrl,
  toolName,
  authorizationId,
  onAuthComplete,
}: {
  authUrl: string;
  toolName: string;
  authorizationId: string;
  onAuthComplete: () => void;
}) {
  const [status, setStatus] = useState<"initial" | "waiting" | "completed">(
    "initial"
  );
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasCompletedRef = useRef(false);
  const onAuthCompleteRef = useRef(onAuthComplete);

  useEffect(() => {
    onAuthCompleteRef.current = onAuthComplete;
  }, [onAuthComplete]);

  useEffect(() => {
    if (
      status !== "waiting" ||
      !authorizationId ||
      hasCompletedRef.current
    ) {
      return;
    }

    const pollStatus = async () => {
      try {
        const res = await fetch("/api/auth/status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ authorizationId }),
        });

        const data = (await res.json()) as { status?: string };

        if (data.status === "completed" && !hasCompletedRef.current) {
          hasCompletedRef.current = true;
          if (pollingRef.current) {
            clearInterval(pollingRef.current);
          }
          setStatus("completed");
          timeoutRef.current = setTimeout(
            () => onAuthCompleteRef.current(),
            1500
          );
        }
      } catch (error) {
        console.error("Polling error:", error);
      }
    };

    pollingRef.current = setInterval(pollStatus, 2000);
    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
      }
    };
  }, [authorizationId, status]);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const displayName = toolName.split("_")[0] || toolName;

  const handleAuthClick = () => {
    if (!authUrl) {
      return;
    }

    window.open(authUrl, "_blank");
    setStatus("waiting");
  };

  return (
    <div className="mt-2 rounded border border-zinc-700/60 bg-zinc-900/40 p-3 text-sm">
      {status === "completed" ? (
        <p className="text-green-400">{displayName} authorized</p>
      ) : !authUrl ? (
        <p className="text-red-400">Authorization URL not available</p>
      ) : (
        <>
          Give Arcade Chat access to {displayName}?{" "}
          <button
            onClick={handleAuthClick}
            className="ml-2 rounded bg-teal-600 px-2 py-1 text-sm hover:bg-teal-500"
          >
            {status === "waiting" ? "Retry authorizing" : "Authorize now"}
          </button>
        </>
      )}
    </div>
  );
}

function ToolLinksUI({ links }: { links: ToolLink[] }) {
  if (links.length === 0) {
    return null;
  }

  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {links.map((link) => (
        <a
          key={link.key}
          href={link.url}
          target="_blank"
          rel="noreferrer"
          className="rounded bg-blue-700 px-2 py-1 text-xs font-medium text-white hover:bg-blue-600"
        >
          {link.label}
        </a>
      ))}
    </div>
  );
}

function ToolApprovalUI({
  toolName,
  input,
  onApprove,
  onDeny,
}: {
  toolName: string;
  input: unknown;
  onApprove: () => void;
  onDeny: () => void;
}) {
  return (
    <div className="mt-2 rounded border border-amber-500/50 bg-amber-950/30 p-3 text-sm">
      <p className="font-medium text-amber-200">Approval required: {toolName}</p>
      <p className="mt-1 text-zinc-300">Approve this tool action?</p>
      {input !== undefined ? (
        <pre className="mt-2 overflow-x-auto rounded bg-zinc-950/70 p-2 text-xs text-zinc-300">
          {JSON.stringify(input, null, 2)}
        </pre>
      ) : null}
      <div className="mt-3 flex gap-2">
        <button
          onClick={onApprove}
          className="rounded bg-green-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-600"
        >
          Approve
        </button>
        <button
          onClick={onDeny}
          className="rounded bg-zinc-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-600"
        >
          Deny
        </button>
      </div>
    </div>
  );
}

function ToolTrace({ parts }: { parts: ToolPart[] }) {
  if (parts.length === 0) {
    return null;
  }

  return (
    <div className="mt-3 space-y-1 text-xs text-zinc-400">
      {parts.map((part, index) => (
        <div
          key={`${part.toolCallId || part.type}-${index}`}
          className="flex items-center gap-2"
        >
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-zinc-300">
            {getToolName(part)}
          </span>
          <span>{getToolStatus(part)}</span>
        </div>
      ))}
    </div>
  );
}

export default function Chat() {
  const { messages, regenerate, sendMessage, addToolApprovalResponse, status } =
    useChat({
      sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
    });

  const [sessionStatus, setSessionStatus] = useState<
    "loading" | "ready" | "error"
  >("loading");
  const [sessionError, setSessionError] = useState("");

  const isLoading = status === "submitted" || status === "streaming";
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let active = true;

    const initializeSession = async () => {
      try {
        const response = await fetch("/api/session", { method: "POST" });
        if (!response.ok) {
          throw new Error(`Session initialization failed (${response.status})`);
        }

        if (active) {
          setSessionStatus("ready");
        }
      } catch (error) {
        if (active) {
          setSessionStatus("error");
          setSessionError(
            error instanceof Error ? error.message : "Session initialization failed"
          );
        }
      }
    };

    initializeSession();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!isLoading && sessionStatus === "ready" && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isLoading, sessionStatus]);

  const inputDisabled = isLoading || sessionStatus !== "ready";

  return (
    <div className="mx-auto flex h-screen max-w-2xl flex-col">
      <Conversation className="flex-1">
        <ConversationContent>
          {messages.map((message) => {
            const toolParts = (message.parts || []).filter((part) =>
              isToolPart(part)
            );

            const authPart = toolParts.find((part) => {
              if (part.state !== "output-available" || !isRecord(part.output)) {
                return false;
              }

              return Boolean(part.output.authorization_required);
            });

            const approvalParts = toolParts.filter(
              (part) =>
                part.state === "approval-requested" &&
                Boolean(part.approval?.id)
            );
            const toolLinks = getToolLinks(toolParts);

            const textContent = (message.parts || [])
              .map((part) => {
                if (part.type === "text" && "text" in part) {
                  return part.text;
                }
                return "";
              })
              .join("");

            if (
              !textContent &&
              !authPart &&
              approvalParts.length === 0 &&
              toolParts.length === 0 &&
              !(message.role === "assistant" && isLoading)
            ) {
              return null;
            }

            const authOutput = authPart?.output;
            const authPayload = isRecord(authOutput) ? authOutput : null;
            const authResponse = isRecord(authPayload?.authorization_response)
              ? authPayload.authorization_response
              : null;
            const authUrl =
              authResponse && typeof authResponse.url === "string"
                ? authResponse.url
                : "";
            const authorizationId =
              authResponse && typeof authResponse.id === "string"
                ? authResponse.id
                : "";

            return (
              <Message key={message.id} from={message.role}>
                <MessageContent>
                  {message.role === "assistant" &&
                  !textContent &&
                  !authPart &&
                  approvalParts.length === 0 &&
                  toolParts.length === 0 &&
                  isLoading ? (
                    <Spinner />
                  ) : (
                    <>
                      {textContent ? (
                        <MessageResponse>{textContent}</MessageResponse>
                      ) : null}

                      {authPart ? (
                        <AuthPendingUI
                          authUrl={authUrl}
                          toolName={getToolName(authPart)}
                          authorizationId={authorizationId}
                          onAuthComplete={() => regenerate()}
                        />
                      ) : null}

                      {approvalParts.map((part) => {
                        const approvalId = part.approval?.id;
                        if (!approvalId) {
                          return null;
                        }

                        return (
                          <ToolApprovalUI
                            key={part.toolCallId || approvalId}
                            toolName={getToolName(part)}
                            input={part.input}
                            onApprove={() =>
                              addToolApprovalResponse({
                                id: approvalId,
                                approved: true,
                              })
                            }
                            onDeny={() =>
                              addToolApprovalResponse({
                                id: approvalId,
                                approved: false,
                                reason: "Denied by user",
                              })
                            }
                          />
                        );
                      })}

                      <ToolLinksUI links={toolLinks} />

                      <ToolTrace parts={toolParts} />
                    </>
                  )}
                </MessageContent>
              </Message>
            );
          })}
        </ConversationContent>
      </Conversation>

      <div className="p-4">
        {sessionStatus === "error" ? (
          <p className="mb-2 text-sm text-red-400">{sessionError}</p>
        ) : null}

        <PromptInput
          onSubmit={({ text }) => {
            if (!text.trim() || sessionStatus !== "ready") {
              return;
            }

            sendMessage({ text });
          }}
        >
          <PromptInputTextarea
            ref={inputRef}
            placeholder={
              sessionStatus === "loading"
                ? "Initializing session..."
                : "Ask for today's AE actions, deal risks, or outreach plan..."
            }
            disabled={inputDisabled}
          />
          <PromptInputFooter>
            <div />
            <PromptInputSubmit status={status} disabled={inputDisabled} />
          </PromptInputFooter>
        </PromptInput>
      </div>
    </div>
  );
}
