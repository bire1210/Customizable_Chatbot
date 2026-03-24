"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";
import { ChatCitation, useChatSessionStore } from "@/stores/chat-session-store";
import { useToast } from "@/app/components/toast-provider";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:5000";

export default function ChatPage() {
  const toast = useToast();
  const [socket, setSocket] = useState<Socket | null>(null);
  const [status, setStatus] = useState("connecting");
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const sessionToken = useChatSessionStore((state) => state.sessionToken);
  const setSessionToken = useChatSessionStore((state) => state.setSessionToken);
  const messages = useChatSessionStore((state) => state.messages);
  const addUserMessage = useChatSessionStore((state) => state.addUserMessage);
  const addAssistantPlaceholder = useChatSessionStore((state) => state.addAssistantPlaceholder);
  const appendAssistantChunk = useChatSessionStore((state) => state.appendAssistantChunk);
  const finalizeAssistantMessage = useChatSessionStore((state) => state.finalizeAssistantMessage);
  const addAssistantError = useChatSessionStore((state) => state.addAssistantError);
  const pruneExpiredSession = useChatSessionStore((state) => state.pruneExpiredSession);

  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    pruneExpiredSession();
  }, [pruneExpiredSession]);

  useEffect(() => {
    const s = io(BACKEND_URL, {
      transports: ["websocket"],
      autoConnect: true,
    });

    s.on("connect", () => {
      setStatus("connected");
      toast.success("Connected to chat server.", 1800);
    });
    s.on("disconnect", () => {
      setStatus("disconnected");
      toast.warning("Disconnected from chat server.");
    });
    s.on("connect_error", () => {
      setStatus("error");
      toast.error("Could not connect to chat server.");
    });

    s.on("chat-start", (payload: { sessionToken?: string | null }) => {
      setIsStreaming(true);
      if (payload?.sessionToken) {
        setSessionToken(payload.sessionToken);
      }

      addAssistantPlaceholder();
    });

    s.on("chat-chunk", (payload: { chunk?: string }) => {
      const chunk = payload?.chunk ?? "";
      if (!chunk) return;

      appendAssistantChunk(chunk);
    });

    s.on("chat-end", (payload: { sessionToken?: string; reply?: string; citations?: ChatCitation[] }) => {
      setIsStreaming(false);
      if (payload?.sessionToken) {
        setSessionToken(payload.sessionToken);
      }

      finalizeAssistantMessage(payload?.reply, payload?.citations ?? []);
    });

    s.on("chat-error", (payload: { message?: string }) => {
      setIsStreaming(false);
      const message = payload?.message ?? "Unknown streaming error";
      addAssistantError(message);
      toast.error(message);
    });

    setSocket(s);

    return () => {
      s.close();
    };
  }, [
    addAssistantError,
    addAssistantPlaceholder,
    appendAssistantChunk,
    finalizeAssistantMessage,
    setSessionToken,
  ]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!socket || isStreaming || !input.trim()) {
      if (!socket) {
        toast.warning("Socket is not connected yet.");
      }
      return;
    }

    const text = input.trim();
    setInput("");
    addUserMessage(text);

    socket.emit("chat", {
      sessionToken,
      message: text,
    });
  }

  return (
    <div className="chat-shell">
      <aside className="chat-sidebar">
        <h1>Customizable Chatbot</h1>
        <p>Open chat for everyone</p>
        <p>Status: {status}</p>
        <p className="session-text">Session: {sessionToken ?? "new"}</p>
        <a href="/login" className="panel-link">Admin login</a>
      </aside>

      <main className="chat-main">
        <div className="chat-messages" ref={listRef}>
          {messages.length === 0 ? (
            <div className="chat-empty">Ask anything from your uploaded knowledge base.</div>
          ) : (
            messages.map((message) => (
              <div key={message.id} className={`msg ${message.role}`}>
                <div className="msg-role">{message.role === "user" ? "You" : "Assistant"}</div>
                <div className="msg-text">{message.text || (isStreaming && message.role === "assistant" ? "..." : "")}</div>
                {message.role === "assistant" && message.citations && message.citations.length > 0 ? (
                  <div className="citations">
                    {message.citations.map((c) => (
                      <span key={c.chunkId}>
                        doc {c.documentId.slice(0, 8)} | score {(c.score * 100).toFixed(1)}%
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            ))
          )}
        </div>

        <form className="chat-input" onSubmit={onSubmit}>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Message your assistant"
          />
          <button
            type="submit"
            disabled={!socket || isStreaming || !input.trim()}
            className={isStreaming ? "btn-loading" : undefined}
          >
            {isStreaming ? (
              <>
                <span className="btn-spinner" aria-hidden="true" />
                Sending...
              </>
            ) : (
              "Send"
            )}
          </button>
        </form>
      </main>
    </div>
  );
}
