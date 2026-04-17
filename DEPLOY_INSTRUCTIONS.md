# Инструкция по деплою обновленного Worker

## Что изменилось
Добавлено отладочное логирование в worker.js для диагностики проблемы с уведомлениями.

## Как задеплоить

### Вариант 1: Через Cloudflare Dashboard (рекомендуется)
1. Открой https://dash.cloudflare.com
2. Workers & Pages → mybex
3. Edit code
4. Скопируй содержимое файла `worker.js` из этого репозитория
5. Вставь в редактор
6. Save and Deploy

### Вариант 2: Через Wrangler CLI
```bash
npm install -g wrangler
wrangler login
wrangler deploy
```

## После деплоя

1. Открой сайт https://wob3x.github.io
2. Проверь логи Worker в реальном времени:
   - Dashboard → Workers → mybex → Logs → Begin log stream
3. Ищи строки с `[DEBUG]` и `[ERROR]`

## Что искать в логах

```
[DEBUG] handleVisit called
[DEBUG] Visit body: {...}
[DEBUG] Found X admin(s): [...]
[DEBUG] ADMIN_CHAT_ID env: 8123006269
[DEBUG] Sending to chat_id: 8123006269
[DEBUG] Telegram response for 8123006269: {...}
```

Если видишь `Found 0 admin(s)` — значит переменная ADMIN_CHAT_ID не установлена или пустая.

## Проверка переменных

Settings → Variables → убедись что есть:
- `ADMIN_CHAT_ID` = `8123006269` (без кавычек, plaintext)
- `BOT_TOKEN` = `8752602997:AAF7-T3RMSAawXCZoUD5Q9epqsPo9r2TKO4`
- `ALLOWED_ORIGINS` = `https://wob3x.github.io`

После изменения переменных обязательно нажми "Save and Deploy".
