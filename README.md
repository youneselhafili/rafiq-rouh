# رفيق الروح — Rafiq Rouh

بوت ديسكورد إسلامي للقرآن الكريم، الأذان، الأذكار، الصلاة على النبي ﷺ، الجمعة، الختمات اليومية والتنبيهات الشخصية في الرسائل الخاصة.

**مكتبة القرآن الحالية:** 229 قارئاً (6 مفضلين + 223 في المكتبة)، 4 إذاعات و23,800 تلاوة. هذه الأرقام تُقرأ تلقائياً من catalog داخل البوت عند التشغيل.

## مميزات النسخة الحالية

- لوحة موحدة `/setup_channels` للوصول إلى جميع إعدادات السيرفر.
- إرسال دليل `/how_to_use` تلقائياً في قناة General عند إضافة البوت إلى سيرفر جديد، مرة واحدة فقط.
- أذان متعدد المناطق مع إشعارات وصوت قابل للتخصيص.
- تشغيل القرآن الكريم عشوائياً 24/24، مع انتظار انتهاء السورة قبل الانتقال إلى التالية.
- ختمة للسيرفر أو الرسائل الخاصة: أسبوعية، شهرية، 3 أشهر، 6 أشهر، رمضانية أو بعدد صفحات مخصص.
- معاينة صفحة القرآن من لوحة `/nakhtim` قبل الحفظ.
- أذكار عشوائية، صلاة على النبي ﷺ، وتذكير الجمعة وسورة الكهف.
- لوحة خاصة لكل عضو لضبط المدينة والتنبيهات التي يريد استقبالها في DM.
- حماية من تشغيل نسختين فعالتين من البوت في الوقت نفسه لتفادي الرسائل المكررة.
- تخزين Firestore عند إعداده، مع fallback محلي داخل `data/guilds/`.

## الأوامر — من A إلى Z

| الأمر | الصلاحية | الاستعمال |
|---|---|---|
| `/adhan_zones` | Manage Server | عرض مناطق الأذان وإدارتها واختبار الإشعار والصوت |
| `/donate` | الجميع | عرض معلومات دعم الخادم وإرسال بيانات RIB في الخاص |
| `/how_to_use` | الجميع | عرض دليل كامل ومحدّث داخل البوت |
| `/nakhtim` | Manage Server في السيرفر / متاح في DM | إعداد الختمة اليومية ومعاينة الصفحة الحالية |
| `/setup_adhan` | Manage Server | إضافة مناطق الأذان وضبط القناة والصوت ومستوى الصوت |
| `/setup_adhkar` | Manage Server | إعداد قناة الأذكار والأنواع المرتبطة بمواقيت الصلاة |
| `/setup_channels` | Manage Server | فتح لوحة الإعداد الموحدة لجميع أنظمة البوت |
| `/setup_dm` | الجميع | فتح لوحة التنبيهات الشخصية أو نشر زرها في قناة |
| `/setup_jumuah` | Manage Server | إعداد تذكير الجمعة وتشغيل سورة الكهف |
| `/setup_logs` | Administrator | إعداد قناة السجلات والتنبيهات الحرجة واختبارها |
| `/setup_quran` | Manage Server | اختيار قناة القرآن الصوتية وتفعيل التشغيل 24/24 |
| `/setup_roles` | Manage Server | ربط رتب المنشن بالأذان والأذكار والجمعة والصلوات |
| `/setup_salawat` | Manage Server | جدولة الصلاة على النبي ﷺ ومعاينتها وإدارتها |
| `/test` | Manage Server | تدقيق الروابط والصلاحيات والبيانات والجدولة والصوت |

> `/donate` هو أمر الدعم الوحيد. أوامر `/setup_donate enable` و`/setup_donate disable` و`/setup_donate status` محذوفة وليست جزءاً من النسخة الحالية.

## طريقة الاستعمال

### إعداد السيرفر

1. استعمل `/setup_channels` لفتح اللوحة الموحدة.
2. ابدأ بـ `/setup_adhan` واختر الدولة والمدينة وقناة الإشعارات، ثم اضبط الصوت.
3. راجع المناطق من `/adhan_zones` واختبر الإشعار والصوت.
4. استعمل `/setup_quran` لاختيار القناة الصوتية وتشغيل القرآن 24/24.
5. فعّل الأنظمة التي تحتاجها: `/setup_adhkar` و`/setup_salawat` و`/setup_jumuah` و`/nakhtim`.
6. اضبط الرتب والسجلات من `/setup_roles` و`/setup_logs`.
7. شغّل `/test` للتأكد من الإعدادات بدون إرسال محتوى حي إلا بعد موافقتك.

### لوحة الأعضاء في الرسائل الخاصة

استعمل `/setup_dm` ثم انشر اللوحة في قناة مناسبة. عندما يضغط العضو **فتح الرسائل الخاصة** تصله لوحة شخصية لا تغيّر إعدادات السيرفر. يمكنه اختيار الدولة والمدينة وتنبيهات الصلاة والأذكار والقرآن وسورة الكهف.

