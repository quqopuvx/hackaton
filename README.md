# Agent Lab — стартер для хакатона с ИИ-агентами

Vue 3 + Vite + TypeScript + Tailwind CSS. Готовый каркас: чат с агентом, цикл «модель → инструмент → модель», трассировка шагов, простая база сущностей и смена LLM-провайдера одной переменной окружения.

**Работает сразу, без ключей и интернета** — в демо-режиме `AI_PROVIDER=mock`.

## Быстрый старт

Нужны Node.js **20.19+** и npm.

```bash
npm install
Copy-Item .env.example .env.local   # PowerShell; в macOS/Linux: cp .env.example .env.local
npm run dev
```

Откройте http://localhost:5173. В dev-режиме API (`/api/agent`, `/api/items`, `/api/health`)поднимается внутри Vite.

Продакшен-режим (один Node-процесс раздаёт фронтенд и API):

```bash
npm run build
npm start              # http://localhost:3000, порт меняется через PORT
```

Проверка типов: `npm run typecheck`.

## Что внутри

| Файл | Зачем |
| --- | --- |
| `config/domain.ts` | Название кейса, системный промпт, быстрые промпты, названия сущности. **Меняете первым.** |
| `lib/ai/agent.ts` | Цикл агента: вызов модели → выполнение инструментов → новый вызов. Лимит шагов, трассировка. |
| `lib/ai/tools.ts` | Инструменты агента: калькулятор, CRUD сущности, демо-поиск, время. **Добавляете свои задачи здесь.** |
| `lib/ai/providers.ts` | Провайдеры LLM: mock, OpenAI-совместимые, GigaChat, YandexGPT. |
| `lib/store.ts` | Демо-хранение в памяти. Интерфейс легко заменить на Supabase/Neon. |
| `server/handler.ts` | HTTP-роуты API. Ключи читаются только на сервере. |
| `src/App.vue` | Компоновка экрана и состояние чата. |
| `src/components/*` | Чат, таблица сущностей, трассировка. |
| `docs/PLAYBOOK.md` | Чек-лист на день хакатона и структура питча. |

## Внешний вид

Правила интерфейса зафиксированы в `.stitch/DESIGN.md`. Это адаптация стандарта `taste-design` из репозитория [google-labs-code/stitch-skills](https://github.com/google-labs-code/stitch-skills): светлый холст, один акцент `#3B82F6` без свечения, Manrope для русского текста и Geist Mono для метаданных (поставляются локально через `@fontsource`, работают офлайн), скелетоны вместо спиннеров, пружинные отклики и каскадное появление списков.

Если позже подключите Stitch MCP, этот же `DESIGN.md` можно загрузить в Stitch через skill `manage-design-system` и генерировать новые экраны уже там. В OpenCode навыки ставятся вручную в `.opencode/skills/` (подробности — в README репозитория stitch-skills).

## Провайдеры LLM

В `.env.local` задайте `AI_PROVIDER`:

| Значение | Что нужно | Инструменты (tools) |
| --- | --- | --- |
| `mock` (по умолчанию) | ничего | да, демо-режим |
| `openai` | `OPENAI_API_KEY`; можно `OPENAI_BASE_URL` и `OPENAI_MODEL` | да |
| `gigachat` | `GIGACHAT_API_KEY`, при необходимости `GIGACHAT_BASE_URL` | да, если `AI_SUPPORTS_TOOLS=1` |
| `yandex` | `YANDEX_FOLDER_ID`, `YANDEX_API_KEY` | нет (только текст) |

Любой OpenAI-совместимый сервис (OpenRouter, локальная модель в LM Studio, vLLM) подключается через `AI_PROVIDER=openai` + свои `OPENAI_BASE_URL` / `OPENAI_MODEL`.

> **Никогда** не пишите ключи в `src/` и не добавляйте `.env.local` в Git — он уже в `.gitignore`.

## Что сделать после объявления кейса

1. Правим `config/domain.ts`: название, описание, системный промпт, быстрые промпты, название сущности.
2. В `lib/ai/tools.ts` добавляем 2–4 инструмента под кейс (вместо демо-поиска — реальный API/БД).
3. В `lib/store.ts` меняем хранилище на настоящее, если нужны данные между запусками.
4. В панели трассировки (`TracePanel`) проверяем, что агент действительно вызывает инструменты, а не выдумывает ответы.
5. Готовим питч по `docs/PLAYBOOK.md`.

## Работа командой

```bash
git checkout -b feature/<задача>
git add .
git commit -m "Добавил инструмент поиска"
git push origin feature/<задача>
# создаём Pull Request на GitHub и сливаем в main
```

Перед новой задачей: `git checkout main && git pull origin main`. Не коммитьте `node_modules`, `dist`, `.env.local`.

## Деплой

Самый простой вариант для хакатона — Render / Railway / Fly.io: они запускают `npm install && npm run build && npm start` и пробрасывают `PORT`. Переменные окружения задаются в панели хостинга.

Для Vercel/Netlify понадобится адаптер для Node-сервера или разделение на статический фронтенд + serverless API — если нужен именно такой вариант, скажите, переделаю под него.

## Ограничения стартера

- Хранилище в памяти: данные исчезают при перезапуске процесса.
- Ответы не стримятся: клиент ждёт полного ответа агента.
- Нет авторизации — добавьте её только если кейс этого требует.
- `mock_search` — заглушка, а не реальный поиск.
