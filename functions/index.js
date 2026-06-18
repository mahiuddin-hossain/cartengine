const { onRequest } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const axios = require("axios");
const cheerio = require("cheerio");

// ─── User-Agent Pool (Rotating) ───────────────────────────────────────────────
const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1"
];

const getUA = () => USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];

// ─── Shop Priority Map ────────────────────────────────────────────────────────
// Lower number = higher priority in ranked results
const SHOP_PRIORITY = {
  "Daraz BD": 1,
  "Star Tech": 1,
  "Ryans Computers": 2,
  "Pickaboo": 2,
  "Gadget & Gear": 2,
  "Apple Gadgets BD": 2,
  "Motion View": 2,
  "TechLand BD": 3,
  "BDShop": 3,
  "Diamu": 3,
  "AjkerDeal": 4,
  "Othoba": 4,
  "PriyoShop": 4,
  "Bikroy": 4,
  "Bdstall": 4,
  "Unikart": 4,
  "Aarong": 4,
  "Apex": 4,
  "Bata BD": 4,
  "Fabrilife": 4,
  "Le Reve": 4,
  "Sailor": 4,
  "Chaldal": 4,
  "Shwapno": 4,
  "Meena Bazar": 4,
  "Khaas Food": 4,
  "Ghorer Bazar": 4,
  "Rokomari": 4,
  "Boibazar": 4,
  "Arogga": 4,
  "Medeasy": 4,
  "Foodpanda BD": 4,
  "Shajgoj": 4,
  "BanglaShoppers": 4,
  "Sindabad": 4
};

// Tier 1 shops that get "Verified" badge on frontend
const VERIFIED_SHOPS = new Set(["Daraz BD", "Star Tech", "Ryans Computers", "Pickaboo", "Gadget & Gear", "Apple Gadgets BD", "Motion View"]);

// ─── Price Parser ─────────────────────────────────────────────────────────────
function parsePrice(str) {
  if (typeof str === "number") return Math.round(str);
  if (!str) return 0;
  const n = parseInt(str.replace(/[^\d]/g, ""), 10);
  return isNaN(n) ? 0 : n;
}

// ─── axios helpers ────────────────────────────────────────────────────────────
function htmlHeaders() {
  return {
    "User-Agent": getUA(),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.5"
  };
}
function jsonHeaders(referer) {
  return {
    "User-Agent": getUA(),
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.5",
    "Referer": referer || "https://www.daraz.com.bd/"
  };
}

// ─── 1. Daraz (Reverse-engineered internal AJAX/JSON API) ────────────────────
async function scrapeDaraz(query) {
  const url = `https://www.daraz.com.bd/catalog/?ajax=true&q=${encodeURIComponent(query)}`;
  try {
    const res = await axios.get(url, { headers: jsonHeaders(), timeout: 7000 });
    const listItems = res.data?.mods?.listItems || [];
    return listItems.slice(0, 20).map(item => {
      const price = parsePrice(item.price);
      const originalPrice = item.originalPrice ? parsePrice(item.originalPrice) : price;
      let link = item.productUrl || item.itemUrl || "";
      if (link.startsWith("//")) link = "https:" + link;
      let image = item.image || item.imgUrl || "";
      if (image.startsWith("//")) image = "https:" + image;
      return { title: item.name, price, originalPrice, link, image, shopName: "Daraz BD" };
    }).filter(p => p.title && p.price > 0);
  } catch (e) {
    logger.error("Daraz scraper:", e.message);
    return [];
  }
}

