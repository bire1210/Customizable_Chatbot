"use client";

import { useEffect, useState } from "react";

// socket.io-client will need to be installed (npm install socket.io-client)
import { io, Socket } from "socket.io-client";

export default function Home() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [status, setStatus] = useState("disconnected");
  const [logs, setLogs] = useState<string[]>([]);
  const [prompt, setPrompt] = useState("hello from frontend");
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [responseText, setResponseText] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);

  useEffect(() => {
    const s = io(
      process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:5000",
      {
        transports: ["websocket"],
        autoConnect: true,
      },
    );

    function log(msg: string) {
      setLogs((prev) => [...prev, msg]);
    }

    s.on("connect", () => {
      setStatus("connected");
      log(`connected (${s.id})`);
    });

    s.on("disconnect", (reason: string) => {
      setStatus("disconnected");
      log(`disconnected: ${reason}`);
    });

    s.on("connect_error", (err: Error) => {
      log(`connect_error: ${err.message}`);
    });

    s.on("chat-start", (payload: { sessionToken?: string | null }) => {
      setIsStreaming(true);
      setResponseText("");
      if (payload?.sessionToken) {
        setSessionToken(payload.sessionToken);
      }
      log("chat-start received");
    });

    s.on("chat-chunk", (payload: { chunk?: string }) => {
      const chunk = payload?.chunk ?? "";
      if (!chunk) return;

      // Append exactly what is streamed by backend for ChatGPT-like typing effect.
      setResponseText((prev) => prev + chunk);
    });

    s.on("chat-end", (payload: any) => {
      setIsStreaming(false);
      if (payload?.sessionToken) {
        setSessionToken(payload.sessionToken);
      }
      if (typeof payload?.reply === "string") {
        setResponseText(payload.reply);
      }
      log(`chat-end received (len=${payload?.reply?.length ?? 0})`);
    });

    s.on("chat-error", (payload: { message?: string }) => {
      setIsStreaming(false);
      log(`chat-error: ${payload?.message ?? "Unknown error"}`);
    });

    s.on("chat-response", (payload: any) => {
      log(`chat-response (legacy) received: ${JSON.stringify(payload)}`);
    });

    setSocket(s);

    return () => {
      s.close();
    };
  }, []);

  const sendMessage = () => {
    if (!socket || !prompt.trim() || isStreaming) return;
    const text = prompt.trim();
    log(`sending chat: ${text}`);
    socket.emit("chat", { sessionToken, message: text });
  };

  function log(msg: string) {
    setLogs((prev) => [...prev, msg]);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 font-sans">
      <main className="flex min-h-screen w-full max-w-4xl flex-col py-10 px-6 sm:px-10">
        <h1 className="text-2xl font-semibold text-zinc-900">Customizable Chatbot</h1>

        <div className="mt-3 text-sm text-zinc-700">Socket status: {status}</div>
        <div className="text-xs text-zinc-500 break-all">
          Session: {sessionToken ?? "(new session will be created on first message)"}
        </div>

        <div className="mt-5 flex gap-2">
          <input
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            className="flex-1 rounded border border-zinc-300 px-3 py-2 text-sm"
            placeholder="Type your message"
          />
          <button
            onClick={sendMessage}
            disabled={!socket || isStreaming || !prompt.trim()}
            className="rounded bg-blue-600 px-4 py-2 text-sm text-white disabled:cursor-not-allowed disabled:bg-blue-300"
          >
            {isStreaming ? "Streaming..." : "Send"}
          </button>
        </div>

        <section className="mt-6 rounded border border-zinc-200 bg-white p-4">
          <h2 className="text-sm font-medium text-zinc-700">Response</h2>
          <div className="mt-2 min-h-40 whitespace-pre-wrap rounded bg-zinc-50 p-3 text-sm text-zinc-900">
            {responseText || (isStreaming ? "Receiving response..." : "No response yet")}
          </div>
        </section>

        <section className="mt-6 rounded border border-zinc-200 bg-white p-4">
          <h2 className="text-sm font-medium text-zinc-700">Socket Logs</h2>
          <div className="mt-2 max-h-56 overflow-auto rounded bg-gray-100 p-2">
            {logs.map((l, i) => (
              <div key={i} className="text-xs">
                {l}
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
