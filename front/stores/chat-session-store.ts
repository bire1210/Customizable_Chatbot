import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export type ChatCitation = {
  documentId: string;
  chunkId: string;
  score: number;
  distance: number;
  chunkIndex: number;
};

export type PersistedChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  citations?: ChatCitation[];
};

type ChatSessionState = {
  sessionToken: string | null;
  sessionExpiresAt: number | null;
  messages: PersistedChatMessage[];
  setSessionToken: (token: string | null, ttlMs?: number) => void;
  addUserMessage: (text: string) => void;
  addAssistantPlaceholder: () => void;
  appendAssistantChunk: (chunk: string) => void;
  finalizeAssistantMessage: (reply?: string, citations?: ChatCitation[]) => void;
  addAssistantError: (message: string) => void;
  clearMessages: () => void;
  pruneExpiredSession: () => void;
  clearSession: () => void;
};

const DEFAULT_TTL_MS = 1000 * 60 * 60 * 24;

export const useChatSessionStore = create<ChatSessionState>()(
  persist(
    (set) => ({
      sessionToken: null,
      sessionExpiresAt: null,
      messages: [],
      setSessionToken: (token, ttlMs = DEFAULT_TTL_MS) =>
        set({
          sessionToken: token,
          sessionExpiresAt: token ? Date.now() + ttlMs : null,
        }),
      addUserMessage: (text) =>
        set((state) => ({
          messages: [
            ...state.messages,
            {
              id: crypto.randomUUID(),
              role: "user",
              text,
            },
          ],
        })),
      addAssistantPlaceholder: () =>
        set((state) => ({
          messages: [
            ...state.messages,
            {
              id: crypto.randomUUID(),
              role: "assistant",
              text: "",
            },
          ],
        })),
      appendAssistantChunk: (chunk) =>
        set((state) => {
          if (!state.messages.length) return state;

          const last = state.messages[state.messages.length - 1];
          if (last.role !== "assistant") return state;

          const updated = [...state.messages];
          updated[updated.length - 1] = {
            ...last,
            text: `${last.text}${chunk}`,
          };

          return { messages: updated };
        }),
      finalizeAssistantMessage: (reply, citations) =>
        set((state) => {
          if (!state.messages.length) return state;

          const last = state.messages[state.messages.length - 1];
          if (last.role !== "assistant") return state;

          const updated = [...state.messages];
          updated[updated.length - 1] = {
            ...last,
            text: reply ?? last.text,
            citations: citations ?? [],
          };

          return { messages: updated };
        }),
      addAssistantError: (message) =>
        set((state) => ({
          messages: [
            ...state.messages,
            {
              id: crypto.randomUUID(),
              role: "assistant",
              text: `Error: ${message}`,
            },
          ],
        })),
      clearMessages: () => set({ messages: [] }),
      pruneExpiredSession: () =>
        set((state) => {
          if (!state.sessionExpiresAt) return state;
          if (Date.now() <= state.sessionExpiresAt) return state;

          return {
            sessionToken: null,
            sessionExpiresAt: null,
            messages: [],
          };
        }),
      clearSession: () =>
        set({
          sessionToken: null,
          sessionExpiresAt: null,
          messages: [],
        }),
    }),
    {
      name: "chat-session-store",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        sessionToken: state.sessionToken,
        sessionExpiresAt: state.sessionExpiresAt,
        messages: state.messages,
      }),
    },
  ),
);
