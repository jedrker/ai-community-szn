## LiveQuiz – MVP

### Główny problem

Prowadzenie angażującej sesji quizowej na żywo (prezentacja, szkolenie, lekcja) wymaga narzędzi typu Kahoot/Mentimeter, 
które są płatne, wymagają zakładania kont i przechodzenia przez rozbudowane kreatory — 
nawet gdy potrzebny jest jeden, konkretny quiz.

### Najmniejszy zestaw funkcjonalności

- Jeden quiz zdefiniowany na sztywno w kodzie/pliku konfiguracyjnym (bez kreatora)
- Moduł dołączenia: uczestnik podaje imię i trafia do sesji (bez logowania i haseł)
- Typ pytania: wybór odpowiedzi (single/multiple choice) z punktacją
- Typ pytania: odpowiedź tekstowa (weryfikacja względem listy poprawnych wariantów)
- Typ pytania: word cloud — zbiorcza wizualizacja odpowiedzi wszystkich uczestników w czasie rzeczywistym
- Typ pytania: guess the number — uczestnik podaje liczbę, punktacja zależna od odległości od poprawnej wartości
- Widok prowadzącego: sterowanie przebiegiem (start, następne pytanie, pokaż wyniki)
- Ranking (leaderboard) prezentowany po każdym pytaniu
- Synchronizacja stanu w czasie rzeczywistym między prowadzącym a uczestnikami
- Aplikacja webowa, responsywna — uczestnik na telefonie, prowadzący na dużym ekranie

### Co NIE wchodzi w zakres MVP

- Panel administracyjny i kreator quizów (WYSIWYG, import/eksport pytań)
- Konta użytkowników, rejestracja, logowanie, historia wyników
- Obsługa wielu równoległych sesji / wielu quizów
- Multimedia w pytaniach (obrazy, wideo, audio)
- Zaawansowana punktacja (bonus za czas, mnożniki, streaki)
- Analityka po sesji, raporty, eksport wyników
- Natywne aplikacje mobilne
- Moderacja treści w word cloud

### Kryteria sukcesu

- Uczestnik dołącza do sesji i wysyła pierwszą odpowiedź w mniej niż 30 sekund od otwarcia linku
- 90% uczestników, którzy dołączyli, kończy quiz (odpowiada na ostatnie pytanie)
- Odpowiedzi i ranking aktualizują się u wszystkich uczestników w czasie poniżej 1 sekundy
- Sesja z 150 jednoczesnymi uczestnikami przebiega bez utraty odpowiedzi i rozjazdu stanu

### Wstępny plan na quiz
- Pytanie 1: Word Cloud "Napisz śmieszne słowo związane z AI" - możliwość wpisania jednego słowa
- Pytanie 2: Multiple Choice "Czy wszyscy są gotowi? Ostatnia szansa, by dołączyć do zabawy!" - odpowiedzi: "Jestem gotowy/gotowa!", "Wygram!", "Tak się ekscytuję!", "Poczekajcie, jeszcze ktoś dołącza!" - wszystkie są poprawne.
- Pytanie 3: Single Choice "Co oznacza skrót LLM?"
- Pytanie 4: Type Answer "Jak nazywa się zjawisko, gdy AI z pełnym przekonaniem zmyśla fakty?" - poprawne odpowiedzi: "halucynacje", "halucynacja", "hallucinations", "hallucination"
- Pytanie 5: Single Choice "Co reguluje parametr 'temperatura' w modelach językowych?" - poprawne odpowiedzi: "Losowość/kreatywność odpowiedzi",
- Pytanie 6: Single Choice "Jaki hashtag jest znakiem rozpoznawczym społeczności BRAVE?" - poprawne odpowiedzi: "#veryBrave"
- Pytanie 7: Single Choice "Ile brandów/programów liczy obecnie rodzina BRAVE?" - poprawne odpowiedzi: "7"
- Pytanie 8: Multiple Choice "Czym kończy się dzisiejszy Summer Tour w Szczecinie?" - poprawne odpowiedzi: "Kinem plenerowym", "Networkingiem"
- Pytanie 9: Single Choice "Jak nazywa się hackathon BRAVE, na który rozgrzewką był Summer Tour?" - poprawne odpowiedzi: "BRAVE UnAIted"
- Pytanie 10: Guess the number "Ile procent rozmów z klientami automatyzuje Lyro AI?" - poprawna odpowiedź: 67%
- Pytanie 11: Single Choice "Huuuge Games, partner naszego eventu, to producent:" - poprawne odpowiedzi: "Gier mobilnych"
- Pytanie 12: Single Choice "Jesienna edycja 10xDevs 4.0 startuje:" - poprawne odpowiedzi: "14 września"
- Pytanie 13: Single Choice "Kto prowadzi program AI_Sales?" - poprawne odpowiedzi: "Szymon Negacz"
- Pytanie 14: Guess the number "Ilu absolwentów ma sam kurs AI_devs - najpopularniejszy kurs AI dla developerów w Polsce?" - poprawna odpowiedź: 10000
- And the winner is... 🥁(tutaj ekran loading z zmieniającymi się wyrazami: przeliczanie wyników, Beboppin, Boondoggling, Calculating, Discombobulating, Zigzagging)
- Quiz leaderboard