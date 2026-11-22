---
change_id: positon-handling
title: Session persistence via ISessionRepository
status: implemented
created: 2026-11-21
updated: 2026-11-22
archived_at: null
---

## Notes

Store full sim sessions after play for later review. Interface: CreateSession (upsert full snapshot), GetSession, ListSessions — JSON file now, Azure Table deferred. UI: session entry screen with Start session + Load session (Diary read-only); explicit Save overwrites same session id.