// ─── 2. Star Tech (Cheerio HTML) ─────────────────────────────────────────────
async function scrapeStarTech(query) {
  const url = `https://www.startech.com.bd/product/search?search=${encodeURIComponent(query)}`;
  try {
    const res = await axios.get(url, { headers: htmlHeaders(), timeout: 7000 });
    const $ = cheerio.load(res.data);
    const items = [];
    $(".p-item").each((_, el) => {
      const titleEl = $(el).find(".p-item-name a");
      const title = titleEl.text().trim();
      const link = titleEl.attr("href") || "";
      const image = $(el).find(".p-item-img img").attr("src") || "";
      const priceNewEl = $(el).find(".p-item-price .price-new");
      const priceText = priceNewEl.length ? priceNewEl.text() : $(el).find(".p-item-price").text();
      const price = parsePrice(priceText);
      const oldEl = $(el).find(".p-item-price .price-old");
      const originalPrice = oldEl.length ? parsePrice(oldEl.text()) : price;
      if (title && price > 0) items.push({ title, price, originalPrice, link, image, shopName: "Star Tech" });
    });
    return items;
  } catch (e) {
    logger.error("Star Tech scraper:", e.message);
    return [];
  }
}

// ─── 3. Ryans Computers (Cheerio HTML) ───────────────────────────────────────
async function scrapeRyans(query) {
  const url = `https://www.ryanscomputers.com/search?q=${encodeURIComponent(query)}`;
  try {
    const res = await axios.get(url, { headers: htmlHeaders(), timeout: 8000 });
    const $ = cheerio.load(res.data);
    const items = [];
    $(".product-box, .cus-col-2, .grid-product-card").each((_, el) => {
      const titleEl = $(el).find(".product-title a, h5.card-title a, a.product-title-grid");
      const title = titleEl.first().text().trim();
      let link = titleEl.first().attr("href") || "";
      if (link && !link.startsWith("http")) link = "https://www.ryanscomputers.com" + link;
      const imgEl = $(el).find("img.card-img-top, img.product-image, .product-img img");
      let image = imgEl.attr("src") || imgEl.attr("data-src") || "";
      if (image && !image.startsWith("http")) image = "https://www.ryanscomputers.com" + image;
      const spPriceEl = $(el).find(".new-sp-text");
      const regPriceEl = $(el).find(".new-reg-text");
      let price = 0, originalPrice = 0;
      if (spPriceEl.length) {
        price = parsePrice(spPriceEl.text());
        originalPrice = regPriceEl.length ? parsePrice(regPriceEl.text()) : price;
      } else if (regPriceEl.length) {
        price = originalPrice = parsePrice(regPriceEl.text());
      } else {
        price = originalPrice = parsePrice($(el).find(".price, .product-price, .rp-block").text());
      }
      if (title && price > 0) items.push({ title, price, originalPrice, link, image, shopName: "Ryans Computers" });
    });
    return items;
  } catch (e) {
    logger.error("Ryans scraper:", e.message);
    return [];
  }
}

// ─── 4. Pickaboo (Cheerio HTML) ───────────────────────────────────────────────
async function scrapePickaboo(query) {
  const url = `https://www.pickaboo.com/catalogsearch/result/?q=${encodeURIComponent(query)}`;
  try {
    const res = await axios.get(url, { headers: htmlHeaders(), timeout: 7000 });
    const $ = cheerio.load(res.data);
    const items = [];
    $(".product-item, .item.product.product-item").each((_, el) => {
      const titleEl = $(el).find(".product-item-name a, .product-item-link");
      const title = titleEl.text().trim();
      const link = titleEl.attr("href") || "";
      const image = $(el).find("img.product-image-photo, .photo").attr("src") || "";
      const price = parsePrice($(el).find(".price").first().text());
      const originalPrice = parsePrice($(el).find(".old-price .price").text()) || price;
      if (title && price > 0) items.push({ title, price, originalPrice, link, image, shopName: "Pickaboo" });
    });
    return items;
  } catch (e) {
    logger.error("Pickaboo scraper:", e.message);
    return [];
  }
}

