## AI Chat (Next.js + Bun + SQLite)

### Setup

- Install dependencies: `bun install`
- Allow native SQLite bindings:
  - `bun pm trust better-sqlite3`
  - `bun install`
- Add the sample workbook:
  - `mkdir data`
  - place `example.xlsx` at `./data/example.xlsx`
- Set your API key in `./.env.local`:
  - `OPENAI_API_KEY=...`

### Bun Commands

- `bun dev` run the dev server
- `bun run build` build for production
- `bun start` start the production server
- `bun lint` lint

### Database Initialization

- SQLite initializes automatically on first request.
- Default DB path: `./data/app.db` (override with `SQLITE_PATH`).

### XLSX Location

- XLSX tools read/write `./data/example.xlsx`.
- The app will error if the file is missing.

### Status

**Fully implemented**
- Chat threads + messages persisted in SQLite.
- Streaming responses via `/api/chat`.
- Thread creation, switching, and deletion.
- XLSX tools: `getRange`, `updateCell` (confirmation-gated), `explainFormula`.

**Partially implemented**
- Generative UI tool rendering (confirm card is wired; other tool UIs are basic).
- Table modal uses sample data (not yet wired to XLSX preview).

**Limitations**
- No auth or multi-user isolation.
- XLSX updates are direct file writes (single-writer expected).
- Tooling is enabled only when prompts include `@Sheet!A1:B3` range references.
