// rag-system.js
// RAG (Retrieval-Augmented Generation) systém pre TEST AI chatbot
// Rozšírené o Shopify produktovú integráciu

class RAGSystem {
  constructor(knowledgeBase) {
    this.knowledgeBase = knowledgeBase;
    this.productCache = null;
    this.productCacheTime = null;
    this.cacheDuration = 5 * 60 * 1000; // 5 minút cache
    
    this.stopWords = new Set([
      'a', 'je', 'to', 'na', 'v', 'sa', 'so', 'pre', 'ako', 'že', 'ma', 'mi', 'me', 'si', 'su', 'som',
      'ale', 'ani', 'az', 'ak', 'bo', 'by', 'co', 'ci', 'do', 'ho', 'im', 'ju', 'ka', 'ku', 'ly',
      'ne', 'ni', 'no', 'od', 'po', 'pri', 'ro', 'ta', 'te', 'ti', 'tu', 'ty', 'uz', 'vo', 'za',
      'mate', 'mam', 'chcem', 'hladam', 'potrebujem'
    ]);
    
    // Rozšírené synonymá pre e-shop
    this.synonyms = {
      'cena': ['cenny', 'ceny', 'kolko', 'stoji', 'price', 'peniaze', 'platba', 'cost', 'balik', 'baliky', 'cennik', 'eur', 'euro'],
      'produkt': ['tovar', 'vyrobok', 'artikl', 'polozka', 'item', 'product', 'zbozje', 'produkty', 'sortiment'],
      'dostupny': ['skladom', 'k dispozicii', 'na sklade', 'available', 'mame', 'dostupnost', 'dostupne', 'stock'],
      'nedostupny': ['vypredane', 'nie je skladom', 'unavailable', 'out of stock', 'nemame', 'nedostupne'],
      'zlava': ['akcia', 'zľava', 'discount', 'sale', 'vyhodna cena', 'zlacnene', 'promo', 'kupón', 'kupon', 'kod'],
      'kupit': ['objednat', 'nakupit', 'buy', 'purchase', 'order', 'pridat do kosika', 'chcem', 'kúpiť'],
      'hladat': ['najst', 'vyhladat', 'search', 'find', 'kde', 'aky', 'ktory', 'odporucit', 'poradit'],
      'kategoria': ['typ', 'druh', 'category', 'kolekcia', 'sekcia', 'rada'],
      'velkost': ['size', 'rozmer', 'cislo', 'velkosti', 'sizes', 's', 'm', 'l', 'xl', 'xxl'],
      'farba': ['color', 'colour', 'odtien', 'farby', 'farebny', 'cierna', 'biela', 'cervena', 'modra'],
      'kontakt': ['spojenie', 'informacie', 'udaje', 'email', 'telefon', 'adresa'],
      'pomoc': ['podpora', 'help', 'support', 'asistencia', 'pomoc'],
      'doprava': ['dorucenie', 'shipping', 'delivery', 'postovne', 'zasielka', 'kurier'],
      'vratenie': ['reklamacia', 'return', 'vymena', 'refund', 'vratit', 'reklamovat'],
      'novinka': ['new', 'nove', 'novinky', 'najnovsie', 'fresh', 'prave doslo'],
      'popularny': ['top', 'bestseller', 'najpredavanejsie', 'obľúbené', 'hit', 'popular']
    };

    // Intent detection patterns pre produktové dotazy
    this.productIntents = {
      'search_product': ['hladam', 'najdi', 'chcem', 'potrebujem', 'mate', 'ponukate', 'máte', 'kde najdem'],
      'check_availability': ['skladom', 'dostupny', 'dostupne', 'mam k dispozicii', 'je', 'su', 'availability'],
      'get_price': ['cena', 'kolko stoji', 'price', 'koľko', 'za kolko', 'koľko stojí'],
      'find_discount': ['zlava', 'akcia', 'zlacnene', 'discount', 'promo', 'kupón'],
      'recommend': ['odporuc', 'porad', 'navrhni', 'co odporucas', 'co by si', 'najlepsie', 'doporučíš'],
      'compare': ['porovnaj', 'rozdiel', 'compare', 'lepsi', 'horsí', 'vs'],
      'category_browse': ['kategoria', 'kolekcia', 'vsetky', 'zobraz', 'ukaz', 'ponuka']
    };
  }

