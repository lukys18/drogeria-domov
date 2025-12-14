// api/syncXML.js
// Vercel Serverless Function pre synchronizáciu XML produktov do Upstash Redis
// Spúšťa sa cez Vercel Cron každý deň

import axios from 'axios';
import xml2js from 'xml2js';
import { Redis } from '@upstash/redis';

// Konfigurácia
const BATCH_SIZE = 100; // Počet produktov na batch
const INDEX_BATCH_SIZE = 500; // Počet slov na index batch

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Len GET alebo POST (pre manuálny trigger)
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const XML_URL = process.env.XML_URL;
  const UPSTASH_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const UPSTASH_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!XML_URL) {
    return res.status(500).json({ error: 'XML_URL not configured' });
  }

  if (!UPSTASH_URL || !UPSTASH_TOKEN) {
    return res.status(500).json({ error: 'Upstash Redis not configured' });
  }

  // Inicializácia Redis klienta
  const redis = new Redis({
    url: UPSTASH_URL,
    token: UPSTASH_TOKEN,
  });

  const isCronJob = req.headers['x-vercel-cron'] === '1';
  console.log(isCronJob ? '⏰ Cron job spustený' : '🔄 Manuálny sync spustený');

  try {
    const startTime = Date.now();

    // 1. Stiahni a parsuj XML
    console.log(`📥 Sťahujem XML z: ${XML_URL}`);
    const xmlData = await fetchAndParseXML(XML_URL);
    
    // 2. Extrahuj produkty
    const rawProducts = extractProducts(xmlData);
    console.log(`📦 Extrahovaných ${rawProducts.length} produktov`);

    if (rawProducts.length === 0) {
      return res.status(400).json({ 
        error: 'No products found in XML',
        hint: 'Check XML structure or URL'
      });
    }

    // 3. Transformuj produkty do nášho formátu
    const products = rawProducts.map(transformProduct);
    console.log(`✅ Transformovaných ${products.length} produktov`);

    // 4. Ulož produkty do Redis v dávkach
    console.log('💾 Ukladám produkty do Redis...');
    await saveProductsToRedis(redis, products);

    // 5. Vytvor inverzný index pre rýchle vyhľadávanie
    console.log('🔍 Vytváram vyhľadávací index...');
    await buildSearchIndex(redis, products);

    // 6. Ulož metadáta
    const timestamp = new Date().toISOString();
    await redis.set('products:last_update', timestamp);
    await redis.set('products:count', products.length);

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`✅ Sync dokončený za ${duration}s`);

    return res.status(200).json({
      success: true,
      message: `Synced ${products.length} products`,
      timestamp,
      duration: `${duration}s`,
      source: isCronJob ? 'cron' : 'manual'
    });

  } catch (error) {
    console.error('❌ Sync error:', error);
    return res.status(500).json({ 
      error: 'Sync failed', 
      details: error.message 
    });
  }
}

// Stiahnutie a parsovanie XML
async function fetchAndParseXML(url) {
  const response = await axios.get(url, {
    timeout: 60000, // 60 sekúnd timeout pre veľké XML
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    },
    maxContentLength: 100 * 1024 * 1024, // Max 100MB
  });

  const parser = new xml2js.Parser({
    explicitArray: false,
    ignoreAttrs: false,
    mergeAttrs: true
  });

  return parser.parseStringPromise(response.data);
}

// Extrakcia produktov z XML štruktúry
function extractProducts(xmlData) {
  // RSS feed štruktúra (drogeriadomov.sk)
  if (xmlData.rss && xmlData.rss.channel) {
    const channel = xmlData.rss.channel;
    if (channel.item) {
      return Array.isArray(channel.item) ? channel.item : [channel.item];
    }
  }
  
  // Alternatívne štruktúry
  if (xmlData.root && xmlData.root.product) {
    return Array.isArray(xmlData.root.product) ? xmlData.root.product : [xmlData.root.product];
  }
  if (xmlData.products && xmlData.products.product) {
    return Array.isArray(xmlData.products.product) ? xmlData.products.product : [xmlData.products.product];
  }
  if (xmlData.feed && xmlData.feed.entry) {
    return Array.isArray(xmlData.feed.entry) ? xmlData.feed.entry : [xmlData.feed.entry];
  }
  if (xmlData.SHOP && xmlData.SHOP.SHOPITEM) {
    return Array.isArray(xmlData.SHOP.SHOPITEM) ? xmlData.SHOP.SHOPITEM : [xmlData.SHOP.SHOPITEM];
  }

  console.warn('Unknown XML structure, keys:', Object.keys(xmlData));
  return [];
}

