# Verifica di HabitFlow Mobile

Data: 24 settembre 2026. I risultati qui sotto riguardano i controlli realmente eseguiti su Windows; una build riuscita non equivale a una prova d'uso su emulatore o telefono.

## Risultati

| Controllo | Esito |
| --- | --- |
| Installazione riproducibile `npm ci` con Node 24 e `.npmrc` | Superata: 802 pacchetti dal lockfile |
| `expo install --check` | Superato: dipendenze allineate all'SDK 57 |
| `tsc --noEmit` | Superato |
| `expo lint --no-cache` | Superato senza errori o warning sul codice finale |
| `vitest run src/domain.test.ts src/backup.test.ts` | Superato: 16 test su 2 file |
| `expo export --platform android` | Superato: bundle di 1.356 moduli e asset generati |
| `expo prebuild --platform android --no-install` | Superato: progetto Android Studio generato |
| `gradlew assembleDebug` con JDK 17 | Superato: APK universale da 182.979.226 byte |
| `gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a` con JDK 17 | Superato: APK ARM64 autonomo da 41.563.043 byte, bundle JS incorporato |
| `apksigner verify --verbose` sull'APK release | Superato: firma APK v2 valida, un firmatario di test |
| `aapt dump badging` | Verificati package `dev.habitflow.app`, versione 1.0.0, min SDK 24, target SDK 36 |
| `expo config --type prebuild --json` | Configurazione iOS verificata: bundle `dev.habitflow.app`, tablet supportati, orientamento non bloccato |

L'APK debug è in [`mobile/android/app/build/outputs/apk/debug/app-debug.apk`](../mobile/android/app/build/outputs/apk/debug/app-debug.apk); richiede Metro. L'APK ARM64 autonomo è in [`mobile/android/app/build/outputs/apk/release/app-release.apk`](../mobile/android/app/build/outputs/apk/release/app-release.apk). Entrambi sono artefatti locali generati, esclusi da Git. L'APK release usa la chiave di debug del progetto generato: **solo prove personali**, non Play Store, distribuzione o aggiornamenti installati in futuro. Nell'APK ho verificato `assets/index.android.bundle`, solo librerie `arm64-v8a` e `android:allowBackup=false`.

SHA-256 dell'APK ARM64 di test: `B43B66FD56FCC66FA7F70B720FFB63BB3FF61DD756792D3012C655F73861F335`.

## Limiti verificati e lavoro prima della distribuzione

- `adb devices` non trova dispositivi. Non è presente un AVD/immagine Android e `emulator -accel-check` segnala che manca il driver hypervisor. Perciò non ho potuto aprire realmente le schermate, provare onboarding → completamento → progressi, controllare Logcat o produrre screenshot nativi. La [guida Android Studio](mobile.md) spiega come preparare l'emulatore su questa macchina.
- Su Windows non sono disponibili Xcode e il simulatore iOS. Codice e configurazione iOS sono presenti, ma una build e una prova su iPhone/iPad richiedono un Mac e un dispositivo/simulatore. Nessuna build cloud o pubblicazione è stata avviata.
- `npm audit --omit=dev` segnala 14 advisory moderate, 0 alte e 0 critiche nel grafo Expo/React Native. Gli aggiornamenti automatici proposti comportano cambi di major/downgrade non compatibili con SDK 57; non ho usato `audit fix --force`. Prima di distribuire, ricontrollare gli advisory e aggiornare all'SDK Expo mantenuto che li risolve.
- Il manifest release eredita da librerie native permessi `INTERNET`, `VIBRATE`, `SYSTEM_ALERT_WINDOW` e accesso storage limitato ad Android 12L e precedenti. HabitFlow non contiene API di sincronizzazione, analytics o chiamate al backend, ma i permessi ereditati vanno ridotti/giustificati prima di uno store release.
- Non c'è ancora una firma di distribuzione, una privacy policy pubblica, una matrice di test su dispositivi reali né screenshot verificati su Android/iOS. Non ho eseguito test di accessibilità con TalkBack/VoiceOver: le etichette e i target sono implementati, ma richiedono una prova reale.

## Prova manuale consigliata

Su un AVD piccolo e poi uno grande: completare onboarding, creare una frequenza giornaliera e una 3 volte/settimana, registrare e annullare un check-in, salvare una nota, cambiare piano, mettere in pausa/riprendere, archiviare/ripristinare, importare un backup JSON web, esportarlo e riaprire l'app senza rete. Controllare testo ingrandito, tastiera, rotazione, calendario, Logcat e assenza di richieste di rete impreviste. Ripetere le funzioni principali su iPhone prima di considerare la versione iOS pronta alla distribuzione.