  // Detekcia produktového intentu
  detectProductIntent(query) {
    const normalizedQuery = this.normalizeText(query);
    
    for (const [intent, patterns] of Object.entries(this.productIntents)) {
      for (const pattern of patterns) {
        if (normalizedQuery.includes(pattern)) {
          return intent;
        }
      }
    }
    return null;
  }

  // Kontrola či dotaz je o produktoch
  isProductQuery(query) {
    const normalizedQuery = this.normalizeText(query);
    const productKeywords = [
      'produkt', 'tovar', 'skladom', 'dostupny', 'kupit', 'objednat', 'cena', 'kolko stoji',
      'mate', 'ponukate', 'zlava', 'akcia', 'kategoria', 'velkost', 'farba', 'hladam',
      'najst', 'odporuc', 'porovnaj', 'novinka', 'bestseller', 'sortiment'
    ];
    
    return productKeywords.some(keyword => normalizedQuery.includes(keyword));
  }

  // Hlavná metóda pre vyhľadávanie relevantného obsahu
  searchRelevantContent(query, maxResults = 3) {
    const normalizedQuery = this.normalizeText(query);
    const queryWords = this.extractKeywords(normalizedQuery);
    const bigrams = this.extractBigrams(normalizedQuery);
    const expandedWords = this.expandWithSynonyms(queryWords);
    
    if (queryWords.length === 0 && bigrams.length === 0) {
      return [];
    }

    const results = this.knowledgeBase.map(item => {
      const score = this.calculateRelevanceScore(item, expandedWords, normalizedQuery, bigrams);
      return { ...item, relevanceScore: score };
    })
    .filter(item => item.relevanceScore > 0)
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
    .slice(0, maxResults);

    console.log('RAG Search Results:', results.map(r => ({ title: r.title, score: r.relevanceScore })));
    return results;
  }

  // NOVÉ: Vyhľadávanie v produktoch zo Shopify
  searchProducts(query, products, maxResults = 5) {
    if (!products || products.length === 0) {
      return [];
    }

    const normalizedQuery = this.normalizeText(query);
    const queryWords = this.extractKeywords(normalizedQuery);
    const expandedWords = this.expandWithSynonyms(queryWords);

    const scoredProducts = products.map(product => {
      let score = 0;
      const normalizedTitle = this.normalizeText(product.title || '');
      const normalizedDesc = this.normalizeText(product.description || '');
      const normalizedType = this.normalizeText(product.product_type || '');
      const normalizedVendor = this.normalizeText(product.vendor || '');
      const normalizedTags = (product.tags || []).map(t => this.normalizeText(t)).join(' ');

      expandedWords.forEach(word => {
        // Názov produktu - najvyššia priorita
        if (normalizedTitle.includes(word)) {
          score += 10;
          // Bonus ak začína slovom
          if (normalizedTitle.startsWith(word)) {
            score += 5;
          }
        }
        
        // Typ produktu
        if (normalizedType.includes(word)) {
          score += 7;
        }
        
        // Tagy
        if (normalizedTags.includes(word)) {
          score += 6;
        }
        
        // Vendor/značka
        if (normalizedVendor.includes(word)) {
          score += 5;
        }
        
        // Popis
        if (normalizedDesc.includes(word)) {
          score += 3;
        }
      });

      // Bonus za presný match celej frázy v názve
      if (normalizedTitle.includes(normalizedQuery)) {
        score += 15;
      }

      // Bonus za dostupnosť
      if (product.available) {
        score += 2;
      }

      // Bonus za zľavu
      if (product.has_discount) {
        score += 1;
      }

      return { ...product, relevanceScore: score };
    })
    .filter(p => p.relevanceScore > 0)
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
    .slice(0, maxResults);

    console.log('Product Search Results:', scoredProducts.map(p => ({ 
      title: p.title, 
      score: p.relevanceScore,
      available: p.available,
      price: p.price 
    })));

    return scoredProducts;
  }

