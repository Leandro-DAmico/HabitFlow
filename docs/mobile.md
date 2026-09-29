# HabitFlow su Android e iPhone

La versione mobile è in [`mobile/`](../mobile/). È un'app React Native/Expo con schermate native e SQLite sul dispositivo. Non richiede che FastAPI o il computer restino accesi. La versione web in `frontend/` e `backend/` continua a funzionare separatamente; i dati passano fra le due versioni con il backup JSON v1, su richiesta dell'utente.

## Cosa trovi nell'app

- Quattro destinazioni sempre raggiungibili: Oggi, Abitudini, Progressi, Impostazioni; dettaglio e modulo di modifica nella navigazione di sistema.
- Completamento e annullamento con un tocco, feedback tattile leggero, note, calendario, streak, filtri, pausa/ripresa, archivio/ripristino e cancellazione confermata.
- Giornaliera, giorni scelti o N volte a settimana. I cambi di piano iniziano il lunedì successivo e i check-in conservano la data civile e il fuso originale.
- Progressi con tasso sugli obiettivi conclusi, barre con valori numerici e calendario con etichette accessibili.
- Backup JSON tramite il foglio di condivisione del sistema, anteprima e import additivo di un file della web app. Demo sintetica ripetibile.

Il design riprende verde salvia, carta chiara e tono non punitivo della web app. I controlli principali misurano almeno 48 punti, gli input almeno 52, la navigazione rispetta le aree sicure, il testo può andare a capo e non ci sono gesti nascosti necessari. Orientamento verticale e orizzontale supportati; il contenuto resta leggibile su tablet grazie alla larghezza massima.

## Provare in Android Studio, Windows

Requisiti: Node.js 24, Android Studio con Android SDK Platform 36, Build Tools 36, NDK 27.1.12297006, JDK 17 e un dispositivo virtuale (AVD) Android. Il Node predefinito di questa macchina è 20.11 e il JDK integrato di Android Studio è 25: entrambi hanno causato problemi di compatibilità nella verifica. Questo workspace contiene Node 24 in `.tools/` (ignorato da Git) e ha JDK 17 in `C:\Program Files\Java\jdk-17`. Su un altro computer installa Node 24 e JDK 17.

Per provare **questa copia già preparata**, `mobile/android/` e le dipendenze sono già presenti: non serve reinstallare né rigenerare. Avvia soltanto Metro da PowerShell:

```powershell
cd C:\Users\LeanO\Desktop\HabitFlow\mobile
$env:PATH='C:\Users\LeanO\Desktop\HabitFlow\.tools\node_modules\node\bin;' + $env:PATH
$env:JAVA_HOME='C:\Program Files\Java\jdk-17'
$node='C:\Users\LeanO\Desktop\HabitFlow\.tools\node_modules\node\bin\node.exe'
& $node node_modules\expo\bin\cli start
```

Su una copia nuova dal repository, o dopo modifiche alla configurazione/dipendenze native, prepara prima il progetto:

```powershell
& $node 'C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js' ci
& $node node_modules\expo\bin\cli prebuild --platform android --no-install
```

La cartella `mobile/` include `.npmrc` per rendere `npm ci` riproducibile con il lockfile Expo attuale; non avviare `npm ci` mentre Android Studio/Gradle sta compilando, perché Windows mantiene aperti file sotto `node_modules`. `prebuild` rigenera `android/` e rimuove gli APK locali precedenti: se vuoi conservarli, copiali prima altrove.

Apri **Android Studio → Open → `C:\Users\LeanO\Desktop\HabitFlow\mobile\android`**. In **Settings → Build, Execution, Deployment → Build Tools → Gradle**, imposta **Gradle JDK** su `C:\Program Files\Java\jdk-17`, poi sincronizza. In **Device Manager** crea e avvia un AVD Android (prima uno schermo piccolo da telefono, poi un tablet); premi **Run**. Il server Metro deve restare acceso durante una build debug. In alternativa, `& $node node_modules\expo\bin\cli run:android` compila e installa sull'emulatore attivo.

Su questa macchina non c'è ancora un'immagine di sistema/AVD e `emulator -accel-check` segnala che manca il driver hypervisor. Android Studio può installare l'immagine tramite Device Manager e il driver tramite **SDK Manager → SDK Tools → Android Emulator hypervisor driver**; l'accelerazione richiede anche la virtualizzazione abilitata nel sistema. Senza questi prerequisiti il progetto si compila, ma l'emulatore non può essere avviato qui.

Il progetto `android/` è generato e ignorato da Git: si ricrea da `app.json`, `package.json` e lockfile con `expo prebuild --platform android`. Dopo modifiche a dipendenze native, config o icone, esegui nuovamente prebuild e ricompila. Non modificare a mano i file generati.

L'APK debug generato per Android Studio è `mobile/android/app/build/outputs/apk/debug/app-debug.apk` e richiede Metro. L'APK `mobile/android/app/build/outputs/apk/release/app-release.apk` include il bundle offline ed è stato compilato per telefoni ARM64: è firmato con la chiave di debug predefinita, solo per test personale, **non** per pubblicazione o aggiornamenti futuri.

Per trasferire le abitudini della web app: sul web vai in **Impostazioni → Esporta backup**, porta il JSON sul dispositivo, poi nell'app mobile vai in **Impostazioni → Importa backup JSON** e conferma l'anteprima. Importa anche il percorso inverso tramite l'export mobile e l'import web. L'import è additivo: gli ID già presenti vengono saltati; un ID con contenuto in conflitto produce un errore. Esporta un backup prima di disinstallare l'app.

## iPhone e iPad

Lo stesso progetto React Native ha configurazione iOS e supporto tablet. La compilazione locale richiede macOS, Xcode e un simulatore/dispositivo iOS:

```sh
cd mobile
npm ci
npx expo prebuild --platform ios
npx expo run:ios
```

Su Windows non si può aprire Xcode o eseguire un simulatore iOS. Non è stata pubblicata una build cloud né firmata un'app per App Store. La verifica iOS reale va effettuata su Mac prima di distribuirla.

## Dati, backup e limiti

Le tabelle SQLite mobili riproducono il grafo del backup web: `settings`, `habits`, `schedules`, `pauses`, `checkins`. Indici e vincoli impediscono doppioni di check-in e revisioni con la stessa data. I file importati sono limitati a 5 MB e 50.000 record, validati prima di una transazione atomica. Android Auto Backup è disattivato in `app.json`; i backup espliciti sono file in chiaro, da conservare con cura. Su iOS il comportamento del backup di sistema dipende dalle impostazioni del dispositivo.

La versione mobile non usa notifiche obbligatorie, cloud o account. Le regole di calendario sono state portate in TypeScript e testate con casi equivalenti ai test Python. Le due implementazioni restano separate: quando si modifica una regola di dominio, aggiornare entrambi i test è parte della manutenzione. Non ci sono metriche di utilizzo o test su persone reali.

Gli esiti effettivi della compilazione e dei test sono in [mobile-verification.md](mobile-verification.md).
