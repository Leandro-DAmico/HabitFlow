# Bozza LinkedIn — da personalizzare, non pubblicata

Una streak di 20 giorni dice poco se il tuo obiettivo era allenarti tre volte a settimana.

Ho costruito HabitFlow, un habit tracker local-first che misura la costanza rispetto al piano scelto e permette di mettere in pausa e riprendere senza arretrati da recuperare.

Il lavoro più interessante non è stata la checkbox, ma ciò che c'è dietro:

- frequenze giornaliere, giorni specifici e target settimanali con regole distinte;
- date civili e revisioni del piano per non riscrivere lo storico cambiando timezone;
- completamenti idempotenti e backup JSON validati in transazione;
- un'interfaccia responsive, accessibile e senza meccaniche punitive.

Stack: Python/FastAPI, SQLAlchemy/Alembic, SQLite e React/TypeScript. Test di dominio e integrazione, component test e percorsi Playwright con browser reale.

Ho lavorato con un'orchestrazione AI multi-agente, separando analisi di dominio, UX e implementazione, poi verificando l'integrazione. La lezione: parallelizzare aiuta solo quando contratti, ownership e criteri di verifica sono chiari.

È un progetto portfolio: i dati demo sono sintetici e non rivendico utenti o risultati di business. Nel repository descrivo anche i trade-off e i limiti rimasti.

Repository: [INSERIRE LINK GITHUB]

Mi interesserebbe un confronto: come rappresentereste il progresso di un'abitudine flessibile senza trasformarlo in una gara?

#Python #React #SoftwareEngineering #BuildInPublic
