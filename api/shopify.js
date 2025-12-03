// api/shopify.js
// Shopify API endpoint pre získavanie produktov, inventory a zliav

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const SHOPIFY_STORE_URL = process.env.SHOPIFY_STORE_URL; // napr. "your-store.myshopify.com"
  const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;

  if (!SHOPIFY_STORE_URL || !SHOPIFY_ACCESS_TOKEN) {
    console.error('Missing Shopify credentials');
    return res.status(500).json({ error: 'Shopify credentials not configured' });
  }

  const { action, query, productId, limit = 50 } = req.method === 'POST' ? req.body : req.query;

  try {
    let data;

    switch (action) {
      case 'getProducts':
        data = await getProducts(SHOPIFY_STORE_URL, SHOPIFY_ACCESS_TOKEN, limit);
        break;
      
      case 'searchProducts':
        data = await searchProducts(SHOPIFY_STORE_URL, SHOPIFY_ACCESS_TOKEN, query);
        break;
      
      case 'getProduct':
        data = await getProductById(SHOPIFY_STORE_URL, SHOPIFY_ACCESS_TOKEN, productId);
        break;
      
      case 'getInventory':
        data = await getInventoryLevels(SHOPIFY_STORE_URL, SHOPIFY_ACCESS_TOKEN);
        break;
      
      case 'getDiscounts':
        data = await getPriceRules(SHOPIFY_STORE_URL, SHOPIFY_ACCESS_TOKEN);
        break;
      
      case 'getCollections':
        data = await getCollections(SHOPIFY_STORE_URL, SHOPIFY_ACCESS_TOKEN);
        break;

      case 'getProductAvailability':
        data = await getProductAvailability(SHOPIFY_STORE_URL, SHOPIFY_ACCESS_TOKEN, productId);
        break;

      case 'getFullCatalog':
        data = await getFullCatalog(SHOPIFY_STORE_URL, SHOPIFY_ACCESS_TOKEN);
        break;

      default:
        return res.status(400).json({ error: 'Invalid action. Use: getProducts, searchProducts, getProduct, getInventory, getDiscounts, getCollections, getProductAvailability, getFullCatalog' });
    }

    res.status(200).json({ success: true, data });
  } catch (error) {
    console.error('Shopify API Error:', error);
    res.status(500).json({ 
      error: 'Failed to fetch from Shopify',
      details: error.message 
    });
  }
}