  // NOVÉ: Filtrovanie produktov podľa kritérií
  filterProducts(products, filters = {}) {
    let filtered = [...products];

    // Filter podľa dostupnosti
    if (filters.available !== undefined) {
      filtered = filtered.filter(p => p.available === filters.available);
    }

    // Filter podľa ceny
    if (filters.minPrice !== undefined) {
      filtered = filtered.filter(p => p.price >= filters.minPrice);
    }
    if (filters.maxPrice !== undefined) {
      filtered = filtered.filter(p => p.price <= filters.maxPrice);
    }

    // Filter podľa zľavy
    if (filters.hasDiscount) {
      filtered = filtered.filter(p => p.has_discount);
    }

    // Filter podľa typu
    if (filters.productType) {
      const normalizedType = this.normalizeText(filters.productType);
      filtered = filtered.filter(p => 
        this.normalizeText(p.product_type || '').includes(normalizedType)
      );
    }

    // Filter podľa vendora/značky
    if (filters.vendor) {
      const normalizedVendor = this.normalizeText(filters.vendor);
      filtered = filtered.filter(p => 
        this.normalizeText(p.vendor || '').includes(normalizedVendor)
      );
    }

    return filtered;
  }

  // NOVÉ: Získanie odporúčaní produktov
  getProductRecommendations(products, criteria = {}) {
    let recommendations = [...products];

    // Odporúčania pre "najlepšie" - bestsellery alebo s najvyšším hodnotením
    if (criteria.best) {
      recommendations = recommendations
        .filter(p => p.available)
        .sort((a, b) => (b.total_inventory || 0) - (a.total_inventory || 0));
    }

    // Odporúčania pre "najlacnejšie"
    if (criteria.cheapest) {
      recommendations = recommendations
        .filter(p => p.available && p.price > 0)
        .sort((a, b) => a.price - b.price);
    }

    // Odporúčania pre "akcie/zľavy"
    if (criteria.discounted) {
      recommendations = recommendations
        .filter(p => p.available && p.has_discount)
        .sort((a, b) => b.discount_percentage - a.discount_percentage);
    }

    // Odporúčania pre "novinky"
    if (criteria.newest) {
      recommendations = recommendations
        .filter(p => p.available)
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    }

    return recommendations.slice(0, criteria.limit || 5);
  }

  // NOVÉ: Formátovanie produktov pre kontext AI
  formatProductsForContext(products, options = {}) {
    if (!products || products.length === 0) {
      return 'Žiadne produkty neboli nájdené.';
    }

    const formatted = products.map((product, index) => {
      let productInfo = `**${index + 1}. ${product.title}**`;
      
      // Cena
      if (product.has_discount && product.compare_at_price) {
        productInfo += `\n   Cena: ~~€${product.compare_at_price}~~ **€${product.price}** (-${product.discount_percentage}%)`;
      } else {
        productInfo += `\n   Cena: €${product.price}`;
      }
      
      // Dostupnosť
      productInfo += `\n   Dostupnosť: ${product.available ? '✅ Skladom' : '❌ Nedostupné'}`;
      
      // Typ/kategória ak existuje
      if (product.product_type) {
        productInfo += `\n   Kategória: ${product.product_type}`;
      }
      
      // Značka ak existuje
      if (product.vendor && options.showVendor) {
        productInfo += `\n   Značka: ${product.vendor}`;
      }
      
      // Varianty ak existujú a sú požadované
      if (options.showVariants && product.variants && product.variants.length > 1) {
        const availableVariants = product.variants.filter(v => v.available);
        productInfo += `\n   Varianty: ${availableVariants.map(v => v.title).join(', ')}`;
      }
      
      // URL
      if (product.url && options.showUrl) {
        productInfo += `\n   Link: ${product.url}`;
      }

      // Popis (skrátený)
      if (options.showDescription && product.description) {
        const shortDesc = product.description.substring(0, 150);
        productInfo += `\n   Popis: ${shortDesc}${product.description.length > 150 ? '...' : ''}`;
      }

      return productInfo;
    });

    return formatted.join('\n\n');
  }

