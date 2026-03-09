# Customizable Chatbot

A full-stack, retrieval-augmented chatbot with:
- A NestJS backend for auth, document ingestion, vector search, and chat orchestration
- A Next.js frontend using Socket.IO for real-time, streamed responses
- PostgreSQL + pgvector for semantic search over uploaded documents

## Table of Contents

- Overview
- Architecture
- Features
- Tech Stack
- Repository Structure
- Prerequisites
- Environment Variables
- Quick Start
- Development Workflow
- API and Socket Contracts
- Data Model
- Security Notes
- Troubleshooting

## Overview

This project lets you upload documents, index them as vector embeddings, and ask questions against that knowledge base. The backend performs retrieval and prompts a local LLM endpoint, then streams generated text to the frontend over WebSockets in a ChatGPT-style incremental output flow.

## Architecture

1. User sends a chat message from the frontend via Socket.IO (`chat` event).
2. Backend creates or reuses a chat session.
3. Backend embeds the user message and runs vector similarity search on stored document chunks.
4. Backend builds a context-aware prompt using:
- Prior conversation history
- Top retrieved chunks
5. Backend calls the LLM generation endpoint with streaming enabled.
6. Backend emits stream lifecycle events:
- `chat-start`
- `chat-chunk`
- `chat-end`
- `chat-error`
7. Frontend appends incoming chunks to the response panel in real time.

## Features

- JWT-based authentication
- Role-protected document management endpoints (`ADMIN`)
- Document ingestion pipeline (PDF, HTML, Markdown, TXT)
- RAG-like answer generation with citations metadata
- Persistent chat sessions and chat history in PostgreSQL
- Socket-based streaming responses for low-latency UX
- Swagger docs at `/api`

## Tech Stack

Backend (`back`):
- NestJS 11
- Prisma + PostgreSQL adapter (`@prisma/adapter-pg`)
- pgvector extension
- Socket.IO (Nest WebSocket gateway)
- Axios (LLM HTTP integration)

Frontend (`front`):
- Next.js 16 (App Router)
- React 19
- Socket.IO client

Infrastructure:
- Docker Compose (Postgres + pgvector image)

## Repository Structure

```text
Customizable_Chatbot/
  back/    # NestJS API, websocket gateway, Prisma schema/migrations
  front/   # Next.js UI and socket client
```

## Prerequisites

- Node.js 20+
- npm (backend)
- pnpm (frontend)
- Docker + Docker Compose
- A running LLM generation server compatible with `POST /api/generate` stream format

## Environment Variables

### Backend (`back/.env`)

```dotenv
DATABASE_URL="postgresql://chatbot_user:chatbot_pass@localhost:5432/chatbot?schema=public"
SHADOW_DATABASE_URL="postgresql://chatbot_user:chatbot_pass@localhost:5432/chatbot_shadow?schema=public"
PORT=5000
```

### Frontend (`front/.env.local`)

```dotenv
NEXT_PUBLIC_BACKEND_URL="http://localhost:5000"
```

## Quick Start

### 1. Start database

```bash
cd back
docker compose up -d
```

### 2. Install backend dependencies

```bash
cd back
npm install
```

### 3. Run Prisma migration and generate client

```bash
cd back
npx prisma generate --schema src/prisma/schema.prisma
npx prisma migrate dev --schema src/prisma/schema.prisma
```

### 4. Start backend

```bash
cd back
npm run start:dev
```

The backend seeds a default admin user on startup:
- Email: `admin@gmail.com`
- Password: `admin123`

Swagger UI:
- `http://localhost:5000/api`

### 5. Install frontend dependencies

```bash
cd front
pnpm install
```

### 6. Start frontend

```bash
cd front
pnpm dev
```

Frontend app:
- `http://localhost:3000`

## Development Workflow

Backend commands:

```bash
cd back
npm run start:dev
npm run build
npm run test
npm run test:e2e
npm run lint
```

Frontend commands:

```bash
cd front
pnpm dev
pnpm build
pnpm lint
```

## API and Socket Contracts

### REST endpoints

Authentication:
- `POST /auth/login`

Chat:
- `POST /chat/session`
- `POST /chat/message`

Documents (JWT + ADMIN):
- `POST /documents/upload`
- `GET /documents`
- `GET /documents/:id`
- `GET /documents/:id/chunks`
- `DELETE /documents/:id`

### Socket events

Client emits:
- `chat` payload:

```json
{
  "sessionToken": "optional-session-token",
  "message": "Your question"
}
```

Server emits:
- `chat-start` payload:

```json
{
  "sessionToken": "existing-or-new-token"
}
```

- `chat-chunk` payload:

```json
{
  "chunk": "partial generated text"
}
```

- `chat-end` payload:

```json
{
  "sessionToken": "session-token",
  "reply": "final assembled reply",
  "citations": [
    { "documentId": "...", "chunkId": "...", "score": 0.123 }
  ]
}
```

- `chat-error` payload:

```json
{
  "message": "error details"
}
```

Legacy compatibility event:
- `chat-response` (final response payload)

## Data Model

Core tables:
- `User`
- `Document`
- `DocumentChunk` (includes `vector(768)` embedding)
- `ChatSession`
- `ChatMessage`
- `ChatCitation`

Prisma schema path:
- `back/src/prisma/schema.prisma`

## Security Notes

- JWT secret is currently hardcoded in `back/src/auth/constants.ts` and should be moved to environment variables before production use.
- Document endpoints are protected by JWT and role guards, but chat endpoints are currently marked public.
- CORS is open (`origin: '*'`) in the WebSocket gateway; tighten this for production.

## Troubleshooting

- `next: not found` when building frontend:
  - Run `pnpm install` in `front` first.
- Prisma cannot connect to DB:
  - Ensure Docker Postgres is running and `DATABASE_URL` is correct.
- Missing pgvector extension behavior:
  - Use the provided `ankane/pgvector` image from `back/docker-compose.yml`.
- Socket connects but no streamed chunks:
  - Confirm backend can reach the configured LLM generation endpoint at `http://localhost:11434/api/generate`.

## License

This repository currently has no explicit top-level license file. Add a `LICENSE` file if you plan to distribute the project.