### الختمة

استعمل `/nakhtim`، اختر نوع الختمة والقناة أو DM، ثم فعّلها واحفظ. تُرسل أول دفعة فور نجاح الحفظ، ثم تستمر الدفعات يومياً في 08:00 بتوقيت مكة. الحماية اليومية تمنع تكرار دفعتين إذا تم الحفظ قريباً من الموعد. زر **معاينة صفحة القرآن** يعرض الصفحة الحالية بدون تغيير التقدم. في الوضع الرمضاني يمكن تحديد عدد الختمات.

## المتطلبات

- Node.js 18 أو أحدث وnpm.
- تطبيق Discord مع Bot Token وGateway Intents: `Guilds`, `GuildMessages`, `GuildVoiceStates`.
- صلاحيات إرسال الرسائل وإدارة القنوات الصوتية والاتصال والتحدث.
- FFmpeg على PATH أو عبر `ffmpeg-static`.
- Firebase اختياري لاستعمال Firestore.

## التثبيت والإعداد

```bash
npm install
```

انسخ `.env.example` إلى `.env` وأدخل القيم:

```env
DISCORD_TOKEN=your-bot-token
CLIENT_ID=your-bot-application-id
DISCORD_CLIENT_SECRET=your-oauth-client-secret
FIREBASE_SERVICE_ACCOUNT_PATH=./service-account.json
GUILD_ID=your-dev-guild-id
DASHBOARD_REDIRECT_URI=http://127.0.0.1:5174/auth/callback
DASHBOARD_HOST=127.0.0.1
DASHBOARD_PORT=5174
DASHBOARD_ENABLED=true
```

لا ترفع `.env` أو ملف Firebase الخاص إلى GitHub.

## البناء وتشغيل البوت

```bash
npm run build
npm run deploy-commands
npm start
```

`npm run build` يحذف `dist/` القديم أولاً ثم يعيد بناءه. هذا مهم لأن TypeScript لا يحذف تلقائياً ملفات JavaScript الناتجة عن أوامر source تم حذفها.

`npm run deploy-commands` يزامن القائمة الحالية مع Discord: يسجل الأوامر global، وإذا كان `GUILD_ID` موجوداً يزامن نفس القائمة فوراً داخل ذلك السيرفر أيضاً. المزامنة تحذف الأوامر القديمة غير الموجودة في الكود.

## تحديث VPS باستعمال PM2

نفّذ من حساب الاستضافة، مع تغيير المسار إذا كان المشروع في مكان آخر:

```bash
cd ~/rafiq-rouh && \
git pull --ff-only origin main && \
npm ci && \
npm run build && \
npm run deploy-commands && \
pm2 restart rafiq-rouh --update-env && \
pm2 save
```

استعمل `pm2 restart` للتحديث، ولا تكرر `pm2 start` لنفس الاسم حتى لا تنشئ أكثر من process. للتحقق:

```bash
pm2 list
pm2 logs rafiq-rouh --lines 100
```

## حل ظهور أوامر قديمة

إذا ظهر command محذوف في Discord:

1. تأكد أن `git pull` جلب آخر نسخة.
2. نفّذ `npm run build`؛ النسخة الحالية تنظف `dist` تلقائياً.
3. نفّذ `npm run deploy-commands` لمزامنة الأوامر global وداخل `GUILD_ID`.
4. أعد تشغيل process واحد فقط عبر PM2.
5. قد تحتاج الأوامر global بعض الوقت حتى تتحدث في جميع السيرفرات، بينما أوامر `GUILD_ID` تتحدث بسرعة.

## Scripts

| Script | الوظيفة |
|---|---|
| `npm run build` | تنظيف `dist/` ثم ترجمة TypeScript |
| `npm start` | تشغيل `dist/src/index.js` |
| `npm run dev` | تشغيل source عبر `ts-node` |
| `npm run deploy-commands` | مزامنة أوامر Discord global وguild |
| `npm run migrate` | نقل البيانات المحلية إلى Firestore |

## بنية المشروع

```text
src/                 TypeScript source
  commands/          Slash commands and UI handlers
  events/            Discord events
  handlers/          Command/event loading and deployment
  services/          Adhan, Quran, Khatma, DM and storage logic
  utils/             Logging and UI helpers
data/
  catalog/           Generated catalogs
  guilds/            Local JSON fallback
  raw/               Quran, adhkar, salawat and audio sources
scripts/             Build helper scripts
deploy-commands.ts   Discord command synchronization
```

## التقنيات

TypeScript، Node.js، discord.js v14، @discordjs/voice، Firebase Admin، node-cron، moment-timezone، @napi-rs/canvas وFFmpeg.

## الأمان

ملفات `.env` وFirebase الخاصة و`node_modules/` و`dist/` و`logs/` غير مخصصة للرفع إلى GitHub. لا تشارك token أو كلمات السر أو private keys.

## المطوّر

**رفيق الروح • المطوّر: يونس الحافلي • جزاكم الله خيراً ❤️**

## License

ISC
