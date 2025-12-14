// api/chat.js
// Chat endpoint s RAG systémom pre XML produkty z Redis

import { searchProducts, getProductsMetadata, getAllCategories } from '../redisClient.js';

// RAG konfigurácia
const STOP_WORDS = new Set([
  'a', 'je', 'to', 'na', 'v', 'sa', 'so', 'pre', 'ako', 'že', 'ma', 'mi', 'me', 'si', 'su', 'som',
  'ale', 'ani', 'az', 'ak', 'bo', 'by', 'co', 'ci', 'do', 'ho', 'im', 'ju', 'ka', 'ku',
  'ne', 'ni', 'no', 'od', 'po', 'pri', 'ta', 'te', 'ti', 'tu', 'ty', 'uz', 'vo', 'za',
  'mate', 'mam', 'chcem', 'potrebujem', 'the', 'and', 'or', 'is', 'are', 'this', 'that'
]);

const SYNONYMS = {
  'cena': ['cenny', 'ceny', 'kolko', 'stoji', 'price', 'eur', 'euro', 'cennik'],
  'produkt': ['tovar', 'vyrobok', 'artikl', 'polozka', 'item', 'produkty', 'sortiment'],
  'dostupny': ['skladom', 'dispozicii', 'sklade', 'available', 'mame', 'dostupnost', 'dostupne'],
  'zlava': ['akcia', 'discount', 'sale', 'zlacnene', 'promo', 'kupon', 'vypredaj'],
  'kupit': ['objednat', 'nakupit', 'buy', 'purchase', 'order', 'kosik'],
  'hladat': ['najst', 'vyhladat', 'search', 'find', 'kde', 'aky', 'ktory', 'odporucit', 'poradit'],
  'velkost': ['size', 'rozmer', 'cislo', 'velkosti', 'sizes', 'ml', 'gram', 'kg', 'liter'],
  'farba': ['color', 'colour', 'odtien', 'farby', 'farebny'],
  'doprava': ['dorucenie', 'shipping', 'delivery', 'postovne', 'zasielka', 'kurier'],
  // Drogéria špecifické synonymá
  'drogeria': ['kozmetika', 'hygena', 'cistitace', 'mydlo', 'sampon', 'krem', 'drogerie'],
  'cistenie': ['cistit', 'upratovanie', 'upratovat', 'cistitace', 'dezinfekcia', 'umyvanie'],
  'pranie': ['prat', 'pracie', 'prasok', 'gel', 'avivaž', 'avivaz', 'pradlo'],
  'kozmetika': ['makeup', 'krem', 'plet', 'tvar', 'oci', 'pery', 'ruz', 'maskara'],
  'vlasy': ['sampon', 'kondicioner', 'lak', 'gel', 'farba', 'farbenie'],
  'telo': ['sprchovy', 'telove', 'mleko', 'olej', 'hydratacia', 'starostlivost'],
  'zuby': ['zubna', 'pasta', 'kefka', 'ustna', 'voda', 'nit'],
  'parfem': ['parfum', 'vona', 'deodorant', 'antiperspirant', 'toaletna'],
  'deti': ['detsky', 'baby', 'dieta', 'kojenec', 'plienky', 'puder'],
  'domacnost': ['wc', 'kuchyna', 'podlaha', 'okna', 'sklo', 'nabytok']
};

const INTENT_PATTERNS = {
  'count_query': ['kolko', 'pocet', 'celkom', 'vsetky', 'vsetko', 'vsetkych', 'kolko mate'],
  'price_query': ['cena', 'kolko stoji', 'za kolko', 'cennik', 'price'],
  'availability_query': ['skladom', 'dostupny', 'dostupne', 'mame', 'je k dispozicii'],
  'category_query': ['kategoria', 'kategorie', 'druhy', 'typy', 'sortiment', 'ponuka'],
  'discount_query': ['zlava', 'akcia', 'zlacnene', 'vypredaj', 'promo'],
  'recommendation_query': ['odporuc', 'porad', 'navrhni', 'najlepsie', 'top', 'popularny', 'co mi'],
  'cleaning_query': ['cistenie', 'upratovanie', 'umyvanie', 'dezinfekcia'],
  'cosmetics_query': ['kozmetika', 'makeup', 'krem', 'plet', 'vlasy', 'sampon']
};