  // NOVÉ: Vytvorenie kontextu pre produktový dotaz
  buildProductContext(products, query, intent) {
    if (!products || products.length === 0) {
      return `Bohužiaľ, pre vyhľadávanie "${query}" som nenašiel žiadne produkty. Skúste prosím iný výraz alebo sa opýtajte konkrétnejšie.`;
    }

    let context = '';
    
    switch (intent) {
      case 'check_availability':
        context = `PRODUKTY A ICH DOSTUPNOSŤ:\n\n${this.formatProductsForContext(products, { showVariants: true })}`;
        break;
      
      case 'get_price':
        context = `CENY PRODUKTOV:\n\n${this.formatProductsForContext(products)}`;
        break;
      
      case 'find_discount':
        const discountedProducts = products.filter(p => p.has_discount);
        if (discountedProducts.length > 0) {
          context = `PRODUKTY V AKCII/ZĽAVE:\n\n${this.formatProductsForContext(discountedProducts)}`;
        } else {
          context = `Momentálne nemáme aktívne zľavy na hľadané produkty.\n\nDostupné produkty:\n${this.formatProductsForContext(products)}`;
        }
        break;
      
      case 'recommend':
        context = `ODPORÚČANÉ PRODUKTY:\n\n${this.formatProductsForContext(products, { showDescription: true, showVendor: true })}`;
        break;
      
      default:
        context = `NÁJDENÉ PRODUKTY:\n\n${this.formatProductsForContext(products, { showDescription: true })}`;
    }

    return context;
  }

  // Výpočet skóre relevancie (vylepšený)
  calculateRelevanceScore(item, queryWords, fullQuery, bigrams = []) {
    let score = 0;
    const normalizedTitle = this.normalizeText(item.title);
    const normalizedContent = this.normalizeText(item.content);
    const normalizedKeywords = item.keywords.map(k => this.normalizeText(k));
    
    // 1. Scoring pre jednotlivé slová
    queryWords.forEach(word => {
      // Kľúčové slová (najvyššia priorita)
      const keywordMatch = normalizedKeywords.some(keyword => 
        keyword.includes(word) || word.includes(keyword) || this.isSimilar(word, keyword)
      );
      if (keywordMatch) {
        score += 6; // Zvýšené z 5 na 6
      }
      
      // Názov
      if (normalizedTitle.includes(word)) {
        score += 4;
      }
      
      // Obsah (s TF-IDF boost pre zriedkavé slová)
      if (normalizedContent.includes(word)) {
        const frequency = (normalizedContent.match(new RegExp(word, 'g')) || []).length;
        score += Math.min(frequency * 1.5, 4); // Max 4 body za slovo
      }
    });

    // 2. Scoring pre bigramy (2-slovné frázy)
    bigrams.forEach(bigram => {
      if (normalizedContent.includes(bigram) || normalizedTitle.includes(bigram)) {
        score += 5; // Vysoké skóre pre presné frázy
      }
      normalizedKeywords.forEach(keyword => {
        if (keyword.includes(bigram)) {
          score += 6;
        }
      });
    });

    // 3. Bonus za presný match celej frázy
    if (normalizedContent.includes(fullQuery) || normalizedTitle.includes(fullQuery)) {
      score += 8; // Zvýšené z 3 na 8
    }

    // 4. Bonus za kategóriu matching
    if (this.getCategoryFromQuery(fullQuery) === item.category) {
      score += 3; // Zvýšené z 2 na 3
    }

    // 5. Bonus za čísla a ceny (€69, €79, 24/7, atď)
    const numbers = fullQuery.match(/\d+/g);
    if (numbers) {
      numbers.forEach(num => {
        if (normalizedContent.includes(num)) {
          score += 3;
        }
      });
    }

    return score;
  }

  // Extrakcia kľúčových slov z dotazu
  extractKeywords(normalizedText) {
    return normalizedText
      .split(/\s+/)
      .filter(word => 
        word.length > 2 && 
        !this.stopWords.has(word)
        // Zachovať čísla (môžu byť dôležité pre ceny)
      )
      .slice(0, 15); // Zvýšené z 10 na 15
  }

  // Extrakcia bigramov (2-slovné frázy)
  extractBigrams(normalizedText) {
    const words = normalizedText.split(/\s+/).filter(w => w.length > 0);
    const bigrams = [];
    
    for (let i = 0; i < words.length - 1; i++) {
      const bigram = `${words[i]} ${words[i + 1]}`;
      // Preskočiť bigramy so stop words
      if (!this.stopWords.has(words[i]) || !this.stopWords.has(words[i + 1])) {
        bigrams.push(bigram);
      }
    }
    
    return bigrams;
  }