// ─── 5. Gadget & Gear (Cheerio HTML - WooCommerce) ────────────────────────────
async function scrapeGadgetGear(query) {
  const url = `https://www.gadgetandgear.com/?s=${encodeURIComponent(query)}&post_type=product`;
  try {
    const res = await axios.get(url, { headers: htmlHeaders(), timeout: 7000 });
    const $ = cheerio.load(res.data);
    const items = [];
    $(".product, .type-product").each((_, el) => {
      const titleEl = $(el).find("h2.woocommerce-loop-product__title, .product-title");
      const title = titleEl.text().trim();
      const link = $(el).find("a.woocommerce-LoopProduct-link, a").first().attr("href") || "";
      const image = $(el).find("img.attachment-woocommerce_thumbnail, img").first().attr("src") || "";
      const price = parsePrice($(el).find("ins .woocommerce-Price-amount, .woocommerce-Price-amount").first().text());
      const originalPrice = parsePrice($(el).find("del .woocommerce-Price-amount").text()) || price;
      if (title && price > 0) items.push({ title, price, originalPrice, link, image, shopName: "Gadget & Gear" });
    });
    return items;
  } catch (e) {
    logger.error("Gadget & Gear scraper:", e.message);
    return [];
  }
}

// ─── 6. TechLand BD (Cheerio HTML - Opencart-like) ───────────────────────────
async function scrapeTechland(query) {
  const url = `https://www.techlandbd.com/index.php?route=product/search&search=${encodeURIComponent(query)}`;
  try {
    const res = await axios.get(url, { headers: htmlHeaders(), timeout: 7000 });
    const $ = cheerio.load(res.data);
    const items = [];
    $(".product-thumb, .product-layout").each((_, el) => {
      const titleEl = $(el).find(".caption h4 a, .name a");
      const title = titleEl.text().trim();
      const link = titleEl.attr("href") || "";
      const image = $(el).find("img").first().attr("src") || "";
      const price = parsePrice($(el).find(".price-new, .price").first().text());
      const originalPrice = parsePrice($(el).find(".price-old").text()) || price;
      if (title && price > 0) items.push({ title, price, originalPrice, link, image, shopName: "TechLand BD" });
    });
    return items;
  } catch (e) {
    logger.error("TechLand scraper:", e.message);
    return [];
  }
}

// ─── 7. BDShop (Cheerio HTML) ────────────────────────────────────────────────
async function scrapeBdshop(query) {
  const url = `https://www.bdshop.com/search?q=${encodeURIComponent(query)}`;
  try {
    const res = await axios.get(url, { headers: htmlHeaders(), timeout: 7000 });
    const $ = cheerio.load(res.data);
    const items = [];
    $(".product-item, .product-card").each((_, el) => {
      const titleEl = $(el).find(".product-name a, .product-title a, h3 a, h4 a");
      const title = titleEl.text().trim();
      const link = titleEl.attr("href") || "";
      const image = $(el).find("img").first().attr("src") || $(el).find("img").first().attr("data-src") || "";
      const price = parsePrice($(el).find(".price, .product-price, .special-price").first().text());
      const originalPrice = parsePrice($(el).find(".old-price, .regular-price").text()) || price;
      if (title && price > 0) items.push({ title, price, originalPrice, link, image, shopName: "BDShop" });
    });
    return items;
  } catch (e) {
    logger.error("BDShop scraper:", e.message);
    return [];
  }
}

// ─── 8. Diamu (Cheerio HTML) ──────────────────────────────────────────────────
async function scrapeDiamu(query) {
  const url = `https://www.diamu.com.bd/search/?q=${encodeURIComponent(query)}`;
  try {
    const res = await axios.get(url, { headers: htmlHeaders(), timeout: 7000 });
    const $ = cheerio.load(res.data);
    const items = [];
    $(".product-item, .product-card, .item").each((_, el) => {
      const titleEl = $(el).find("a.product-title, .title a, h3 a, h4 a");
      const title = titleEl.text().trim();
      const link = titleEl.attr("href") || "";
      const image = $(el).find("img").first().attr("src") || "";
      const price = parsePrice($(el).find(".price, .product-price").first().text());
      const originalPrice = parsePrice($(el).find(".old-price, .regular-price").text()) || price;
      if (title && price > 0) items.push({ title, price, originalPrice, link, image, shopName: "Diamu" });
    });
    return items;
  } catch (e) {
    logger.error("Diamu scraper:", e.message);
    return [];
  }
}

