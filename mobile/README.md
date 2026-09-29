# HabitFlow Mobile

App React Native/Expo per Android e iOS, con archivio SQLite locale e backup JSON compatibile con HabitFlow web. Non richiede backend, account o connessione per le funzioni principali.

Per iniziare su Windows apri [la guida Android Studio](../docs/mobile.md). Gli [esiti delle verifiche](../docs/mobile-verification.md) distinguono build/test automatici dalle prove che richiedono un emulatore o un iPhone.

```sh
npm ci
npm run typecheck
npm run lint
npm test
npx expo prebuild --platform android
npx expo start
```

Usa Node 24 e JDK 17 come spiegato nella guida. `android/` e `ios/` sono progetti nativi generati; non sono versionati e si ricreano con `expo prebuild`.