  // Rozšírenie slov o synonymá
  expandWithSynonyms(words) {
    const expanded = new Set(words);
    
    words.forEach(word => {
      // Nájdi synonymá pre toto slovo
      for (const [key, synonymList] of Object.entries(this.synonyms)) {
        if (key === word || synonymList.includes(word)) {
          // Pridaj kľúčové slovo
          expanded.add(key);
          // Pridaj všetky synonymá
          synonymList.forEach(syn => expanded.add(syn));
        }
      }
    });
    
    return Array.from(expanded);
  }

  // Kontrola podobnosti slov (fuzzy matching)
  isSimilar(word1, word2) {
    // Levenshtein distance pre jednoduché preklepy
    if (word1 === word2) return true;
    if (Math.abs(word1.length - word2.length) > 2) return false;
    
    // Skontroluj či jedno slovo obsahuje druhé
    if (word1.includes(word2) || word2.includes(word1)) return true;
    
    // Jednoduchý Levenshtein (max 1-2 zmeny)
    let changes = 0;
    const maxLen = Math.max(word1.length, word2.length);
    
    for (let i = 0; i < maxLen; i++) {
      if (word1[i] !== word2[i]) changes++;
      if (changes > 2) return false;
    }
    
    return changes <= 2;
  }

  // Normalizácia textu
  normalizeText(text) {
    return text.toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') // Odstránenie diakritiky
      .replace(/[^\w\sáäčďéíĺľňóôŕšťúýž]/g, ' ') // Zachovanie slovenských znakov
      .replace(/\s+/g, ' ')
      .trim();
  }

  // Detekcia kategórie z dotazu
  getCategoryFromQuery(query) {
    const categoryKeywords = {
      'product': ['produkt', 'tovar', 'mate', 'ponukate', 'hladam', 'kupit', 'objednat'],
      'availability': ['skladom', 'dostupny', 'dostupne', 'k dispozicii', 'mame'],
      'pricing': ['cena', 'kolko', 'stoji', 'price', 'cennik', 'eur', 'euro'],
      'discount': ['zlava', 'akcia', 'promo', 'zlacnene', 'kupón', 'kupon', 'kod'],
      'category': ['kategoria', 'typ', 'druh', 'kolekcia', 'sekcia'],
      'shipping': ['doprava', 'dorucenie', 'postovne', 'zasielka', 'kurier'],
      'returns': ['vratenie', 'reklamacia', 'vymena', 'refund'],
      'contact': ['adresa', 'lokacia', 'kde', 'kontakt', 'telefon', 'email'],
      'support': ['podpora', 'pomoc', 'problem', 'nefunguje'],
      'recommendation': ['odporuc', 'porad', 'navrhni', 'najlepsie', 'top', 'bestseller']
    };

    for (const [category, keywords] of Object.entries(categoryKeywords)) {
      if (keywords.some(keyword => query.includes(keyword))) {
        return category;
      }
    }
    return null;
  }

  // Vytvorenie kontextu pre AI model
  buildContext(relevantContent, productContext = null) {
    let context = '';

    // Pridaj produktový kontext ak existuje
    if (productContext) {
      context += `PRODUKTOVÉ INFORMÁCIE ZO SHOPIFY:\n\n${productContext}\n\n`;
    }

    // Pridaj knowledge base kontext
    if (relevantContent && relevantContent.length > 0) {
      const kbContext = relevantContent
        .map((item, index) => `**${index + 1}. ${item.title}** (relevancia: ${item.relevanceScore}):\n${item.content}`)
        .join('\n\n');
      
      context += `INFORMÁCIE Z DATABÁZY:\n\n${kbContext}`;
    }
    
    if (!context) {
      return '';
    }

    // Inštrukcie pre AI
    const instructions = `\n\nINŠTRUKCIE: 
- Odpovedaj presne podľa týchto informácií
- Pri produktoch vždy uveď cenu a dostupnosť
- Ak produkt nie je skladom, ponúkni alternatívy
- Formátuj odpoveď prehľadne
- Pri odporúčaniach vysvetli prečo produkt odporúčaš`;

    return context + instructions;
  }

  // Získanie kontextu pre špecifickú kategóriu
  getContextByCategory(category) {
    const categoryItems = this.knowledgeBase.filter(item => item.category === category);
    return this.buildContext(categoryItems);
  }

