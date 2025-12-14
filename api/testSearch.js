// api/testSearch.js
// Testovací endpoint pre overenie vyhľadávania

import { searchProducts, getStats, getCategories, getBrands, getDiscountedProducts } from '../redisClient.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method === 'OPTIONS') return res.status(200).end();
  
  const { q, type = 'search', limit = 5 } = req.query;
  
  try {
    let result = {};
    
    switch (type) {
      case 'stats':
        result = await getStats();
        break;
        
      case 'categories':
        result = { categories: await getCategories() };
        break;
        
      case 'brands':
        result = { brands: await getBrands() };
        break;
        
      case 'discounts':
        const discounted = await getDiscountedProducts(parseInt(limit));
        result = {
          count: discounted.length,
          products: discounted.map(p => ({
            title: p.title,
            brand: p.brand,
            price: p.price,
            salePrice: p.salePrice,
            discount: `${p.discountPercent}%`,
            url: p.url
          }))
        };
        break;
        
      case 'search':
      default:
        if (!q) {
          return res.status(200).json({
            usage: {
              search: '/api/testSearch?q=jar na riad',
              stats: '/api/testSearch?type=stats',
              categories: '/api/testSearch?type=categories',
              brands: '/api/testSearch?type=brands',
              discounts: '/api/testSearch?type=discounts'
            }
          });
        }
        
        const searchResult = await searchProducts(q, { limit: parseInt(limit) });
        
        result = {
          query: q,
          terms: searchResult.terms,
          total: searchResult.total,
          count: searchResult.products.length,
          products: searchResult.products.map(p => ({
            title: p.title,
            brand: p.brand,
            price: p.price,
            salePrice: p.salePrice,
            discount: p.hasDiscount ? `${p.discountPercent}%` : null,
            category: p.categoryMain,
            score: p._score,
            url: p.url
          }))
        };
        break;
    }
    
    return res.status(200).json({
      success: true,
      timestamp: new Date().toISOString(),
      ...result
    });
    
  } catch (error) {
    console.error('❌ Test error:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
}
