# Verifica eseguita — HabitFlow

Ultimo ciclo: **20 settembre 2026**, Windows, Python 3.12 e Node 24.21.0. Nessun controllo descritto come superato è soltanto un comando suggerito. La CI remota non è stata eseguita e Docker non è disponibile in questo ambiente.

## Esiti

| Controllo eseguito | Esito |
| --- | --- |
| `py -3.12 -m venv .venv`, `pip install -e './backend[dev]'` | Dipendenze installate in ambiente isolato |
| `npm ci` con Node 24 locale | Installazione riuscita, lockfile disponibile |
| `pip check` | Nessuna dipendenza incompatibile |
| `alembic upgrade head`, `alembic current` | Database migrato a `0001_initial (head)` |
| `alembic check` | Nessuna operazione di migrazione mancante |
| `ruff check .`, `ruff format --check .` in backend | Superati |
| `mypy app` | Superato, modalità strict |
| `pytest -q` | **44 test superati**, inclusi dominio e API su DB temporanei realmente migrati |
| `npm run lint`, `npm run typecheck` | Superati |
| `npm test` | **8 test componenti superati** |
| `npm run format:check` | Superato |
| `npm run build` | Bundle di produzione generato |
| `playwright install chromium` | Chromium installato ed effettivamente utilizzato |
| `npm run test:e2e` | **4 scenari superati** con API e frontend reali |
| `pre-commit install`, `pre-commit run --files …` | Hook installati; Ruff, formatter, Prettier ed ESLint superati su tutti i file candidati al repository |
| Parsing `compose.yaml` | YAML valido; **non equivale a un'esecuzione Docker** |

I comandi frontend Windows sono stati eseguiti usando `scripts/frontend.ps1`: il Node di sistema era 20.11, insufficiente per Vite/Vitest. Il runtime 24 è isolato in `.tools/`, ignorato da Git; nessun runtime globale o progetto preesistente è stato sostituito.

## Browser reale e screenshot

Playwright avvia un backend separato su `127.0.0.1:8001`, migra un database temporaneo e avvia Vite su `127.0.0.1:5174`. I test non cancellano né riutilizzano il database di sviluppo.

Scenari:

1. Onboarding → abitudine con obiettivo → nota → completamento da tastiera → reload e persistenza → demo → analytics.
2. Creazione N/settimana → ricerca → focus/Escape nel dialogo → pausa/ripresa → modifica → piano timezone futuro preservato da una successiva modifica descrittiva → archivio → export/import idempotente → ripristino → eliminazione confermata.
3. Layout mobile, tablet, desktop e landscape: 375×900, 768×1024, 1024×768, 812×375; testo al 125%; nessun overflow della pagina. Vista desktop principale anche a 1440×1000.
4. Errore API simulato in modo esplicito → messaggio utile → Riprova → ripristino della connessione reale.

Nei flussi nominali vengono controllati errori JavaScript, errori e warning della console, richieste fallite e risposte API HTTP ≥400. Nessun errore inatteso è rimasto nell'ultimo run. Lo scenario di indisponibilità produce intenzionalmente una risposta 503.

Scansioni Axe con regole WCAG 2 A/AA e 2.1 AA su onboarding, Oggi e Progressi desktop/mobile: nessuna violazione automatica rilevata nel run finale. Non è una certificazione WCAG né una prova di compatibilità con ogni screen reader.

Screenshot reali, ispezionati visivamente dal principal:

- [Onboarding desktop](screenshots/onboarding-desktop.png)
- [Oggi desktop](screenshots/today-desktop.png)
- [Progressi desktop](screenshots/analytics-desktop.png)
- [Oggi mobile](screenshots/today-mobile.png)
- [Progressi mobile](screenshots/analytics-mobile.png)

Le immagini includono esclusivamente dati sintetici di test/demo. Report HTML e trace delle esecuzioni sono locali in `frontend/playwright-report/` e `frontend/test-results/`, ignorati da Git.

## Review indipendente e correzioni

`habit_domain`, modello reale **gpt-5.6-terra / max**, ha svolto una review read-only. I rilievi sono stati integrati e verificati dal principal:

- Allineare piano corrente e data civile nel passaggio Europe/Rome → America/New_York al confine del lunedì; test delle snapshot storiche.
- Rendere realmente funzionante Riprova nelle analytics; regressione Vitest.
- Non sovrascrivere una revisione futura quando si modifica soltanto l'obiettivo; piano futuro visibile e regressioni Vitest/E2E.
- Rifiutare backup con stato paused ma senza intervallo aperto e altri conflitti di lifecycle; validazione atomica e regressioni API.
- Correggere contrasto, nome accessibile del pulsante mobile e overflow dei grafici, anche con testo ingrandito.
- Aggiungere questo rapporto, prima mancante dai link di documentazione.

Il principal ha inoltre verificato la doppia richiesta concorrente di completamento, l'allineamento dei giorni della heatmap, i valori zero dei grafici, l'aggiornamento delle note e l'assenza di confronti fra streak con unità diverse.

## Agenti e confini del lavoro

| Agente effettivamente utilizzato | Modello / effort | Contributo |
| --- | --- | --- |
| `habit_domain` | `gpt-5.6-terra` / `max` | Analisi iniziale, dominio puro, 29 test di calendario, review timezone e review read-only finale |
| `product_ux` | `gpt-5.6-terra` / `high` | Analisi UX, frontend, styling, component test, correzioni di accessibilità |
| `qa_architecture` | `gpt-5.6-terra` / `max` | Analisi architetturale, SQLAlchemy/Alembic, servizi e validazione, integrazione API e test |
| Principal | Coordinamento e integrazione | ADR/contratto, adapter HTTP, sicurezza locale, E2E, infrastruttura, documentazione, regression fix e verifica finale |

Le analisi iniziali sono terminate prima dell'implementazione e sono sintetizzate in `architecture.md`. L'ownership dei file è stata separata; `app/main.py` è stata trasferita esplicitamente al principal. Limiti d'uso hanno interrotto gli agenti durante alcuni passaggi: il lavoro è stato ripreso dai file salvati, senza dichiarare complete le parti interrotte. Le verifiche finali sono state eseguite dal principal.

La skill UI/UX ha guidato contrasto, focus, dimensione dei controlli, riduzione del movimento e responsive. La skill Playwright ha guidato i flussi browser e l'evidenza visiva.

## Limiti e controlli non eseguiti

- **Docker assente:** `Get-Command docker` non trova l'eseguibile. `docker compose config`, build e avvio container restano da eseguire su una macchina con Docker; nessun esito positivo è presunto.
- **GitHub Actions:** workflow predisposto ma non eseguito remotamente; nessun push effettuato.
- Pytest segnala due deprecazioni di dipendenze terze (Starlette/httpx e alias AnyIO), non errori dei test. Non sono state nascoste.
- Playwright è stato eseguito con Chromium su Windows, non Firefox/WebKit. Setup macOS/Linux e container sono documentati ma non provati su sistemi reali in questa sessione.
- Nessuna prova manuale con screen reader, ricerca utenti, benchmark prestazionale, autenticazione multiutente, cifratura o sync. Il backfill storico è disponibile via API; la UI quotidiana opera su oggi. Il cambio di fuso usa la politica esplicita descritta nell'ADR 002.

## Checklist prima di pubblicare

- [ ] Rivedere codice, screenshot e attribuzione MIT con il proprio nome.
- [ ] Eseguire `docker compose config` e `docker compose up --build` con Docker disponibile.
- [ ] Controllare `git status` e confermare che `.env`, DB, backup, `.tools/`, `.venv/` e `node_modules/` non siano inclusi.
- [ ] Creare il primo commit locale e un repository GitHub; verificare Actions dopo il push autorizzato dall'utente.
- [ ] Sostituire il placeholder repository nel post LinkedIn e personalizzare il racconto con ciò che si sa spiegare del codice.
- [ ] Pubblicare soltanto dopo la propria revisione. Non sono stati effettuati push, deployment pubblici o post LinkedIn.
