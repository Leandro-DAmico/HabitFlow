# Contratto d'integrazione v1

Base `/api/v1`. Date `YYYY-MM-DD`, weekday ISO 1=lunedì … 7=domenica. Errori `{error:{code,message,details:[]}}`. Testo UI italiano. JSON snake_case. No envelope nelle risposte di successo.

`Schedule`: `{kind:'daily'|'weekdays'|'times_per_week', weekdays:number[], target_per_week:number, timezone:string, effective_from:string}`. Campi non pertinenti: array vuoto/target 1. In creazione effective_from è omesso.

`Stats`: `{current_streak:number,best_streak:number,streak_unit:'sessions'|'weeks',completed:number,expected:number,completion_rate:number|null,total_checkins:number,week_completed:number,week_target:number}`. Tasso 0..100 per unità concluse; completed/expected si riferiscono al periodo selezionato. Le settimane concluse sono attribuite alla loro domenica: se questa cade nel periodo, entra l'intera settimana, anche attraversando un confine di mese. Calendario e serie weekly/monthly mostrano invece attività grezza e capacità giornaliera, non il denominatore del tasso.

`Habit`: `{id,name,goal,icon,color,start_date,status:'active'|'paused'|'archived',schedule:Schedule,pending_schedule:Schedule|null,today:string,is_due:boolean,completed_today:boolean,note_today:string,stats:Stats}`.

- `GET /health` -> `{status:'ok'}`.
- `GET /settings` -> `{display_name,timezone,onboarding_completed}`; `PATCH /settings` stessi campi facoltativi. La timezone predefinita non modifica abitudini esistenti.
- `GET /habits` -> `Habit[]` (inclusi archiviate). `POST /habits` body `{name,goal,icon,color,start_date,schedule:{kind,weekdays,target_per_week,timezone}}` -> Habit.
- `GET /habits/{id}` -> Habit. `PATCH` campi descrittivi + schedule opzionale; cambi piano dal prossimo lunedì. `start_date` è immutabile dopo creazione. `DELETE` ->204.
- `POST /habits/{id}/pause`, `/resume`, `/archive`, `/restore` -> Habit. Ripetuti sono no-op.
- `PUT /habits/{id}/checkins/{date}` body `{note:string}` -> Habit; DELETE ->204. PUT idempotente; storico eleggibile consentito, date future rifiutate; archiviate read-only.
- `GET /analytics?days=84&habit_id=UUID` (habit_id opzionale) -> `{from_date,to_date,completed,expected,completion_rate,total_checkins,active_habits,calendar:[{date,completed,expected}],weekly:[{label,completed,expected}],monthly:[{label,completed,expected}],habits:Habit[]}`. Calendar conta checkin reali; weekly/monthly sono serie informative (non reinferire streak nel client).
- `GET /data/export` -> backup JSON versionato completo.
- `POST /data/import` body backup -> `{imported:number,skipped:number}`. Additivo atomico, conflitti409.
- `POST /data/demo` -> `{created:number}`. Seed additivo ripetibile; non sovrascrive dati utenti.

Il frontend usa esclusivamente `/api/v1` via proxy Vite/nginx. Server dev 127.0.0.1:8000; frontend 127.0.0.1:5173. E2E usa backend separato 127.0.0.1:8001 e frontend 127.0.0.1:5174 con DB isolato.