// Transformácia produktu do jednotného formátu
function transformProduct(rawProduct) {
  // Získaj ID - skús rôzne možnosti
  const id = rawProduct['g:id'] || rawProduct.id || rawProduct.ID || 
             rawProduct.ITEM_ID || rawProduct.code || rawProduct.CODE ||
             `product_${Math.random().toString(36).substr(2, 9)}`;

  // Získaj názov
  const title = rawProduct['g:title'] || rawProduct.title || rawProduct.PRODUCT || 
                rawProduct.name || rawProduct.NAME || rawProduct.PRODUCTNAME || '';

  // Získaj popis
  const description = stripHtml(
    rawProduct['g:description'] || rawProduct.description || rawProduct.DESCRIPTION || 
    rawProduct.DESCRIPTION_SHORT || rawProduct.content || ''
  );

  // Získaj cenu
  const priceStr = rawProduct['g:price'] || rawProduct.price || rawProduct.PRICE || 
                   rawProduct.PRICE_VAT || '0';
  const price = parseFloat(String(priceStr).replace(/[^\d.,]/g, '').replace(',', '.')) || 0;

  // Pôvodná cena (pre zľavu)
  const salePriceStr = rawProduct['g:sale_price'] || rawProduct.sale_price || 
                       rawProduct.STANDARD_PRICE || rawProduct.compareAtPrice || null;
  const salePrice = salePriceStr ? 
    parseFloat(String(salePriceStr).replace(/[^\d.,]/g, '').replace(',', '.')) : null;

  // Kategória
  const category = rawProduct['g:product_type'] || rawProduct['g:google_product_category'] ||
                   rawProduct.category || rawProduct.CATEGORY || rawProduct.CATEGORYTEXT || '';

  // Značka
  const brand = rawProduct['g:brand'] || rawProduct.brand || rawProduct.BRAND || 
                rawProduct.MANUFACTURER || rawProduct.vendor || '';

  // Dostupnosť
  const availabilityRaw = rawProduct['g:availability'] || rawProduct.availability || 
                          rawProduct.AVAILABILITY || rawProduct.stock || 'in stock';
  const available = String(availabilityRaw).toLowerCase().includes('in stock') || 
                    String(availabilityRaw).toLowerCase().includes('available') ||
                    String(availabilityRaw) === '1' || String(availabilityRaw) === 'true';

  // Obrázok
  const image = rawProduct['g:image_link'] || rawProduct['g:image'] || rawProduct.image ||
                rawProduct.IMGURL || rawProduct.imageUrl || rawProduct.IMAGE || null;

  // URL produktu
  const url = rawProduct['g:link'] || rawProduct.link || rawProduct.URL || 
              rawProduct.url || rawProduct.PRODUCT_URL || null;

  // EAN/GTIN
  const ean = rawProduct['g:gtin'] || rawProduct.ean || rawProduct.EAN || 
              rawProduct.gtin || rawProduct.GTIN || null;

  // Množstvo na sklade
  const stockQuantity = parseInt(rawProduct.quantity || rawProduct.STOCK_QUANTITY || 
                                 rawProduct.stock_quantity || rawProduct.COUNT || '0') || 0;

  return {
    id: String(id),
    title: String(title).trim(),
    description: String(description).substring(0, 500), // Max 500 znakov
    price,
    sale_price: salePrice,
    has_discount: salePrice && salePrice < price,
    discount_percentage: salePrice && salePrice < price ? 
      Math.round((1 - salePrice / price) * 100) : 0,
    category: String(category).trim(),
    brand: String(brand).trim(),
    available,
    stock_quantity: stockQuantity,
    image,
    url,
    ean,
    currency: 'EUR'
  };
}

