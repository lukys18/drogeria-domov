// api/chat.js
// Konverzačný AI asistent pre Drogériu Domov
// Optimalizovaný pre poradenstvo a cielené odporúčania

import { searchProducts, getCategories, getBrands, getStats, getDiscountedProducts } from '../redisClient.js';

const DEEPSEEK_API_KEY = process.env.API_KEY;
const DEEPSEEK_API_URL = 'https://api.deepseek.com/v1/chat/completions';

// Systémový prompt pre konverzačného asistenta
const SYSTEM_PROMPT = `Si priateľský asistent online drogérie Drogéria Domov (drogeriadomov.sk).

KRITICKÉ PRAVIDLO:
Môžeš odporúčať IBA produkty, ktoré sú uvedené v sekcii "NÁJDENÉ PRODUKTY" v kontexte.
Ak tam nie sú žiadne produkty, NIKDY si ich nevymýšľaj - namiesto toho sa opýtaj zákazníka na spresnenie.

TVOJE ÚLOHY:
1. Pomáhaj zákazníkom nájsť produkty z ponuky
2. Pýtaj sa doplňujúce otázky ak je požiadavka príliš všeobecná
3. Odporúčaj max 3-5 produktov z kontextu

FORMÁT PRODUKTOV (použi LEN ak máš produkty v kontexte):
**[Názov z kontextu]** - [Cena z kontextu] €
[Popis]
Odkaz: [URL z kontextu - PRESNE ako je uvedený]

AK NEMÁŠ PRODUKTY V KONTEXTE:
- Povedz zákazníkovi, že pre lepšie výsledky potrebuješ viac informácií
- Opýtaj sa na značku, typ produktu, alebo účel použitia
- NEVYMÝŠĽAJ žiadne produkty ani značky

Odpovedaj VŽDY po slovensky, priateľsky a stručne.`;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { message, history = [] } = req.body;
  
  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'Message is required' });
  }

  if (!DEEPSEEK_API_KEY) {
    return res.status(500).json({ error: 'DeepSeek API not configured' });
  }

  try {
    // Analyzuj zámer používateľa
    const intent = analyzeIntent(message);
    console.log(`💬 Správa: "${message}" | Zámer: ${intent.type}`);
    
    // Získaj kontext na základe zámeru
    const context = await buildContext(message, intent);
    
    // Log pre debug
    console.log('📦 Context products:', context.products?.length || 0);
    if (context.products?.length > 0) {
      console.log('📦 First product:', context.products[0].title, '|', context.products[0].url);
    }
    
    // Vytvor správy pre AI
    const messages = buildMessages(message, history, context, intent);
    
    // Zavolaj DeepSeek API
    const response = await fetch(DEEPSEEK_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${DEEPSEEK_API_KEY}`
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: messages,
        temperature: 0.5,
        max_tokens: 1000
      })
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('DeepSeek error:', error);
      throw new Error('AI service error');
    }

    const data = await response.json();
    const reply = data.choices[0]?.message?.content || 'Prepáčte, nastala chyba.';

    return res.status(200).json({
      reply: reply,
      intent: intent.type,
      productsFound: context.products?.length || 0,
      _debug: {
        searchInfo: context.searchInfo,
        hasProducts: context.products?.length > 0
      }
    });

  } catch (error) {
    console.error('Chat error:', error);
    return res.status(500).json({ 
      error: 'Nastala chyba pri spracovaní',
      reply: 'Prepáčte, momentálne mám technické problémy. Skúste to prosím znovu.'
    });
  }
}

// Analýza zámeru používateľa
function analyzeIntent(message) {
  const lower = message.toLowerCase();
  
  // Pozdrav
  if (/^(ahoj|dobrý|čau|zdravím|hey|hi|nazdar)/i.test(lower)) {
    return { type: 'greeting' };
  }
  
  // Zľavy/akcie
  if (/zlav|akci|výpredaj|lacn|znížen|promo/i.test(lower)) {
    return { type: 'discounts' };
  }
  
  // Kategórie
  if (/kategór|sortiment|ponuk|máte|čo predávate/i.test(lower)) {
    return { type: 'categories' };
  }
  
  // Značky
  if (/značk|brand|výrobc/i.test(lower)) {
    return { type: 'brands' };
  }
  
  // Darček
  if (/darček|darovať|pre .*(mamu|otca|priateľ|manžel|dieťa|babičk)/i.test(lower)) {
    return { type: 'gift', needsMore: true };
  }
  
  // Všeobecné kategórie - potrebujú spresnenie
  const generalCategories = [
    'šampón', 'mydlo', 'krém', 'parfém', 'dezodorant', 'zubná', 
    'prací', 'čistiaci', 'kozmetik', 'makeup', 'rúž'
  ];
  
  for (const cat of generalCategories) {
    if (lower.includes(cat) && lower.split(' ').length < 5) {
      return { type: 'general_category', category: cat, needsMore: true };
    }
  }
  
  // Konkrétne vyhľadávanie
  if (lower.split(' ').length >= 2) {
    return { type: 'specific_search' };
  }
  
  return { type: 'general' };
}

// Vytvorenie kontextu pre AI
async function buildContext(message, intent) {
  const context = {
    products: [],
    categories: [],
    brands: [],
    stats: null,
    searchInfo: null
  };
  
  try {
    switch (intent.type) {
      case 'greeting':
        context.stats = await getStats();
        console.log('📊 Stats loaded:', context.stats?.productCount, 'products');
        break;
        
      case 'discounts':
        context.products = await getDiscountedProducts(5);
        console.log('💰 Discounted products:', context.products.length);
        break;
        
      case 'categories':
        context.categories = await getCategories();
        console.log('📂 Categories:', context.categories.length);
        break;
        
      case 'brands':
        context.brands = await getBrands();
        console.log('🏷️ Brands:', context.brands.length);
        break;
        
      case 'general_category':
      case 'specific_search':
      case 'gift':
      case 'general':
      default:
        // Vždy vyhľadaj produkty pre tieto zámery
        const result = await searchProducts(message, { limit: 5 });
        context.products = result.products;
        context.searchInfo = {
          total: result.total,
          matchedTerms: result.matchedTerms,
          query: result.query
        };
        console.log('🔍 Search results:', result.products.length, 'of', result.total, '| Terms:', result.matchedTerms);
        
        // Ak nenašiel nič, skús zjednodušený dotaz
        if (context.products.length === 0) {
          console.log('⚠️ No results, trying simplified search...');
          const words = message.split(/\s+/).filter(w => w.length >= 3);
          for (const word of words) {
            const fallback = await searchProducts(word, { limit: 5 });
            if (fallback.products.length > 0) {
              context.products = fallback.products;
              context.searchInfo = { total: fallback.total, matchedTerms: fallback.matchedTerms, query: word };
              console.log('✅ Fallback found:', fallback.products.length, 'for word:', word);
              break;
            }
          }
        }
        break;
    }
  } catch (error) {
    console.error('❌ Context build error:', error.message);
  }
  
  return context;
}

// Vytvorenie správ pre AI
function buildMessages(message, history, context, intent) {
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT }
  ];
  
  // Pridaj kontext
  let contextMessage = '';
  
  if (context.stats) {
    contextMessage = `INFORMÁCIE O OBCHODE:
- Počet produktov: ${context.stats.productCount}
- Hlavné kategórie: ${context.stats.topCategories.map(c => c.name).join(', ')}
- Top značky: ${context.stats.topBrands.map(b => b.name).join(', ')}`;
  }
  
  if (context.products && context.products.length > 0) {
    contextMessage = `NÁJDENÉ PRODUKTY (${context.products.length} z ${context.searchInfo?.total || '?'}):

${context.products.map((p, i) => `${i + 1}. **${p.title}**
   Značka: ${p.brand || 'neuvedená'}
   Kategória: ${p.categoryMain}
   Cena: ${p.salePrice ? `~~${p.price}€~~ **${p.salePrice}€** (-${p.discountPercent}%)` : `${p.price}€`}
   ${p.description ? `Popis: ${p.description.substring(0, 100)}...` : ''}
   URL: ${p.url}`).join('\n\n')}`;
  }
  
  if (context.categories && context.categories.length > 0) {
    contextMessage = `KATEGÓRIE V OBCHODE:
${context.categories.slice(0, 10).map(c => `- ${c.name} (${c.count} produktov)`).join('\n')}`;
  }
  
  if (context.brands && context.brands.length > 0) {
    contextMessage = `ZNAČKY V OBCHODE:
${context.brands.slice(0, 15).map(b => `- ${b.name} (${b.count} produktov)`).join('\n')}`;
  }
  
  // Ak nemáme produkty ani iný kontext, upozorni AI
  if (!contextMessage && intent.type !== 'greeting') {
    contextMessage = `UPOZORNENIE: Pre dotaz "${message}" som nenašiel žiadne produkty v databáze.
Povedz zákazníkovi, že si neistý a opýtaj sa na upresnenie požiadavky.
NIKDY nevymýšľaj produkty - povedz že v danej kategórii môžeš vyhľadať, ak upresnia čo hľadajú.`;
  }
  
  if (contextMessage) {
    console.log('📝 Context message length:', contextMessage.length);
    messages.push({
      role: 'system',
      content: `DÔLEŽITÉ - KONTEXT PRE TÚTO ODPOVEĎ:\n${contextMessage}\n\n${intent.needsMore ? 'POZNÁMKA: Zákazník má všeobecnú požiadavku. Opýtaj sa na spresnenie pred odporúčaním produktov.' : 'Odporúč LEN produkty z tohto kontextu!'}`
    });
  }
  
  // Pridaj históriu (max posledných 6 správ)
  const recentHistory = history.slice(-6);
  for (const msg of recentHistory) {
    messages.push({
      role: msg.role === 'user' ? 'user' : 'assistant',
      content: msg.content
    });
  }
  
  // Pridaj aktuálnu správu
  messages.push({ role: 'user', content: message });
  
  return messages;
}
