"use client";

import Image from "next/image";
import { useEffect, useState } from "react";

// socket.io-client will need to be installed (npm install socket.io-client)
import { io, Socket } from "socket.io-client";

export default function Home() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [status, setStatus] = useState("disconnected");
  const [logs, setLogs] = useState<string[]>([]);

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

    s.on("chat-response", (payload: any) => {
      log(`chat-response received: ${JSON.stringify(payload)}`);
    });

    setSocket(s);

    return () => {
      s.close();
    };
  }, []);

  const sendMessage = () => {
    if (!socket) return;
    const text = "hello from frontend";
    log(`sending chat: ${text}`);
    socket.emit("chat", text);
  };

  function log(msg: string) {
    setLogs((prev) => [...prev, msg]);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 font-sans dark:bg-black">
      <main className="flex min-h-screen w-full max-w-3xl flex-col items-center justify-between py-32 px-16 bg-white dark:bg-black sm:items-start">
        
        <div className="mt-8">
          <div>Socket status: {status}</div>
          <button
            onClick={sendMessage}
            className="mt-2 rounded bg-blue-600 px-4 py-2 text-white"
          >
            Send Test Chat
          </button>
          <div className="mt-4 max-h-48 w-full overflow-auto bg-gray-100 p-2">
            {logs.map((l, i) => (
              <div key={i} className="text-xs">
                {l}
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
