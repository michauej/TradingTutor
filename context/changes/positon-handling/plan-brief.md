# Session Persistence (Interface + JSON) — Plan Brief

> Full plan: `context/changes/positon-handling/plan.md`

## What & Why

Learners need to keep paper-trading sessions after they leave and reopen them later for review. This change adds a storage-agnostic `ISessionRepository` (Create upsert / Get / List), a JSON-file implementation, and UI to **Start session**, **Save**, and **Load session** into Diary read-only. Azure Table is deferred but the interface is designed so it can plug in later.

## Starting Point

Sim positions/trades live only in React `SessionContext`. Candle packs already use `ICandlePackRepository` + JSON on disk — that is the pattern to copy. Pre-play setup currently sits on the trading Dashboard until first Play locks the session.

## Desired End State

From a session entry screen the learner starts a new sim or loads a past session into Diary. During a live sim, Save writes a full snapshot; saving again overwrites the same session id. Sessions are listed and fetched via API backed by JSON files behind `ISessionRepository`.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
| -------- | ------ | ---------------- |
| Snapshot contents | Full sim state + candle refs | Enough to review later without embedding OHLC |
| Save trigger | Explicit Save; overwrite same id | User controls archive; one slot per live session |
| Interface writes | Create upsert only (no public AddPosition) | Matches Save-button UX; keeps port small |
| Import UX | List + Get → Diary read-only | Safe review; no resume/trading conflicts |
| Storage | Interface + JSON now; Azure Table later | Portability without blocking on cloud setup |
| Entry UI | Dedicated screen: Start + Load | Session is first-class before playing |

## Scope

**In scope:**
- Core snapshot models + `ISessionRepository`
- `JsonSessionRepository` + options + tests
- REST create/get/list + DI binding to JSON
- Session entry UI (moved pre-play settings)
- In-sim Save + Diary hydrate from Load

**Out of scope:**
- Azure Table implementation
- Public `AddPosition`
- Resume into live Dashboard trading
- Embedding full candle series
- Auth, auto-save, e2e harness

## Architecture / Approach

```
UI (Entry / Dashboard Save / Diary Load)
    → /api/sessions
        → ISessionRepository
            → JsonSessionRepository (now)
            → AzureTableSessionRepository (later change)
```

Frontend keeps `activeSessionId` for overwrite-on-re-Save. Candles reload from existing packs using stored refs when reviewing in Diary.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| ----- | ---------------- | -------- |
| 1. Domain + interface | Models + `ISessionRepository` | Over-fitting port to JSON |
| 2. JSON repository | File persistence + overwrite tests | Corrupt/list edge cases |
| 3. HTTP + DI | REST + JSON registration | Leaking storage details into API |
| 4. Entry UI | Start / Load session screen | Routing split vs Dashboard lock semantics |
| 5. Save + Diary | Overwrite Save + read-only import | Imported mode accidentally enabling trades |

**Prerequisites:** Existing candle packs + S-03 paper engine; backend/API runnable locally  
**Estimated effort:** ~2–3 sessions across 5 phases

## Open Risks & Assumptions

- Folder id remains `positon-handling` (typo); not on the foundation roadmap
- List performance assumes modest local session counts
- Diary import needs candle packs still available for stored refs

## Success Criteria (Summary)

- Save twice in one live session → one stored session with latest snapshot
- Load session → Diary shows saved trades/lots without trading enabled
- `ISessionRepository` has no filesystem/Azure types; JSON is the only bound impl for now
