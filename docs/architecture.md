# HabitFlow — architettura e ADR

## Sintesi della progettazione multi-agente

Tre agenti reali `gpt-5.6-terra` hanno svolto analisi indipendenti prima dell'implementazione: `habit_domain` (max) ha definito calendario e metriche; `product_ux` (high) flussi e accessibilità; `qa_architecture` (max) dati, API, sicurezza e verifica. Le decisioni seguenti sono la sintesi del principal engineer, non tre implementazioni concorrenti.

## ADR 001 — un monolite locale, due processi

FastAPI e SQLite gestiscono dati e regole; React/Vite gestisce l'interazione. Nessuna autenticazione simulata, telemetria o servizio cloud. L'API deve essere raggiungibile solo su loopback; Compose pubblica solo il frontend su loopback. CORS e controllo Origin/Host riducono il rischio di richieste da siti terzi. Non è un server multiutente pronto per Internet.

## ADR 002 — date civili e revisioni del piano

Ogni completamento conserva una data civile ISO, timestamp UTC, timezone IANA e revisione del piano. Le conversioni successive non reinterpretano le date storiche. Una modifica di frequenza o timezone entra in vigore il prossimo lunedì, anche se oggi è lunedì. I piani settimanali non vengono divisi a metà settimana. La prima revisione parte dalla data di inizio. `tzdata` rende ZoneInfo portabile anche su Windows.

Il passaggio avviene al lunedì nel **fuso entrante**. Se il fuso uscente è già lunedì ma quello nuovo è ancora domenica, la data civile operativa resta alla domenica di confine fino al passaggio: piano mostrato, metriche ed eleggibilità devono risolvere la stessa revisione. Nella direzione opposta il passaggio può chiudere prima il giorno del fuso uscente, senza convertire o cancellare i completamenti esistenti; il backfill rimane disponibile via API. È una politica esplicita di calendario, non la simulazione di una giornata di viaggio di esattamente 24 ore.

## ADR 003 — costanza rispetto al piano

Quotidiana e giorni specifici: streak in sessioni pianificate, saltando giorni non previsti e pause. N volte/settimana: streak in settimane ISO, target `min(N, giorni disponibili)`. Gli extra restano visibili ma il tasso non supera 100%. Il giorno/settimana aperto non diventa un fallimento. Il tasso considera solo unità concluse; il progresso di oggi/settimana viene mostrato separatamente. Una transizione fra streak in sessioni e settimane avvia un nuovo segmento; il record si riferisce a quel segmento. Senza denominatore il tasso è assente, non zero.

## ADR 004 — pause senza cancellare risultati

Pause e archiviazioni sono intervalli di inattività a date civili, con inizio incluso e fine esclusa. Si applicano da oggi; un eventuale completamento già registrato oggi rimane valido e conta nel progresso. Riprendere chiude l'intervallo oggi. Nessuna modifica retroattiva a giorni conclusi. L'archivio conserva lo storico, esclude la vista Oggi e rende i completamenti read-only finché non si ripristina l'abitudine. Eliminare è invece esplicito e irreversibile, con conferma UI.

## ADR 005 — comandi idempotenti e backup atomici

`PUT` imposta un completamento; `DELETE` lo rimuove. Non esiste un endpoint toggle. Un vincolo unico protegge `(habit_id, occurrence_date)`. Backup JSON versionati conservano tutti i dati; import additive in transazione, stessi UUID/dati sono no-op, conflitti sono rifiutati. Nessun import distruttivo implicito. Dataset demo additivo e ripetibile.

## ADR 006 — UI accessibile e indipendente

React, TypeScript e Radix Dialog: primitive mantenute con focus trap, Escape e semantica del dialogo senza imporre l'estetica. Controlli nativi dove adeguati, Lucide SVG e font locali. Direzione visiva carta calda/verde salvia, leggibile e non punitiva. Stato, icone e testi non dipendono dal colore. Le metriche sono calcolate esclusivamente dal backend.

## ADR 007 — test proporzionati

Dominio puro con clock esplicito; integrazione SQLite e migrazioni reali; componenti con Vitest; flusso completo con Playwright e controlli accessibilità. CI replica lint, typing, test e build. Docker è un'opzione di distribuzione locale, non una dipendenza necessaria al lavoro quotidiano.

## Confini di ownership

- Domain agent: `backend/app/domain.py`, `backend/tests/test_domain.py`.
- Backend agent: restante `backend/`.
- Frontend agent: `frontend/`, esclusi `e2e/` e `playwright.config.ts`.
- Principal: integrazione, E2E, documentazione, configurazioni radice, CI e verifica finale.

Il contratto REST è descritto in [api-contract.md](api-contract.md). Le decisioni prodotto e i limiti sono in [product-decisions.md](product-decisions.md).