export default async function handler(req, res) {
  const API_KEY = process.env.API_KEY;

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { messages, ragContext = '' } = req.body;

  try {
    let enhancedMessages = [...messages];
    const lastUserMessage = getLastUserMessage(messages);
    
    // RAG: Vyhľadaj relevantné produkty z Redis
    const ragResult = await processWithRAG(lastUserMessage);
    console.log('🧠 RAG Result:', {
      intent: ragResult.intent,
      matchedProducts: ragResult.products.length,
      topScore: ragResult.products[0]?.score || 0
    });
    
    // Vytvor kontext pre AI
    let productContext = ragResult.context;
    
    // Kombinuj s existujúcim RAG kontextom
    let combinedContext = productContext;
    if (ragContext) {
      combinedContext += `\n\nĎALŠIE INFORMÁCIE:\n${ragContext}`;
    }
    
    // Vlož kontext pred poslednú user správu
    if (combinedContext) {
      let lastUserIndex = -1;
      for (let i = enhancedMessages.length - 1; i >= 0; i--) {
        if (enhancedMessages[i]?.role === 'user') {
          lastUserIndex = i;
          break;
        }
      }

      if (lastUserIndex !== -1) {
        enhancedMessages.splice(lastUserIndex, 0, {
          role: 'system',
          content: `DÔLEŽITÉ - Použi PRESNE tieto informácie o produktoch:\n\n${combinedContext}\n\nPRAVIDLÁ:\n- Uvádzaj IBA ceny z tohto kontextu\n- Pri každom produkte uveď presnú cenu a dostupnosť\n- Ak produkt nie je v zozname, povedz že ho nemáme alebo ho nevieme nájsť\n- Nedomýšľaj si ceny ani produkty\n- Odpovedaj v slovenčine`
        });
      }
    }

    console.log(`📤 Sending ${enhancedMessages.length} messages to API`);

    const response = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: enhancedMessages,
        temperature: 0.3,
        max_tokens: 1000,
        stream: false
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API responded with status ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    
    // Debug info
    data._debug = {
      intent: ragResult.intent,
      matchedProducts: ragResult.products.length,
      topProducts: ragResult.products.slice(0, 3).map(p => ({ title: p.title, score: p.score })),
      contextLength: combinedContext?.length || 0
    };
    
    res.status(200).json(data);
  } catch (error) {
    console.error("API Error:", error);
    res.status(500).json({ error: "Internal Server Error", details: error.message });
  }
}

// Získanie poslednej user správy
function getLastUserMessage(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === 'user') {
      return messages[i].content;
    }
  }
  return '';
}

// RAG spracovanie s Redis
async function processWithRAG(query) {
  console.log('🧠 RAG processing query:', query);
  
  try {
    // Získaj metadáta
    const metadata = await getProductsMetadata();
    console.log(`📊 Products in database: ${metadata.count}, Last update: ${metadata.lastUpdate}`);
    
    if (!metadata.count || metadata.count === 0) {
      return { 
        intent: null, 
        products: [], 
        context: '⚠️ Produktová databáza je prázdna. Prosím, spustite sync.' 
      };
    }

    // Detekuj intent
    const intent = detectIntent(query);
    console.log('🎯 Detected intent:', intent);

    // Vyhľadaj produkty pomocou inverzného indexu
    const products = await searchProducts(query, 15);
    console.log('📊 Found products:', products.length);

    // Vytvor kontext podľa intentu
    const context = await buildContext(intent, products, metadata, query);

    return {
      intent,
      products,
      context
    };
  } catch (error) {
    console.error('RAG Error:', error);
    return { intent: null, products: [], context: '' };
  }
}

// Detekcia intentu
function detectIntent(query) {
  const normalized = normalizeText(query);
  
  for (const [intent, patterns] of Object.entries(INTENT_PATTERNS)) {
    if (patterns.some(p => normalized.includes(p))) {
      return intent;
    }
  }
  return 'general_query';
}

// Vytvorenie kontextu pre AI
async function buildContext(intent, products, metadata, query) {
  let context = `📊 E-SHOP ŠTATISTIKY:\n`;
  context += `- Celkom produktov v databáze: ${metadata.count}\n`;
  context += `- Posledná aktualizácia: ${metadata.lastUpdate}\n\n`;

  // Pre kategórie - zobraz dostupné kategórie
  if (intent === 'category_query') {
    try {
      const categories = await getAllCategories();
      context += `📁 DOSTUPNÉ KATEGÓRIE:\n`;
      categories.slice(0, 20).forEach(cat => {
        context += `- ${cat.name} (${cat.count} produktov)\n`;
      });
      context += `\n`;
    } catch (e) {
      console.warn('Could not fetch categories:', e);
    }
  }

  // Zobraz nájdené produkty
  if (products.length > 0) {
    context += `🎯 NÁJDENÉ PRODUKTY (zoradené podľa relevancie):\n\n`;
    
    products.forEach((product, index) => {
      context += `${index + 1}. **${product.title}**`;
      if (product.score > 0) {
        context += ` [skóre: ${product.score}]`;
      }
      context += `\n`;
      
      // Cena
      if (product.has_discount && product.sale_price) {
        context += `   💰 Cena: €${product.sale_price.toFixed(2)} (pôvodne €${product.price.toFixed(2)}, zľava ${product.discount_percentage}%)\n`;
      } else {
        context += `   💰 Cena: €${product.price.toFixed(2)}\n`;
      }
      
      // Dostupnosť
      context += `   📦 Dostupnosť: ${product.available ? '✅ SKLADOM' : '❌ NEDOSTUPNÉ'}`;
      if (product.stock_quantity > 0) {
        context += ` (${product.stock_quantity} ks)`;
      }
      context += `\n`;
      
      // Kategória a značka
      if (product.category) {
        context += `   📁 Kategória: ${product.category}\n`;
      }
      if (product.brand) {
        context += `   🏷️ Značka: ${product.brand}\n`;
      }
      
      // Popis (skrátený)
      if (product.description) {
        const shortDesc = product.description.substring(0, 150);
        context += `   📝 ${shortDesc}${product.description.length > 150 ? '...' : ''}\n`;
      }
      
      // URL
      if (product.url) {
        context += `   🔗 ${product.url}\n`;
      }
      
      context += `\n`;
    });
  } else {
    context += `❌ Pre dotaz "${query}" neboli nájdené žiadne produkty.\n`;
    context += `Skúste upraviť vyhľadávacie slová alebo sa opýtať na kategóriu.\n`;
  }

  return context;
}

// Normalizácia textu
function normalizeText(text) {
  return (text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