// ─── 9. Rokomari (Books) ─────────────────────────────────────────────────────
async function scrapeRokomari(query) {
  const url = `https://www.rokomari.com/book?term=${encodeURIComponent(query)}`;
  try {
    const res = await axios.get(url, { headers: htmlHeaders(), timeout: 7000 });
    const $ = cheerio.load(res.data);
    const items = [];
    $(".booklist-area, .book-list li, .book-list-item").each((_, el) => {
      const titleEl = $(el).find(".booklist-title a, .book-title a, h4 a");
      const title = titleEl.text().trim();
      const link = titleEl.attr("href") || "";
      const fullLink = link.startsWith("http") ? link : "https://www.rokomari.com" + link;
      const image = $(el).find("img").first().attr("src") || "";
      const price = parsePrice($(el).find(".selling-price, .price, .booklist-price").first().text());
      const originalPrice = parsePrice($(el).find(".old-price, .list-price, .regular").text()) || price;
      if (title && price > 0) items.push({ title, price, originalPrice, link: fullLink, image, shopName: "Rokomari" });
    });
    return items;
  } catch (e) {
    logger.error("Rokomari scraper:", e.message);
    return [];
  }
}

// ─── 10. Chaldal (Grocery - JSON API) ────────────────────────────────────────
async function scrapeChaldal(query) {
  const url = `https://chaldal.com/api/Product/Search`;
  try {
    const res = await axios.post(url, { query }, {
      headers: {
        "User-Agent": getUA(),
        "Content-Type": "application/json",
        "Referer": "https://chaldal.com/"
      },
      timeout: 7000
    });
    const items = [];
    const products = res.data || [];
    (Array.isArray(products) ? products : products.products || []).slice(0, 10).forEach(p => {
      const title = p.name || p.productName || "";
      const price = parsePrice(p.price);
      const originalPrice = parsePrice(p.marketPrice || p.mrp || p.originalPrice) || price;
      const link = `https://chaldal.com/${p.slug || ""}`;
      const image = p.imageUrl || p.imageUrls?.[0] || "";
      if (title && price > 0) items.push({ title, price, originalPrice, link, image, shopName: "Chaldal" });
    });
    return items;
  } catch (e) {
    logger.error("Chaldal scraper:", e.message);
    return [];
  }
}

// ─── Weighted Sort Function ───────────────────────────────────────────────────
// Priority: shopPriority (ascending), then price (ascending)
function weightedSort(products) {
  return products.sort((a, b) => {
    const pa = SHOP_PRIORITY[a.shopName] ?? 99;
    const pb = SHOP_PRIORITY[b.shopName] ?? 99;
    if (pa !== pb) return pa - pb;
    return a.price - b.price;
  });
}

// ─── Main Cloud Function ──────────────────────────────────────────────────────
exports.searchProduct = onRequest({ cors: true }, async (req, res) => {
  // Edge caching — delegates repeated queries to Cloudflare CDN (0-cost reads)
  res.set("Cache-Control", "public, max-age=3600, s-maxage=3600");

  const query = (req.query.q || req.body?.q || "").trim();

  if (!query) {
    return res.status(400).json({ error: "Query parameter 'q' is required." });
  }

  logger.info(`searchProduct called: "${query}"`);

  // Run scrapers concurrently — isolate failures with allSettled
  const scrapers = [
    scrapeDaraz(query),
    scrapeStarTech(query),
    scrapeRyans(query),
    scrapePickaboo(query),
    scrapeGadgetGear(query),
    scrapeTechland(query),
    scrapeBdshop(query),
    scrapeDiamu(query),
    scrapeRokomari(query),
    scrapeChaldal(query)
  ];

  const settled = await Promise.allSettled(scrapers);
  let combined = [];
  settled.forEach((result, i) => {
    if (result.status === "fulfilled") {
      combined = combined.concat(result.value);
    } else {
      logger.error(`Scraper #${i} rejected:`, result.reason);
    }
  });

  // Weighted sort: priority tier first, then price
  const sorted = weightedSort(combined);

  // Tag each product with its tier for frontend badge logic
  const products = sorted.map(p => ({
    ...p,
    verified: VERIFIED_SHOPS.has(p.shopName),
    priority: SHOP_PRIORITY[p.shopName] ?? 99
  }));

  return res.status(200).json({
    query,
    count: products.length,
    products
  });
});