// Pomocná funkcia pre Shopify API volania
async function shopifyFetch(storeUrl, accessToken, endpoint) {
  const response = await fetch(`https://${storeUrl}/admin/api/2024-01/${endpoint}`, {
    method: 'GET',
    headers: {
      'X-Shopify-Access-Token': accessToken,
      'Content-Type': 'application/json'
    }
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Shopify API error ${response.status}: ${errorText}`);
  }

  return response.json();
}

// Získanie všetkých produktov
async function getProducts(storeUrl, accessToken, limit = 50) {
  const data = await shopifyFetch(storeUrl, accessToken, `products.json?limit=${limit}&status=active`);
  return formatProducts(data.products);
}

// Vyhľadávanie produktov podľa názvu alebo kľúčového slova
async function searchProducts(storeUrl, accessToken, query) {
  // Shopify API nepodporuje priamo full-text search, musíme filtrovať lokálne
  const data = await shopifyFetch(storeUrl, accessToken, 'products.json?limit=250&status=active');
  
  const normalizedQuery = query.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  
  const filteredProducts = data.products.filter(product => {
    const title = product.title.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const description = (product.body_html || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const tags = (product.tags || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const productType = (product.product_type || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const vendor = (product.vendor || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    
    return title.includes(normalizedQuery) || 
           description.includes(normalizedQuery) || 
           tags.includes(normalizedQuery) ||
           productType.includes(normalizedQuery) ||
           vendor.includes(normalizedQuery);
  });

  return formatProducts(filteredProducts);
}

// Získanie konkrétneho produktu podľa ID
async function getProductById(storeUrl, accessToken, productId) {
  const data = await shopifyFetch(storeUrl, accessToken, `products/${productId}.json`);
  return formatProduct(data.product);
}

// Získanie inventory levels
async function getInventoryLevels(storeUrl, accessToken) {
  // Najprv získame locations
  const locationsData = await shopifyFetch(storeUrl, accessToken, 'locations.json');
  const locations = locationsData.locations;

  // Pre každú lokáciu získame inventory levels
  let allInventory = [];
  for (const location of locations) {
    const inventoryData = await shopifyFetch(storeUrl, accessToken, `inventory_levels.json?location_ids=${location.id}&limit=250`);
    allInventory = allInventory.concat(inventoryData.inventory_levels.map(inv => ({
      ...inv,
      location_name: location.name
    })));
  }

  return allInventory;
}

// Získanie zliav/price rules
async function getPriceRules(storeUrl, accessToken) {
  const data = await shopifyFetch(storeUrl, accessToken, 'price_rules.json');
  
  const priceRules = await Promise.all(data.price_rules.map(async (rule) => {
    // Získame aj discount codes pre každý price rule
    try {
      const codesData = await shopifyFetch(storeUrl, accessToken, `price_rules/${rule.id}/discount_codes.json`);
      return {
        ...formatPriceRule(rule),
        discount_codes: codesData.discount_codes.map(code => code.code)
      };
    } catch (e) {
      return formatPriceRule(rule);
    }
  }));

  return priceRules;
}

// Získanie kolekcií
async function getCollections(storeUrl, accessToken) {
  // Custom collections
  const customData = await shopifyFetch(storeUrl, accessToken, 'custom_collections.json');
  
  // Smart collections
  const smartData = await shopifyFetch(storeUrl, accessToken, 'smart_collections.json');

  return {
    custom_collections: customData.custom_collections.map(formatCollection),
    smart_collections: smartData.smart_collections.map(formatCollection)
  };
}

// Získanie dostupnosti konkrétneho produktu
async function getProductAvailability(storeUrl, accessToken, productId) {
  const product = await shopifyFetch(storeUrl, accessToken, `products/${productId}.json`);
  
  // Získame inventory pre všetky varianty
  const inventoryItemIds = product.product.variants.map(v => v.inventory_item_id).join(',');
  
  let inventoryLevels = [];
  try {
    const inventoryData = await shopifyFetch(storeUrl, accessToken, `inventory_levels.json?inventory_item_ids=${inventoryItemIds}`);
    inventoryLevels = inventoryData.inventory_levels;
  } catch (e) {
    console.warn('Could not fetch inventory levels:', e.message);
  }

  return {
    product: formatProduct(product.product),
    inventory: inventoryLevels,
    variants_availability: product.product.variants.map(variant => {
      const invLevel = inventoryLevels.find(inv => inv.inventory_item_id === variant.inventory_item_id);
      return {
        id: variant.id,
        title: variant.title,
        sku: variant.sku,
        price: variant.price,
        available: invLevel ? invLevel.available : (variant.inventory_quantity || 0),
        inventory_policy: variant.inventory_policy,
        in_stock: variant.inventory_policy === 'continue' || (invLevel ? invLevel.available > 0 : variant.inventory_quantity > 0)
      };
    })
  };
}

// Získanie kompletného katalógu pre RAG systém
async function getFullCatalog(storeUrl, accessToken) {
  // Získame produkty
  const productsData = await shopifyFetch(storeUrl, accessToken, 'products.json?limit=250&status=active');
  const products = formatProducts(productsData.products);

  // Získame kolekcie
  let collections = { custom_collections: [], smart_collections: [] };
  try {
    collections = await getCollections(storeUrl, accessToken);
  } catch (e) {
    console.warn('Could not fetch collections:', e.message);
  }

  // Získame aktívne zľavy
  let discounts = [];
  try {
    discounts = await getPriceRules(storeUrl, accessToken);
  } catch (e) {
    console.warn('Could not fetch discounts:', e.message);
  }

  return {
    products,
    collections,
    discounts,
    total_products: products.length,
    fetched_at: new Date().toISOString()
  };
}

// Formátovacie funkcie
function formatProducts(products) {
  return products.map(formatProduct);
}

function formatProduct(product) {
  const mainVariant = product.variants?.[0] || {};
  const price = parseFloat(mainVariant.price || 0);
  const compareAtPrice = parseFloat(mainVariant.compare_at_price || 0);
  const hasDiscount = compareAtPrice > price;

  return {
    id: product.id,
    title: product.title,
    handle: product.handle,
    description: stripHtml(product.body_html || ''),
    product_type: product.product_type,
    vendor: product.vendor,
    tags: product.tags ? product.tags.split(', ') : [],
    price: price,
    compare_at_price: compareAtPrice,
    currency: 'EUR', // Predpokladáme EUR, môžete upraviť
    has_discount: hasDiscount,
    discount_percentage: hasDiscount ? Math.round((1 - price / compareAtPrice) * 100) : 0,
    available: product.variants?.some(v => v.available !== false && (v.inventory_quantity > 0 || v.inventory_policy === 'continue')) || false,
    total_inventory: product.variants?.reduce((sum, v) => sum + (v.inventory_quantity || 0), 0) || 0,
    variants: product.variants?.map(v => ({
      id: v.id,
      title: v.title,
      sku: v.sku,
      price: parseFloat(v.price || 0),
      compare_at_price: parseFloat(v.compare_at_price || 0),
      available: v.available !== false && (v.inventory_quantity > 0 || v.inventory_policy === 'continue'),
      inventory_quantity: v.inventory_quantity || 0,
      option1: v.option1,
      option2: v.option2,
      option3: v.option3
    })) || [],
    options: product.options?.map(o => ({
      name: o.name,
      values: o.values
    })) || [],
    images: product.images?.map(img => ({
      src: img.src,
      alt: img.alt
    })) || [],
    main_image: product.images?.[0]?.src || null,
    url: product.handle ? `/products/${product.handle}` : null,
    created_at: product.created_at,
    updated_at: product.updated_at
  };
}

function formatCollection(collection) {
  return {
    id: collection.id,
    title: collection.title,
    handle: collection.handle,
    description: stripHtml(collection.body_html || ''),
    image: collection.image?.src || null,
    products_count: collection.products_count || 0
  };
}

function formatPriceRule(rule) {
  return {
    id: rule.id,
    title: rule.title,
    value_type: rule.value_type, // 'percentage' alebo 'fixed_amount'
    value: rule.value,
    target_type: rule.target_type,
    target_selection: rule.target_selection,
    starts_at: rule.starts_at,
    ends_at: rule.ends_at,
    usage_limit: rule.usage_limit,
    active: new Date(rule.starts_at) <= new Date() && (!rule.ends_at || new Date(rule.ends_at) >= new Date())
  };
}

function stripHtml(html) {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
