# HabitFlow — portfolio case study

## Il problema

Molti habit tracker rappresentano la costanza come una catena da non interrompere. Una checkbox giornaliera, però, non descrive un obiettivo di tre allenamenti a settimana, una pausa volontaria o un cambio di fuso. HabitFlow esplora un'alternativa: un piano esplicito, progressi leggibili e la possibilità di riprendere senza debiti inventati.

Questo è un progetto portfolio, non il risultato di una ricerca con utenti reali. Le ipotesi di prodotto sono dichiarate e restano da validare.

## Il mio contributo e l'uso dell'AI

La realizzazione usa un principal agent per integrazione e verifica e tre agenti Terra con responsabilità distinte: regole di dominio, esperienza utente, architettura/backend. Le analisi sono state sintetizzate in ADR prima del codice. La suddivisione per file evita modifiche concorrenti; i risultati devono comunque superare test integrati e review. Questo workflow non sostituisce la capacità di spiegare e mantenere personalmente il codice.

## Decisioni tecniche

Il monolite FastAPI/SQLite mantiene proporzionata l'architettura. React gestisce l'interazione; il backend è l'unica fonte delle metriche. Le revisioni del piano impediscono che cambi di frequenza o timezone riscrivano lo storico. Le date civili descrivono il gesto; il timestamp UTC descrive quando è stato registrato.

La settimana ISO e il prossimo lunedì come confine di modifica rendono deterministica la semantica dei target settimanali. Una settimana ancora aperta non è un fallimento; gli extra non portano il tasso oltre il 100%. Le pause neutralizzano le date senza rimuovere i risultati già ottenuti.

Le operazioni PUT/DELETE idempotenti, il vincolo di unicità e l'import in transazione proteggono da doppio click e backup inconsistenti. Il JSON versionato conserva informazioni che un CSV piatto perderebbe.

## Difficoltà e soluzioni

1. **Streak non giornaliere:** separare unità in sessioni e settimane, testare i periodi aperti e i cambi di segmento.
2. **Timezone e DST:** usare ZoneInfo, salvare le date originarie e testare istanti ai confini della giornata.
3. **Pausa dopo un completamento:** preservare il gesto già fatto senza introdurre nuovi obiettivi durante l'inattività.
4. **Coerenza frontend/backend:** definire un contratto condiviso prima di parallelizzare e verificare le transizioni con un browser reale.
5. **Tooling locale:** isolare dipendenze Python e Node senza alterare progetti o runtime preesistenti.

## Risultati verificabili

Il risultato va valutato sull'app eseguibile, sul codice, sui test e sugli screenshot reali, non su metriche inventate. [Il rapporto di verifica](verification.md) elenca comandi, esiti e blocchi dell'ambiente. La pipeline CI è predisposta ma nessuna pubblicazione o esecuzione remota viene presunta.

## Cosa validerei dopo

Comprensibilità della distinzione fra progresso corrente e tasso storico; semplicità dell'onboarding; leggibilità con screen reader; valore percepito della pausa rispetto al semplice archivio. Eventuali risultati futuri dovrebbero indicare metodo, campione e limiti.
