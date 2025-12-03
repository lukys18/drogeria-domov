export default async function handler(req, res) {
  const API_KEY = process.env.API_KEY;
  const SHOPIFY_STORE_URL = process.env.SHOPIFY_STORE_URL;
  const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { 
    messages, 
    useRAG = false, 
    ragContext = '', 
    sources = [],
    productContext = '',
    isProductQuery = false
  } = req.body;

  try {
    let enhancedMessages = [...messages];
    let shopifyProductContext = productContext;
    
    // Ak je to produktový dotaz a máme Shopify credentials, načítaj produkty
    if (isProductQuery && SHOPIFY_STORE_URL && SHOPIFY_ACCESS_TOKEN && !productContext) {
      try {
        shopifyProductContext = await fetchShopifyContext(
          SHOPIFY_STORE_URL, 
          SHOPIFY_ACCESS_TOKEN, 
          getLastUserMessage(messages)
        );
        console.log('Shopify context fetched successfully');
      } catch (shopifyError) {
        console.warn('Could not fetch Shopify data:', shopifyError.message);
      }
    }
    
    // Kombinuj RAG kontext s produktovým kontextom
    let combinedContext = '';
    if (shopifyProductContext) {
      combinedContext += `PRODUKTY ZO SHOPIFY:\n${shopifyProductContext}\n\n`;
    }
    if (ragContext) {
      combinedContext += `INFORMÁCIE Z DATABÁZY:\n${ragContext}`;
    }
    
    // Ak je povolený RAG alebo máme produktový kontext, vlož ho
    if ((useRAG && ragContext) || shopifyProductContext) {
      let lastUserIndex = -1;
      for (let i = enhancedMessages.length - 1; i >= 0; i--) {
        if (enhancedMessages[i] && enhancedMessages[i].role === 'user') {
          lastUserIndex = i;
          break;
        }
      }

      if (lastUserIndex !== -1 && combinedContext) {
        enhancedMessages.splice(lastUserIndex, 0, {
          role: 'system',
          content: `Relevantný kontext:\n${combinedContext}\n\nPoužite tento kontext na zodpovedanie nadchádzajúcej otázky používateľa. Pri produktoch vždy uveď cenu, dostupnosť a prípadné zľavy.`
        });
        console.log(`Kontext vložený pred správu na indexe ${lastUserIndex}. Zdroje:`, sources);
      }
    }

    console.log(`Posielam ${enhancedMessages.length} správ do API (vrátane ${useRAG ? 'RAG kontextu' : 'bez RAG'}${shopifyProductContext ? ' + Shopify dáta' : ''})`);

    const response = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: enhancedMessages,
        temperature: 0.4,
        max_tokens: 800,
        stream: false
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API responded with status ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    
    res.status(200).json(data);
  } catch (error) {
    console.error("API Error:", error);
    res.status(500).json({ 
      error: "Internal Server Error",
      details: error.message 
    });
  }
}

// Pomocná funkcia pre získanie poslednej user správy
function getLastUserMessage(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i] && messages[i].role === 'user') {
      return messages[i].content;
    }
  }
  return '';
}

// Funkcia pre načítanie Shopify kontextu
async function fetchShopifyContext(storeUrl, accessToken, query) {
  try {
    // Načítaj produkty zo Shopify
    const response = await fetch(`https://${storeUrl}/admin/api/2024-01/products.json?limit=100&status=active`, {
      method: 'GET',
      headers: {
        'X-Shopify-Access-Token': accessToken,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`Shopify API error: ${response.status}`);
    }

    const data = await response.json();
    const products = data.products || [];

    if (products.length === 0) {
      return '';
    }

    // Jednoduchý search v produktoch
    const normalizedQuery = query.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    
    // Filtrovanie produktov podľa dotazu
    let relevantProducts = products.filter(product => {
      const title = (product.title || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      const description = (product.body_html || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      const tags = (product.tags || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      const productType = (product.product_type || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      
      // Rozdelíme dotaz na slová a hľadáme zhody
      const queryWords = normalizedQuery.split(/\s+/).filter(w => w.length > 2);
      
      return queryWords.some(word => 
        title.includes(word) || 
        description.includes(word) || 
        tags.includes(word) ||
        productType.includes(word)
      );
    });

    // Ak nemáme relevantné produkty, vrátime top 10
    if (relevantProducts.length === 0) {
      relevantProducts = products.slice(0, 10);
    } else {
      relevantProducts = relevantProducts.slice(0, 10);
    }

    // Formátuj produkty pre kontext
    return formatProductsForAI(relevantProducts);
  } catch (error) {
    console.error('Shopify fetch error:', error);
    return '';
  }
}

// Formátovanie produktov pre AI kontext
function formatProductsForAI(products) {
  return products.map((product, index) => {
    const mainVariant = product.variants?.[0] || {};
    const price = parseFloat(mainVariant.price || 0);
    const compareAtPrice = parseFloat(mainVariant.compare_at_price || 0);
    const hasDiscount = compareAtPrice > price;
    const available = product.variants?.some(v => v.available !== false && (v.inventory_quantity > 0 || v.inventory_policy === 'continue')) || false;
    const totalInventory = product.variants?.reduce((sum, v) => sum + (v.inventory_quantity || 0), 0) || 0;

    let info = `${index + 1}. **${product.title}**`;
    
    if (hasDiscount) {
      const discountPercent = Math.round((1 - price / compareAtPrice) * 100);
      info += `\n   Cena: ~~€${compareAtPrice}~~ **€${price}** (-${discountPercent}% ZĽAVA!)`;
    } else {
      info += `\n   Cena: €${price}`;
    }
    
    info += `\n   Dostupnosť: ${available ? `✅ Skladom (${totalInventory} ks)` : '❌ Vypredané'}`;
    
    if (product.product_type) {
      info += `\n   Kategória: ${product.product_type}`;
    }
    
    if (product.vendor) {
      info += `\n   Značka: ${product.vendor}`;
    }

    // Varianty
    if (product.variants && product.variants.length > 1) {
      const availableVariants = product.variants.filter(v => v.inventory_quantity > 0 || v.inventory_policy === 'continue');
      if (availableVariants.length > 0) {
        info += `\n   Dostupné varianty: ${availableVariants.map(v => v.title).join(', ')}`;
      }
    }

    // Skrátený popis
    if (product.body_html) {
      const cleanDesc = product.body_html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
      const shortDesc = cleanDesc.substring(0, 100);
      info += `\n   Popis: ${shortDesc}${cleanDesc.length > 100 ? '...' : ''}`;
    }

    return info;
  }).join('\n\n');
}
