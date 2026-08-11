---
change_id: connection-limit-degradation
title: Degrade honestly when the Ably connection limit is reached
status: archived
created: 2026-08-09
updated: 2026-08-11
archived_at: 2026-08-11T08:09:54Z
---

## Notes

dwie poprawki na wypadek przekroczenia limitu 200 połączeń Ably: (1) komunikat rozróżniający wyczerpany limit sali od chwilowej utraty połączenia, (2) degradacja do pollingu /api/quiz/state z zachowaniem możliwości odpowiadania, gdy Ably nie łączy
