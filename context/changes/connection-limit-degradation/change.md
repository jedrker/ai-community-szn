---
change_id: connection-limit-degradation
title: Degrade honestly when the Ably connection limit is reached
status: impl_reviewed
created: 2026-08-09
updated: 2026-08-10
archived_at: null
---

## Notes

dwie poprawki na wypadek przekroczenia limitu 200 połączeń Ably: (1) komunikat rozróżniający wyczerpany limit sali od chwilowej utraty połączenia, (2) degradacja do pollingu /api/quiz/state z zachowaniem możliwości odpowiadania, gdy Ably nie łączy
