# Scelte di prodotto

## Una promessa piccola, mantenuta

HabitFlow aiuta a scegliere un piano sostenibile e a riprenderlo dopo una pausa. Non attribuisce valore personale a una percentuale e non suggerisce di recuperare giorni arretrati. Le streak sono informazioni secondarie, con unità esplicite: sessioni pianificate oppure settimane.

## Flussi

1. Impostare nome locale e timezone; creare la prima abitudine con obiettivo concreto, icona, colore, frequenza e data iniziale.
2. Oggi mostra le azioni utili; completare e annullare sono operazioni idempotenti. Una nota facoltativa aggiunge contesto.
3. Abitudini permette ricerca, filtri, modifica, pausa, ripresa, archivio, ripristino ed eliminazione confermata.
4. Progressi mostra dati reali in calendario e trend, sempre con periodo e denominatore spiegati.
5. Impostazioni rende disponibili demo e backup JSON. Importare non cancella silenziosamente i dati esistenti.

## Metriche oneste

- Giorno/settimana ancora aperti non sono fallimenti. Il tasso riassume periodi conclusi, il progresso corrente è separato.
- Nei piani N/settimana il target della settimana parziale è limitato ai giorni disponibili; gli extra non gonfiano il tasso.
- Pause e archivio non generano debiti. Un completamento già fatto oggi non sparisce mettendo in pausa.
- Le modifiche al piano decorrono dal prossimo lunedì; l'interfaccia esplicita l'attesa.
- Un cambio della timezone predefinita vale per le nuove abitudini; quelle esistenti mantengono il proprio piano finché non vengono modificate.

## Accessibilità e identità

Carta calda e verde profondo, tipografia editoriale e icone SVG. Nessuna gamification competitiva, avviso ansiogeno, notifica reale obbligatoria o dark pattern. Dialoghi con focus gestito, label visibili, navigazione da tastiera, riduzione del movimento e riepiloghi testuali dei grafici.

Le scansioni automatiche e i test browser sono una base verificabile, non una certificazione WCAG: una verifica manuale con screen reader e utenti rimane una voce di roadmap.

## Limiti intenzionali

Single-user locale, nessun account o sincronizzazione; niente app mobile nativa, reminder reali o calendario esterno. Date iniziali immutabili dopo creazione per ridurre ambiguità storiche. Import JSON scelto al posto di CSV per conservare revisioni, pause e note. Non si può importare distruttivamente sopra un UUID diverso: i conflitti vengono segnalati.

## Estensione notifiche

Il contratto applicativo può emettere eventi locali tramite `NotificationPort`; l'implementazione predefinita non invia nulla. Qualunque adattatore futuro (desktop, email, push) richiederà consenso esplicito, gestione timezone e quiet hours. Nessuna dipendenza da provider nel dominio.
