// redisClient.js
// Upstash Redis klient pre Vercel Serverless Functions
// Optimalizovaný pre vyhľadávanie v 26k+ produktoch

import { Redis } from '@upstash/redis';

// Lazy initialization pre Vercel serverless
let redis = null;

function getRedisClient() {
  if (!redis) {
    const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
    
    if (!url || !token) {
      throw new Error('Upstash Redis credentials not configured');
    }
    
    redis = new Redis({ url, token });
  }
  return redis;
}

/**
 * Vyhľadávanie produktov pomocou inverzného indexu
 * @param {string} query - Vyhľadávací dotaz
 * @param {number} limit - Max počet výsledkov
 * @returns {Promise<Array>} Nájdené produkty
 */
export async function searchProducts(query, limit = 20) {
  const redis = getRedisClient();
  const words = extractSearchWords(query);
  
  if (words.length === 0) {
    return [];
  }
  
  try {
    // Získaj ID produktov pre každé slovo z indexu
    const wordIndex = await redis.hgetall('index:words') || {};
    const productScores = new Map(); // productId -> score
    
    for (const word of words) {
      // Hľadaj presné aj čiastočné zhody
      for (const [indexWord, idsJson] of Object.entries(wordIndex)) {
        if (indexWord.includes(word) || word.includes(indexWord)) {
          const ids = typeof idsJson === 'string' ? JSON.parse(idsJson) : idsJson;
          const matchScore = indexWord === word ? 10 : 5; // Presná zhoda = vyššie skóre
          
          for (const id of ids) {
            productScores.set(id, (productScores.get(id) || 0) + matchScore);
          }
        }
      }
    }
    
    // Zoraď podľa skóre a vezmi top výsledky
    const sortedIds = [...productScores.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([id]) => id);
    
    if (sortedIds.length === 0) {
      return [];
    }
    
    // Načítaj produkty
    const products = await getProductsByIds(sortedIds);
    
    // Pridaj skóre k produktom
    return products.map(p => ({
      ...p,
      score: productScores.get(p.id) || 0
    }));
    
  } catch (error) {
    console.error('Search error:', error);
    return [];
  }
}

/**
 * Získanie produktov podľa ID
 * @param {Array<string>} ids - Zoznam ID produktov
 * @returns {Promise<Array>} Produkty
 */
export async function getProductsByIds(ids) {
  if (!ids || ids.length === 0) return [];
  
  const redis = getRedisClient();
  const pipeline = redis.pipeline();
  
  for (const id of ids) {
    pipeline.get(`product:${id}`);
  }
  
  const results = await pipeline.exec();
  
  return results
    .filter(r => r !== null)
    .map(r => typeof r === 'string' ? JSON.parse(r) : r);
}

/**
 * Získanie produktov podľa kategórie
 * @param {string} category - Názov kategórie
 * @param {number} limit - Max počet výsledkov
 * @returns {Promise<Array>} Produkty
 */
export async function getProductsByCategory(category, limit = 50) {
  const redis = getRedisClient();
  const normalizedCat = normalizeForIndex(category);
  
  const categoriesIndex = await redis.hgetall('index:categories') || {};
  
  let matchingIds = [];
  for (const [cat, idsJson] of Object.entries(categoriesIndex)) {
    if (cat.includes(normalizedCat) || normalizedCat.includes(cat)) {
      const ids = typeof idsJson === 'string' ? JSON.parse(idsJson) : idsJson;
      matchingIds = matchingIds.concat(ids);
    }
  }
  
  // Unique a limit
  const uniqueIds = [...new Set(matchingIds)].slice(0, limit);
  return getProductsByIds(uniqueIds);
}

/**
 * Získanie produktov podľa značky
 * @param {string} brand - Názov značky
 * @param {number} limit - Max počet výsledkov
 * @returns {Promise<Array>} Produkty
 */
export async function getProductsByBrand(brand, limit = 50) {
  const redis = getRedisClient();
  const normalizedBrand = normalizeForIndex(brand);
  
  const brandsIndex = await redis.hgetall('index:brands') || {};
  
  let matchingIds = [];
  for (const [b, idsJson] of Object.entries(brandsIndex)) {
    if (b.includes(normalizedBrand) || normalizedBrand.includes(b)) {
      const ids = typeof idsJson === 'string' ? JSON.parse(idsJson) : idsJson;
      matchingIds = matchingIds.concat(ids);
    }
  }
  
  const uniqueIds = [...new Set(matchingIds)].slice(0, limit);
  return getProductsByIds(uniqueIds);
}

/**
 * Získanie všetkých kategórií
 * @returns {Promise<Array>} Zoznam kategórií s počtom produktov
 */
export async function getAllCategories() {
  const redis = getRedisClient();
  const categoriesIndex = await redis.hgetall('index:categories') || {};
  
  return Object.entries(categoriesIndex).map(([name, idsJson]) => {
    const ids = typeof idsJson === 'string' ? JSON.parse(idsJson) : idsJson;
    return { name, count: ids.length };
  }).sort((a, b) => b.count - a.count);
}

/**
 * Získanie všetkých značiek
 * @returns {Promise<Array>} Zoznam značiek s počtom produktov
 */
export async function getAllBrands() {
  const redis = getRedisClient();
  const brandsIndex = await redis.hgetall('index:brands') || {};
  
  return Object.entries(brandsIndex).map(([name, idsJson]) => {
    const ids = typeof idsJson === 'string' ? JSON.parse(idsJson) : idsJson;
    return { name, count: ids.length };
  }).sort((a, b) => b.count - a.count);
}

/**
 * Získanie metadát o produktoch
 * @returns {Promise<Object>} Metadáta
 */
export async function getProductsMetadata() {
  const redis = getRedisClient();
  
  const [lastUpdate, count] = await Promise.all([
    redis.get('products:last_update'),
    redis.get('products:count')
  ]);
  
  return {
    lastUpdate,
    count: parseInt(count) || 0
  };
}

/**
 * Získanie náhodných produktov (pre odporúčania)
 * @param {number} limit - Počet produktov
 * @returns {Promise<Array>} Náhodné produkty
 */
export async function getRandomProducts(limit = 10) {
  const redis = getRedisClient();
  
  const allIds = await redis.smembers('products:all_ids');
  if (!allIds || allIds.length === 0) return [];
  
  // Náhodný výber
  const shuffled = allIds.sort(() => 0.5 - Math.random());
  const selectedIds = shuffled.slice(0, limit);
  
  return getProductsByIds(selectedIds);
}

// Pomocné funkcie
function extractSearchWords(text) {
  return normalizeForIndex(text)
    .split(/\s+/)
    .filter(word => word.length >= 2);
}

function normalizeForIndex(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export default getRedisClient;

