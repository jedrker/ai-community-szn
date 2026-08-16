---
change_id: standings-rank-delta
title: Show each player's rank change since the previous standings beat
status: implementing
created: 2026-08-16
updated: 2026-08-16
archived_at: null
---

## Notes

Pokazać w tabeli wyników zmianę pozycji względem poprzedniego pytania.

Wstępny rekonesans (przed planowaniem, do zweryfikowania):

- `buildStandings` (`src/lib/session/standings.ts`) liczy ranking wyłącznie z bieżących
  punktów — nie ma żadnego źródła poprzedniej pozycji.
- `SessionState.standings` jest zerowane przez każdą inną tranzycję (`reveal.ts`,
  `advance`), więc poprzedni board nie przetrwa w dokumencie sesji.
- Baseline w pamięci klienta odpada: projektor i telefony musiałyby zgodzić się co do
  delty, a reload by ją kasował — to rozbieżność między ekranami, której zakazuje
  guardrail z PRD.
- Kierunek do rozważenia: nowy klucz zarejestrowany w `keys.ts` (ranga per gracz z
  poprzedniego beatu standings), zapisywany w `src/pages/api/quiz/host/standings.ts`,
  plus pole delty na `standingsRow` i na ścieżce `/api/quiz/result` (własna pozycja
  gracza — patrz `rankOf`, obie ścieżki muszą liczyć tak samo).
- Pułapka: host może pokazać ranking dwa razy między pytaniami (ścieżka `republished`
  w `standings.ts`). Drugie pokazanie nie może nadpisać baseline'u, bo delty spłaszczą
  się do zera.
- Nowy klucz dotyka guardraila retencji — `keys.ts` + `end`/`purge`, patrz
  `src/lib/session/CLAUDE.md` i `retention-contract.md`.
