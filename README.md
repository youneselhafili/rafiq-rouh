# رفيق الروح — Rafiq Rouh

> رفيق الروح — بوت ديسكورد إسلامي شامل للقرآن الكريم، الأذان، الأذكار، الصلوات وتذكير الجمعة.
> **Rafiq Rouh** is a feature-rich Islamic Discord bot covering the Holy Quran, prayer (adhan) times, adhkar (daily remembrances), salawat, Jumu'ah reminders and more — with a personal DM panel for every member.

---

## ✨ Features

### 🕌 Adhan — Prayer Times
- Configure prayer-time notifications per country/city (zones from a built-in city catalog).
- Choose a notification channel, pick your city, and set the adhan playback mode:
  - **Voice + notification** (plays the adhan in a voice channel)
  - **Notification only**
  - **Stopped**
- Select from bundled adhan audio files (one dedicated Fajr file, random no-repeat rotation for the rest) and set the volume.

### 📻 Quran — Quran Radio
- Set up a dedicated voice channel with a 24/7 Quran radio that alternates between **Al-Haram al-Makki** and **Al-Masjid an-Nabawi** every 6 hours.
- In-channel control panel; the first member to join becomes the controller.
- Reciter and radio catalogs under `data/catalog/` and `data/raw/`.

### 📿 Adhkar — Daily Remembrances
- Randomized adhkar tied to prayer times (morning, evening, sleep, wudu, after-prayer, etc.).
- Pick which adhkar types to enable, preview, activate/stop/delete, and route them to specific channels.

### 🕯️ Salawat
- Scheduled reminders to send blessings upon the Prophet ﷺ.
- Salawat formulas are read from `data/raw/salawat.txt` and rotate randomly without repetition.

### 🕌 Jumu'ah — Friday
- Friday reminders plus automatic recitation of Surat Al-Kahf.

### 🔔 Personal DM Panel
- `/setup_dm` publishes a per-member panel. Each member can independently configure:
  - Country/city for prayer notifications
  - Adhkar and Quran/ Al-Kahf reminders delivered to their DMs
  - Cleanup of bot messages in their DMs
- Works per user, without affecting server-wide settings.

### 🛡️ Roles & Logs
- `/setup_roles` — configure custom mentionable roles.
- `/setup_logs` — route bot audit/log events to a channel, with optional critical-error DMs.
- `/setup_adhan` — exposes a dashboard-styled setup flow (channel picker, country/city selects, audio settings).

### ⚙️ Storage
- Guild configurations are stored in **Firebase Firestore** when configured (service account via env var), with automatic **local JSON fallback** under `data/guilds/`.

---

## 📦 Tech Stack

| Area | Technology |
|------|-----------|
| Language | TypeScript (ES2022, CommonJS) |
| Runtime | Node.js 18+ |
| Discord | discord.js v14, @discordjs/voice |
| Scheduling | node-cron |
| Database | firebase-admin (Firestore) + local JSON fallback |
| Audio | ffmpeg (auto-resolved via `ffmpeg-static`/PATH), libsodium-wrappers |
| Images | @napi-rs/canvas |
| Time | moment-timezone |

---

## 🚀 Getting Started

### Prerequisites
- **Node.js 18+** and npm
- A **Discord Application** with a bot token and the following Gateway Intents enabled:
  - `Guilds`, `GuildMessages`, `GuildVoiceStates`
  - (Bot requires `Manage Guild`, voice, and message permissions in your servers)
- **FFmpeg** available on PATH (the bot also probes a common WinGet FFmpeg install path).
- *(Optional)* A **Firebase** project with a service-account key for Firestore storage.

### 1. Install
```bash
npm install
```

### 2. Configure environment
Copy `.env.example` to `.env` and fill in the values:
```env
DISCORD_TOKEN=your-bot-token
CLIENT_ID=your-bot-application-id
DISCORD_CLIENT_SECRET=your-oauth-client-secret
FIREBASE_SERVICE_ACCOUNT_PATH=./service-account.json   # optional
GUILD_ID=your-dev-guild-id                              # optional; omit for global commands
DASHBOARD_REDIRECT_URI=http://127.0.0.1:5174/auth/callback
DASHBOARD_HOST=127.0.0.1
DASHBOARD_PORT=5174
DASHBOARD_ENABLED=true
```

> ⚠️ **Never commit `.env` or your service-account JSON.** Both are excluded via `.gitignore`.

### 3. Build
```bash
npm run build
```

### 4. Deploy slash commands
```bash
npm run deploy-commands
```
- If `GUILD_ID` is set, commands register to that guild (fast for development).
- Otherwise they register globally (may take up to an hour to propagate).

### 5. Start the bot
```bash
npm start
```

---

## 🧰 Scripts

| Script | Command | Purpose |
|--------|---------|---------|
| Build | `npm run build` | Compile TypeScript (`tsc`) to `dist/` |
| Start | `npm run start` | Run the compiled bot (`node dist/src/index.js`) |
| Dev | `npm run dev` | Run from source with `ts-node` |
| Deploy commands | `npm run deploy-commands` | Register slash commands (guild or global) |
| Migrate | `npm run migrate` | Run `migrate-to-firestore.ts` (migrate local data to Firestore) |
| Clear commands | `ts-node clear-global-commands.ts` | Remove all global slash commands |

---

## 🗂️ Slash Commands

| Command | Description |
|---------|-------------|
| `/setup_adhan` | Configure adhan zones, audio, and notifications |
| `/adhan_zones` | View/manage your prayer zones |
| `/setup_quran` | Configure the Quran radio voice channel and 24/7 mode |
| `/setup_adhkar` | Configure randomized adhkar tied to prayer times |
| `/setup_salawat` | Configure salawat reminders |
| `/setup_jumuah` | Configure Friday reminders and Al-Kahf recitation |
| `/setup_roles` | Configure custom mentionable roles |
| `/setup_logs` | Configure bot audit/log channel |
| `/setup_dm` | Publish the personal DM settings panel |
| `/how_to_use` | Usage guide |
| `/test` | Development/test command |

---

## 📁 Project Structure

```
.
├── src/
│   ├── bootstrap/          # Catalog builders
│   ├── commands/           # Slash command definitions & handlers
│   │   ├── adhan/ quran/ adhkar/ salawat/ jumuah/
│   │   ├── dm/ roles/ logs/ info/ test/
│   ├── config/             # Firebase configuration
│   ├── data/               # Static catalogs (cities, hadiths)
│   ├── events/             # Discord client events
│   ├── handlers/           # Command & event loaders, command deployment
│   ├── parsers/            # Adhkar / radio / reciter parsers
│   ├── quran/              # Quran registry, radio & reciter stores
│   ├── registries/         # Content registries
│   ├── services/           # Business logic (adhan, quran, adhkar, DM, storage…)
│   ├── types/              # Shared TypeScript types
│   └── utils/              # Logging, UI renderers, constants
├── data/
│   ├── catalog/            # Reciters, radios, adhkar catalogs
│   ├── guilds/             # Local JSON fallback storage
│   └── raw/                # Raw content (adhkar, salawat, reciter lists, adhan audio)
├── deploy-commands.ts      # Slash-command registration script
├── clear-global-commands.ts
├── migrate-to-firestore.ts
├── package.json
└── tsconfig.json
```

---

## 🔒 Security Notes

- `.env`, `service-account.json`, and any `*-firebase-adminsdk-*.json` are ignored by git.
- Generated artifacts (`node_modules/`, `dist/`, `logs/`), archives (`.zip`/`.rar`), and `discloud.config` are also excluded.
- Never commit tokens, passwords, or private keys.

---

## 📜 License

ISC