// Uloženie produktov do Redis
async function saveProductsToRedis(redis, products) {
  const pipeline = redis.pipeline();
  
  // Vymaž staré produkty
  const oldIds = await redis.smembers('products:all_ids');
  if (oldIds && oldIds.length > 0) {
    // Vymaž v dávkach
    for (let i = 0; i < oldIds.length; i += BATCH_SIZE) {
      const batch = oldIds.slice(i, i + BATCH_SIZE);
      for (const id of batch) {
        pipeline.del(`product:${id}`);
      }
    }
    pipeline.del('products:all_ids');
  }
  
  // Ulož nové produkty
  const productIds = [];
  for (let i = 0; i < products.length; i += BATCH_SIZE) {
    const batch = products.slice(i, i + BATCH_SIZE);
    
    for (const product of batch) {
      pipeline.set(`product:${product.id}`, JSON.stringify(product));
      productIds.push(product.id);
    }
    
    // Vykonaj pipeline každých BATCH_SIZE produktov
    if (i % (BATCH_SIZE * 5) === 0 && i > 0) {
      await pipeline.exec();
      console.log(`  💾 Uložených ${Math.min(i + BATCH_SIZE, products.length)}/${products.length} produktov`);
    }
  }
  
  // Ulož zoznam všetkých ID
  if (productIds.length > 0) {
    pipeline.sadd('products:all_ids', ...productIds);
  }
  
  await pipeline.exec();
  console.log(`  ✅ Všetky produkty uložené`);
}

// Vytvorenie inverzného indexu pre rýchle vyhľadávanie
async function buildSearchIndex(redis, products) {
  const index = new Map(); // slovo -> Set(productIds)
  const categoryIndex = new Map(); // kategória -> Set(productIds)
  const brandIndex = new Map(); // značka -> Set(productIds)
  
  for (const product of products) {
    // Indexuj slová z názvu a popisu
    const words = extractSearchWords(product.title + ' ' + product.description + ' ' + product.brand);
    
    for (const word of words) {
      if (!index.has(word)) {
        index.set(word, new Set());
      }
      index.get(word).add(product.id);
    }
    
    // Indexuj kategóriu
    if (product.category) {
      const catKey = normalizeForIndex(product.category);
      if (!categoryIndex.has(catKey)) {
        categoryIndex.set(catKey, new Set());
      }
      categoryIndex.get(catKey).add(product.id);
    }
    
    // Indexuj značku
    if (product.brand) {
      const brandKey = normalizeForIndex(product.brand);
      if (!brandIndex.has(brandKey)) {
        brandIndex.set(brandKey, new Set());
      }
      brandIndex.get(brandKey).add(product.id);
    }
  }
  
  // Ulož indexy do Redis
  const pipeline = redis.pipeline();
  
  // Vymaž staré indexy
  pipeline.del('index:words');
  pipeline.del('index:categories');
  pipeline.del('index:brands');
  
  // Ulož slovný index (len top slová - max 10000)
  let wordCount = 0;
  for (const [word, ids] of index.entries()) {
    if (ids.size >= 2 && wordCount < 10000) { // Len slová s 2+ produktami
      pipeline.hset('index:words', word, JSON.stringify([...ids]));
      wordCount++;
    }
  }
  
  // Ulož kategórie
  for (const [cat, ids] of categoryIndex.entries()) {
    pipeline.hset('index:categories', cat, JSON.stringify([...ids]));
  }
  
  // Ulož značky
  for (const [brand, ids] of brandIndex.entries()) {
    pipeline.hset('index:brands', brand, JSON.stringify([...ids]));
  }
  
  await pipeline.exec();
  console.log(`  ✅ Index vytvorený: ${wordCount} slov, ${categoryIndex.size} kategórií, ${brandIndex.size} značiek`);
}

// Extrakcia slov pre index
function extractSearchWords(text) {
  const normalized = normalizeForIndex(text);
  return normalized
    .split(/\s+/)
    .filter(word => word.length >= 3) // Min 3 znaky
    .slice(0, 50); // Max 50 slov na produkt
}

// Normalizácia textu pre index
function normalizeForIndex(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Odstráň diakritiku
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Odstránenie HTML tagov
function stripHtml(html) {
  return String(html || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}