  // Vyhľadávanie podľa ID
  getById(id) {
    return this.knowledgeBase.find(item => item.id === id);
  }

  // Získanie všetkých kategórií
  getCategories() {
    return [...new Set(this.knowledgeBase.map(item => item.category))];
  }

  // Debug metóda pre testovanie (vylepšená)
  debugSearch(query) {
    console.log('=== RAG DEBUG (Enhanced) ===');
    console.log('Query:', query);
    const normalized = this.normalizeText(query);
    console.log('Normalized:', normalized);
    const keywords = this.extractKeywords(normalized);
    console.log('Keywords:', keywords);
    console.log('Bigrams:', this.extractBigrams(normalized));
    console.log('Expanded (with synonyms):', this.expandWithSynonyms(keywords));
    console.log('Category:', this.getCategoryFromQuery(normalized));
    console.log('Is Product Query:', this.isProductQuery(query));
    console.log('Product Intent:', this.detectProductIntent(query));
    
    const results = this.searchRelevantContent(query, 5);
    console.log('Results:', results.map(r => ({ 
      title: r.title, 
      score: r.relevanceScore,
      category: r.category 
    })));
    console.log('Context:', this.buildContext(results.slice(0, 2)));
    console.log('============================');
    
    return results;
  }

  // NOVÉ: Extrakcia cenového rozsahu z dotazu
  extractPriceRange(query) {
    const normalizedQuery = this.normalizeText(query);
    const pricePatterns = [
      /do\s*(\d+)\s*(?:eur|€)?/,
      /pod\s*(\d+)\s*(?:eur|€)?/,
      /od\s*(\d+)\s*(?:do\s*(\d+))?\s*(?:eur|€)?/,
      /(\d+)\s*-\s*(\d+)\s*(?:eur|€)?/
    ];

    for (const pattern of pricePatterns) {
      const match = normalizedQuery.match(pattern);
      if (match) {
        if (match[2]) {
          return { minPrice: parseFloat(match[1]), maxPrice: parseFloat(match[2]) };
        } else if (normalizedQuery.includes('do') || normalizedQuery.includes('pod')) {
          return { maxPrice: parseFloat(match[1]) };
        } else {
          return { minPrice: parseFloat(match[1]) };
        }
      }
    }
    return null;
  }

  // NOVÉ: Extrakcia veľkosti z dotazu
  extractSize(query) {
    const normalizedQuery = this.normalizeText(query);
    const sizes = ['xs', 's', 'm', 'l', 'xl', 'xxl', 'xxxl', '2xl', '3xl'];
    const sizeNumbers = query.match(/\b(\d{2,3})\b/g); // Pre číselné veľkosti (napr. 42, 44)
    
    for (const size of sizes) {
      if (normalizedQuery.includes(size)) {
        return size.toUpperCase();
      }
    }
    
    if (sizeNumbers && sizeNumbers.length > 0) {
      return sizeNumbers[0];
    }
    
    return null;
  }

  // NOVÉ: Extrakcia farby z dotazu
  extractColor(query) {
    const normalizedQuery = this.normalizeText(query);
    const colors = {
      'cierna': ['cierna', 'cierny', 'cierne', 'black'],
      'biela': ['biela', 'biely', 'biele', 'white'],
      'cervena': ['cervena', 'cerveny', 'cervene', 'red'],
      'modra': ['modra', 'modry', 'modre', 'blue', 'navy'],
      'zelena': ['zelena', 'zeleny', 'zelene', 'green'],
      'zlta': ['zlta', 'zlty', 'zlte', 'yellow'],
      'oranzova': ['oranzova', 'oranzovy', 'oranzove', 'orange'],
      'ruzova': ['ruzova', 'ruzovy', 'ruzove', 'pink'],
      'siva': ['siva', 'sivy', 'sive', 'grey', 'gray'],
      'hneda': ['hneda', 'hnedy', 'hnede', 'brown']
    };

    for (const [color, variants] of Object.entries(colors)) {
      for (const variant of variants) {
        if (normalizedQuery.includes(variant)) {
          return color;
        }
      }
    }
    return null;
  }
}

// Export pre použitie v iných súboroch
if (typeof window !== 'undefined') {
  window.RAGSystem = RAGSystem;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = RAGSystem;
}

