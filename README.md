# E-shop AI Chatbot s XML RAG systémom

AI chatbot pre e-shop s RAG (Retrieval-Augmented Generation) systémom, ktorý automaticky synchronizuje produkty z XML feedu a poskytuje inteligentné odpovede zákazníkom.

## 🚀 Funkcie

- ✅ Automatická synchronizácia produktov z XML feedu (cron každý deň o 6:00)
- ✅ Inverzný index pre rýchle vyhľadávanie v 26 000+ produktoch
- ✅ RAG systém s inteligentným skórovaním relevancie
- ✅ AI chatbot s DeepSeek API
- ✅ Upstash Redis pre perzistentnú cache
- ✅ Vercel serverless deployment

## 📋 Požiadavky

- Vercel účet (zadarmo na [vercel.com](https://vercel.com))
- Upstash Redis účet (zadarmo na [upstash.com](https://upstash.com))
- DeepSeek API kľúč (na [platform.deepseek.com](https://platform.deepseek.com))

## 🔧 Inštalácia

1. **Klonujte repozitár a nainštalujte závislosti:**

```bash
git clone <repo-url>
cd test-eshop-bot
npm install
```

2. **Nastavte environment premenné na Vercel:**

V Vercel Dashboard → Settings → Environment Variables pridajte:

```env
XML_URL=https://www.drogeriadomov.sk/export/products.xml
KV_REST_API_URL=https://your-redis.upstash.io
KV_REST_API_TOKEN=your_token_here
API_KEY=your-deepseek-api-key
```

3. **Nasaďte na Vercel:**

```bash
vercel deploy --prod
```

## 📊 Ako to funguje

### Architektúra

```
┌─────────────────────────────────────────────────────────────┐
│                    XML RAG SYSTÉM                            │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│   XML Feed (26k+ produktov)                                 │
│        │                                                     │
│        ▼ (Vercel Cron - každý deň o 6:00)                   │
│   ┌────────────────┐                                        │
│   │ /api/syncXML   │  ─── Parsuje XML, vytvára indexy       │
│   └───────┬────────┘                                        │
│           │                                                  │
│           ▼                                                  │
│   ┌────────────────────────────────────────┐                │
│   │         UPSTASH REDIS                   │                │
│   ├────────────────────────────────────────┤                │
│   │ • product:{id} - jednotlivé produkty   │                │
│   │ • index:words - inverzný slovný index  │                │
│   │ • index:categories - kategórie         │                │
│   │ • index:brands - značky                │                │
│   └────────────────────────────────────────┘                │
│           │                                                  │
│           ▼                                                  │
│   ┌────────────────┐      ┌────────────────┐                │
│   │ /api/chat      │ ──── │ DeepSeek AI    │                │
│   │ (RAG Search)   │      │                │                │
│   └────────────────┘      └────────────────┘                │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### Cron Job

Vercel automaticky spúšťa `/api/syncXML` každý deň o 6:00 UTC. Môžete to zmeniť v `vercel.json`:

```json
{
  "crons": [
    {
      "path": "/api/syncXML",
      "schedule": "0 6 * * *"
    }
  ]
}
```

### Manuálny Sync

Môžete spustiť sync manuálne cez GET request:

```bash
curl https://your-app.vercel.app/api/syncXML
```

## 🔑 API Endpoints

| Endpoint | Metóda | Popis |
|----------|--------|-------|
| `/api/syncXML` | GET | Synchronizuje produkty z XML do Redis |
| `/api/chat` | POST | Chat endpoint s RAG systémom |
| `/api/saveChat` | POST | Ukladá históriu chatov |

## 📁 Štruktúra projektu

```
test-eshop-bot/
├── api/
│   ├── chat.js          # Chat endpoint s RAG
│   ├── syncXML.js       # XML sync s inverzným indexom
│   └── saveChat.js      # Ukladanie chatov
├── redisClient.js       # Redis klient s vyhľadávaním
├── rag-system.js        # RAG systém pre frontend
├── chatbot-widget.js    # Frontend chatbot widget
├── bot.css              # Štýly chatbotu
├── index.html           # Demo stránka
├── vercel.json          # Vercel konfigurácia s cron
├── package.json         # Závislosti
└── .env.example         # Vzorové env premenné
```

## 🔍 Vyhľadávací algoritmus

1. **Inverzný index** - pre každé slovo z názvu/popisu ukladáme zoznam ID produktov
2. **Fuzzy matching** - hľadá čiastočné zhody slov
3. **Skórovanie** - presná zhoda = 10 bodov, čiastočná = 5 bodov
4. **Kategorizácia** - rýchly prístup podľa kategórie/značky

## 🐛 Riešenie problémov

**Sync zlyhá na timeout:**
- XML je príliš veľké, skontrolujte `maxDuration` vo `vercel.json`
- Pre Vercel Pro/Enterprise je max 300s

**Žiadne produkty:**
- Skontrolujte XML_URL
- Overte štruktúru XML v `extractProducts()` funkcii

**Redis chyby:**
- Skontrolujte KV_REST_API_URL a KV_REST_API_TOKEN

## 📝 Licencia

ISC
