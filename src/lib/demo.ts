import "server-only";
import { db } from "@/db";
import {
  notifications,
  waMessages,
  actionLog,
  businesses,
  cashItems,
  customers as customersTable,
  marketingCampaigns,
  promoAssignments,
  promoExperiments,
  products as productsTable,
  sales as salesTable,
  uploadedFiles,
  users,
} from "@/db/schema";
import { and, eq, inArray, isNull, like } from "drizzle-orm";
import { hashPassword, setSession } from "./auth";
import { refreshCustomerAggregates } from "./analytics";
import { addDays, mulberry32, todayISO } from "./utils";
import { assignHoldout } from "./engine-math";

/* ------------------------------------------------------------------ */
/* Realistic demo datasets (bakery / restaurant / grocery / retail).    */
/* Generated with a seeded PRNG so re-loading produces consistent,      */
/* stable numbers. All rows are flagged demo=true and fully isolated   */
/* per business — they can be cleared without touching real data.      */
/* ------------------------------------------------------------------ */

type DemoProduct = { name: string; category: string; cost: number; price: number; stock: number; min: number; trend: number; weight: number };

const PACKS: Record<string, DemoProduct[]> = {
  Kirana: [
    { name: "Sona Masoori Rice 5kg", category: "Staples", cost: 280, price: 420, stock: 42, min: 12, trend: 1, weight: 22 },
    { name: "Toor Dal 1kg", category: "Staples", cost: 110, price: 168, stock: 40, min: 10, trend: 1, weight: 8 },
    { name: "Sunflower Oil 1L", category: "Staples", cost: 120, price: 175, stock: 9, min: 10, trend: 1, weight: 7 },
    { name: "Aashirvaad Atta 5kg", category: "Staples", cost: 210, price: 295, stock: 16, min: 8, trend: 1, weight: 9 },
    { name: "Nandini Milk 1L", category: "Dairy", cost: 28, price: 44, stock: 24, min: 18, trend: 1, weight: 12 },
    { name: "Eggs (12)", category: "Dairy", cost: 70, price: 96, stock: 14, min: 8, trend: 1, weight: 6 },
    { name: "Sugar 1kg", category: "Staples", cost: 38, price: 52, stock: 48, min: 12, trend: 0.9, weight: 5 },
    { name: "Brooke Bond Tea 250g", category: "Beverages", cost: 85, price: 125, stock: 11, min: 6, trend: 1, weight: 5 },
    { name: "Maggi 4 pack", category: "Packaged", cost: 48, price: 68, stock: 30, min: 12, trend: 1.1, weight: 7 },
    { name: "Parle-G 800g", category: "Packaged", cost: 40, price: 55, stock: 26, min: 10, trend: 1, weight: 6 },
    { name: "Onions 1kg", category: "Produce", cost: 22, price: 40, stock: 20, min: 10, trend: 1, weight: 8 },
    { name: "Tomatoes 1kg", category: "Produce", cost: 18, price: 36, stock: 18, min: 8, trend: 1, weight: 7 },
    { name: "Bananas 1kg", category: "Produce", cost: 30, price: 55, stock: 14, min: 8, trend: 1, weight: 5 },
    { name: "Surf Excel 1kg", category: "Household", cost: 140, price: 195, stock: 4, min: 4, trend: 0.7, weight: 3 },
    { name: "Colgate 200g", category: "Household", cost: 70, price: 105, stock: 12, min: 6, trend: 1, weight: 4 },
    { name: "Imported Olive Oil 500ml", category: "Staples", cost: 480, price: 650, stock: 24, min: 4, trend: 1, weight: 0 },
  ],
  Salon: [
    { name: "Haircut", category: "Services", cost: 40, price: 250, stock: 40, min: 4, trend: 1, weight: 12 },
    { name: "Hair Colour", category: "Colour", cost: 180, price: 900, stock: 6, min: 6, trend: 0.8, weight: 7 },
    { name: "Facial", category: "Skin", cost: 120, price: 700, stock: 10, min: 4, trend: 1.15, weight: 5 },
    { name: "Beard Trim", category: "Services", cost: 20, price: 120, stock: 30, min: 4, trend: 1, weight: 8 },
    { name: "Bridal Makeup", category: "Bridal", cost: 800, price: 4500, stock: 2, min: 1, trend: 1.1, weight: 2 },
    { name: "Hair Spa", category: "Hair", cost: 150, price: 850, stock: 8, min: 3, trend: 0.9, weight: 4 },
    { name: "Threading", category: "Skin", cost: 15, price: 80, stock: 40, min: 6, trend: 1, weight: 6 },
    { name: "Keratin Combo", category: "Hair", cost: 600, price: 2800, stock: 3, min: 2, trend: 0.65, weight: 2 },
  ],
  Bakery: [
    { name: "Butter Croissant", category: "Pastries", cost: 1.2, price: 3.5, stock: 42, min: 15, trend: 1, weight: 10 },
    { name: "Sourdough Loaf", category: "Breads", cost: 2.1, price: 7.5, stock: 14, min: 10, trend: 1, weight: 7 },
    { name: "Chocolate Cake (slice)", category: "Cakes", cost: 2.8, price: 6.5, stock: 5, min: 12, trend: 1.05, weight: 9 },
    { name: "Fudge Brownie", category: "Cakes", cost: 1.1, price: 3.2, stock: 30, min: 10, trend: 0.55, weight: 8 },
    { name: "Blueberry Muffin", category: "Pastries", cost: 1.0, price: 3.4, stock: 24, min: 12, trend: 1, weight: 7 },
    { name: "Baguette", category: "Breads", cost: 0.9, price: 3.8, stock: 35, min: 12, trend: 1, weight: 8 },
    { name: "Cinnamon Roll", category: "Pastries", cost: 1.3, price: 4.2, stock: 18, min: 10, trend: 1.1, weight: 6 },
    { name: "Bagel w/ Cream Cheese", category: "Breads", cost: 1.4, price: 4.5, stock: 0, min: 10, trend: 0.9, weight: 6 },
    { name: "Danish Pastry", category: "Pastries", cost: 1.2, price: 3.9, stock: 20, min: 8, trend: 0.95, weight: 5 },
    { name: "Chocolate Chip Cookie", category: "Cookies", cost: 0.7, price: 2.2, stock: 60, min: 20, trend: 1, weight: 9 },
    { name: "Fruit Tart", category: "Pastries", cost: 2.2, price: 5.8, stock: 9, min: 6, trend: 0.8, weight: 4 },
    { name: "Cheesecake (slice)", category: "Cakes", cost: 2.9, price: 6.8, stock: 11, min: 8, trend: 1, weight: 5 },
    { name: "Croissant Sandwich", category: "Sandwiches", cost: 2.4, price: 6.2, stock: 16, min: 8, trend: 1.15, weight: 6 },
    { name: "Seasonal Fruit Pie", category: "Cakes", cost: 3.1, price: 7.2, stock: 7, min: 5, trend: 1.2, weight: 4 },
    { name: "Matcha Latte", category: "Beverages", cost: 1.8, price: 4.9, stock: 80, min: 30, trend: 1.6, weight: 7 },
    { name: "Iced Coffee", category: "Beverages", cost: 1.2, price: 4.2, stock: 100, min: 40, trend: 1.05, weight: 8 },
  ],
  Restaurant: [
    { name: "Margherita Pizza", category: "Pizza", cost: 4.2, price: 14, stock: 30, min: 10, trend: 1, weight: 12 },
    { name: "Pepperoni Pizza", category: "Pizza", cost: 5.0, price: 15.5, stock: 26, min: 10, trend: 1.1, weight: 11 },
    { name: "Chicken Alfredo", category: "Pasta", cost: 6.5, price: 17, stock: 14, min: 8, trend: 0.9, weight: 8 },
    { name: "Spaghetti Bolognese", category: "Pasta", cost: 4.2, price: 14.5, stock: 18, min: 8, trend: 1, weight: 9 },
    { name: "House Burger", category: "Grill", cost: 4.8, price: 13.5, stock: 22, min: 10, trend: 1.15, weight: 10 },
    { name: "Grilled Salmon", category: "Grill", cost: 9.0, price: 22, stock: 6, min: 8, trend: 0.85, weight: 5 },
    { name: "Fish & Chips", category: "Grill", cost: 5.0, price: 14, stock: 12, min: 8, trend: 0.7, weight: 6 },
    { name: "Caesar Salad", category: "Sides", cost: 3.0, price: 9, stock: 16, min: 8, trend: 1, weight: 6 },
    { name: "Club Sandwich", category: "Sides", cost: 3.4, price: 11, stock: 0, min: 6, trend: 0.95, weight: 5 },
    { name: "Tiramisu", category: "Desserts", cost: 2.6, price: 8, stock: 10, min: 6, trend: 1.2, weight: 6 },
    { name: "New York Cheesecake", category: "Desserts", cost: 2.8, price: 8.5, stock: 12, min: 6, trend: 1, weight: 5 },
    { name: "Tomato Basil Soup", category: "Sides", cost: 2.0, price: 7, stock: 15, min: 8, trend: 0.9, weight: 4 },
    { name: "House Red Wine (glass)", category: "Drinks", cost: 4.0, price: 12, stock: 48, min: 24, trend: 1.1, weight: 8 },
    { name: "Craft Beer", category: "Drinks", cost: 2.5, price: 6.5, stock: 40, min: 24, trend: 1.05, weight: 7 },
    { name: "Fresh Lemonade", category: "Drinks", cost: 1.2, price: 4, stock: 60, min: 24, trend: 1.3, weight: 7 },
  ],
  "Grocery Store": [
    { name: "Whole Milk 1L", category: "Dairy", cost: 0.9, price: 1.9, stock: 60, min: 24, trend: 1, weight: 12 },
    { name: "Free-Range Eggs (12)", category: "Dairy", cost: 1.8, price: 3.9, stock: 34, min: 18, trend: 1, weight: 10 },
    { name: "Sourdough Loaf", category: "Bakery", cost: 1.9, price: 4.2, stock: 8, min: 10, trend: 1, weight: 7 },
    { name: "Olive Oil 500ml", category: "Pantry", cost: 3.2, price: 7.5, stock: 18, min: 8, trend: 1, weight: 5 },
    { name: "Basmati Rice 5kg", category: "Pantry", cost: 4.5, price: 9.9, stock: 12, min: 6, trend: 0.9, weight: 4 },
    { name: "Spaghetti 500g", category: "Pantry", cost: 0.6, price: 1.4, stock: 70, min: 30, trend: 1, weight: 9 },
    { name: "Ground Coffee 250g", category: "Beverages", cost: 2.8, price: 5.9, stock: 22, min: 10, trend: 1.15, weight: 8 },
    { name: "Dark Chocolate 70%", category: "Snacks", cost: 1.4, price: 3.2, stock: 44, min: 20, trend: 1, weight: 9 },
    { name: "Oat Milk 1L", category: "Dairy", cost: 1.5, price: 3.4, stock: 10, min: 12, trend: 1.4, weight: 7 },
    { name: "Honey 350g", category: "Pantry", cost: 2.6, price: 6.2, stock: 14, min: 6, trend: 0.8, weight: 4 },
    { name: "Granola 500g", category: "Snacks", cost: 2.2, price: 4.9, stock: 26, min: 12, trend: 1.1, weight: 6 },
    { name: "Tomatoes 1kg", category: "Produce", cost: 1.1, price: 2.8, stock: 40, min: 20, trend: 1, weight: 10 },
    { name: "Bananas 1kg", category: "Produce", cost: 0.5, price: 1.3, stock: 55, min: 24, trend: 1, weight: 12 },
    { name: "Apples 1kg", category: "Produce", cost: 0.9, price: 2.4, stock: 38, min: 18, trend: 0.95, weight: 10 },
    { name: "Chicken Breast 1kg", category: "Meat", cost: 4.2, price: 7.9, stock: 16, min: 10, trend: 1, weight: 8 },
    { name: "Salmon Fillet 500g", category: "Meat", cost: 6.8, price: 12.5, stock: 0, min: 6, trend: 0.75, weight: 4 },
    { name: "Ice Cream 1L", category: "Frozen", cost: 2.4, price: 5.5, stock: 20, min: 10, trend: 1.5, weight: 6 },
    { name: "Orange Juice 1L", category: "Beverages", cost: 1.6, price: 3.8, stock: 30, min: 14, trend: 1, weight: 7 },
  ],
  Retail: [
    { name: "Classic White Tee", category: "Apparel", cost: 6, price: 19, stock: 40, min: 15, trend: 1, weight: 10 },
    { name: "Slim Fit Jeans", category: "Apparel", cost: 14, price: 45, stock: 22, min: 10, trend: 1.05, weight: 9 },
    { name: "Cotton Hoodie", category: "Apparel", cost: 12, price: 39, stock: 18, min: 8, trend: 1.2, weight: 8 },
    { name: "Running Sneakers", category: "Footwear", cost: 28, price: 89, stock: 8, min: 6, trend: 0.8, weight: 5 },
    { name: "Leather Belt", category: "Accessories", cost: 8, price: 24, stock: 26, min: 10, trend: 0.9, weight: 5 },
    { name: "Wool Scarf", category: "Accessories", cost: 6, price: 22, stock: 15, min: 8, trend: 0.7, weight: 4 },
    { name: "Canvas Tote", category: "Accessories", cost: 4, price: 16, stock: 34, min: 12, trend: 1, weight: 7 },
    { name: "Aviator Sunglasses", category: "Accessories", cost: 10, price: 34, stock: 12, min: 6, trend: 0.6, weight: 4 },
    { name: "Denim Jacket", category: "Apparel", cost: 24, price: 69, stock: 10, min: 6, trend: 1.1, weight: 5 },
    { name: "Sport Socks (3pk)", category: "Apparel", cost: 3, price: 9.9, stock: 60, min: 24, trend: 1, weight: 8 },
    { name: "Knit Beanie", category: "Accessories", cost: 4, price: 14.5, stock: 20, min: 10, trend: 1.3, weight: 6 },
    { name: "Wristwatch", category: "Accessories", cost: 18, price: 59, stock: 9, min: 4, trend: 0.85, weight: 4 },
    { name: "Everyday Backpack", category: "Bags", cost: 22, price: 64, stock: 11, min: 6, trend: 1.15, weight: 5 },
    { name: "Compact Umbrella", category: "Accessories", cost: 6, price: 18, stock: 24, min: 10, trend: 1, weight: 5 },
    { name: "Cologne 50ml", category: "Beauty", cost: 21, price: 65, stock: 7, min: 5, trend: 0.95, weight: 4 },
  ],
  "Local Services": [
    { name: "Home cleaning visit", category: "Cleaning", cost: 18, price: 75, stock: 999, min: 0, trend: 1.1, weight: 10 },
    { name: "Deep cleaning service", category: "Cleaning", cost: 35, price: 145, stock: 999, min: 0, trend: 1.05, weight: 6 },
    { name: "Plumbing call-out", category: "Repairs", cost: 22, price: 95, stock: 999, min: 0, trend: 1, weight: 8 },
    { name: "Electrical repair visit", category: "Repairs", cost: 26, price: 110, stock: 999, min: 0, trend: 1.15, weight: 7 },
    { name: "Air conditioning service", category: "Maintenance", cost: 32, price: 135, stock: 999, min: 0, trend: 1.2, weight: 6 },
    { name: "Appliance installation", category: "Installation", cost: 28, price: 120, stock: 999, min: 0, trend: 0.9, weight: 5 },
    { name: "Handyman visit", category: "Repairs", cost: 20, price: 85, stock: 999, min: 0, trend: 1, weight: 7 },
    { name: "Pest control treatment", category: "Maintenance", cost: 30, price: 125, stock: 999, min: 0, trend: 0.95, weight: 5 },
    { name: "Water filter maintenance", category: "Maintenance", cost: 16, price: 68, stock: 999, min: 0, trend: 1.1, weight: 6 },
    { name: "Painting labor", category: "Home improvement", cost: 55, price: 230, stock: 999, min: 0, trend: 0.85, weight: 4 },
  ],
};

const packFor = (category: string): DemoProduct[] =>
  category === "Kirana" ? PACKS.Kirana
  : category === "Salon" ? PACKS.Salon
  : category === "Bakery" ? PACKS.Bakery
  : category === "Restaurant" ? PACKS.Restaurant
  : category === "Grocery Store" ? PACKS["Grocery Store"]
  : category === "Local Services" ? PACKS["Local Services"]
  : PACKS.Retail;

const FIRST_IN = ["Lakshmi", "Ravi", "Meena", "Suresh", "Asha", "Imran", "Kavya", "Arun", "Divya", "Farooq", "Pooja", "Naveen", "Shilpa", "Harish", "Anitha", "Kiran"];
const LAST_IN = ["Gowda", "Reddy", "Shetty", "Iyer", "Khan", "Naik", "Hegde", "Joshi", "Bhat", "Ali", "Rao", "Murthy"];

const FIRST = ["Ava", "Liam", "Maya", "Noah", "Zoe", "Ethan", "Ivy", "Lucas", "Nora", "Milo", "Ruby", "Owen", "Lena", "Finn", "Cora", "Jude", "Elle", "Marco", "Sana", "Theo"];
const LAST = ["Patel", "Kim", "Garcia", "Novak", "Osei", "Bennett", "Rossi", "Haddad", "Ito", "Silva", "Khan", "Dorsey", "Lindqvist", "Moreau", "Tanaka", "Ali"];

function seedFrom(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function pickPromoProduct(pack: DemoProduct[]): DemoProduct {
  const pool = pack.filter((p) => !/oil|rice/i.test(p.name));
  const real = pool.filter((p) => p.price >= 100);
  return [...(real.length ? real : pool)].sort((a, b) => b.weight - a.weight)[0] ?? pack[0];
}

export type DemoCounts = { products: number; sales: number; customers: number };

/** Wipes any previous demo rows for this business, then loads a fresh set. */
export async function loadDemoData(businessId: string, category: string): Promise<DemoCounts> {
  const pack = packFor(category);
  const rand = mulberry32(seedFrom(businessId));
  const today = todayISO();

  // wipe previous demo rows for this business
  const oldProds = await db.select({ id: productsTable.id }).from(productsTable).where(and(eq(productsTable.businessId, businessId), eq(productsTable.demo, true)));
  if (oldProds.length) {
    const ids = oldProds.map((p) => p.id);
    const { inventoryTransactions } = await import("@/db/schema");
    await db.delete(inventoryTransactions).where(inArray(inventoryTransactions.productId, ids));
    await db.delete(productsTable).where(and(eq(productsTable.businessId, businessId), eq(productsTable.demo, true)));
  }
  await db.delete(salesTable).where(and(eq(salesTable.businessId, businessId), eq(salesTable.demo, true)));
  await db.delete(customersTable).where(and(eq(customersTable.businessId, businessId), eq(customersTable.demo, true)));
  await db.delete(uploadedFiles).where(and(eq(uploadedFiles.businessId, businessId), eq(uploadedFiles.isDemo, true)));
  await db.delete(promoAssignments).where(and(eq(promoAssignments.businessId, businessId), inArray(promoAssignments.experimentId, db.select({ id: promoExperiments.id }).from(promoExperiments).where(and(eq(promoExperiments.businessId, businessId), eq(promoExperiments.demo, true))))));
  await db.delete(promoExperiments).where(and(eq(promoExperiments.businessId, businessId), eq(promoExperiments.demo, true)));
  await db.delete(cashItems).where(and(eq(cashItems.businessId, businessId), eq(cashItems.demo, true)));
  await db.delete(marketingCampaigns).where(and(eq(marketingCampaigns.businessId, businessId), like(marketingCampaigns.inputsJson, '%"demo":true%')));
  // The action log describes the data that was just removed, so it goes too (including the daily operator's run record).
  await db.delete(actionLog).where(eq(actionLog.businessId, businessId));
  // Today's stored brief and its bell notification were built from the old data.
  await db.delete(waMessages).where(and(eq(waMessages.businessId, businessId), eq(waMessages.kind, "brief")));
  await db.delete(notifications).where(and(eq(notifications.businessId, businessId), eq(notifications.type, "daily_brief")));

  // ---- products ----
  const prodRows = pack.map((p) => ({
    businessId,
    name: p.name,
    category: p.category,
    unitCost: p.cost,
    sellingPrice: p.price,
    stockQty: p.stock,
    minStock: p.min,
    moq: /rice/i.test(p.name) ? 10 : /oil/i.test(p.name) ? 6 : /atta/i.test(p.name) ? 5 : /milk/i.test(p.name) ? 12 : 4,
    leadTimeDays: /rice/i.test(p.name) ? 4 : /oil|atta|dal/i.test(p.name) ? 3 : 2 + (seedFrom(p.name) % 3),
    gstRate: /milk|banana|onion|tomato|egg/i.test(p.name) ? 0 : /maggi|parle|colgate|surf/i.test(p.name) ? 18 : 5,
    demo: true,
  }));
  await db.insert(productsTable).values(prodRows);

  // ---- customers with behaviour profiles ----
  const nCust = 46;
  type Profile = { refId: string; name: string; kind: "loyal" | "high_value" | "new" | "at_risk" | "one_time" | "inactive" | "lapsed" };
  const custs: Profile[] = [];
  for (let i = 0; i < nCust; i++) {
    const r = rand();
    const kind: Profile["kind"] =
      r < 0.16 ? "loyal" : r < 0.3 ? "high_value" : r < 0.42 ? "new" : r < 0.56 ? "at_risk" : r < 0.72 ? "one_time" : "inactive";
    const india = category === "Kirana" || category === "Salon";
    const firsts = india ? FIRST_IN : FIRST;
    const lasts = india ? LAST_IN : LAST;
    custs.push({
      refId: `C${String(i + 1).padStart(3, "0")}`,
      name: `${firsts[Math.floor(rand() * firsts.length)]} ${lasts[Math.floor(rand() * lasts.length)]}`,
      kind,
    });
  }
  // Regulars who drifted away: their last purchases were 45 to 110 days ago. They are the audience for the win-back test.
  const lapsedIn = category === "Kirana" || category === "Salon";
  for (let i = 0; i < 36; i++) {
    const firsts = lapsedIn ? FIRST_IN : FIRST;
    const lasts = lapsedIn ? LAST_IN : LAST;
    custs.push({
      refId: `L${String(i + 1).padStart(3, "0")}`,
      name: `${firsts[Math.floor(rand() * firsts.length)]} ${lasts[Math.floor(rand() * lasts.length)]}`,
      kind: "lapsed",
    });
  }

  // About 7 in 10 customers have agreed to be messaged. Phone numbers are obviously fake (90000 000NN).
  const consentRand = mulberry32(seedFrom(`${businessId}:consent`));
  const consentOf = new Map(custs.map((c) => [c.refId, c.kind === "lapsed" ? consentRand() < 0.82 : c.kind !== "inactive" ? consentRand() < 0.78 : consentRand() < 0.4]));
  await db.insert(customersTable).values(
    custs.map((c, i) => ({
      businessId,
      refId: c.refId,
      name: c.name,
      phone: `90000 000${String(i + 1).padStart(2, "0")}`,
      marketingConsent: consentOf.get(c.refId) === true,
      consentAt: consentOf.get(c.refId) ? new Date() : null,
      consentSource: consentOf.get(c.refId) ? "demo: opted in at the counter" : null,
      demo: true,
    }))
  );

  // ---- 120 days of sales ----
  const DAYS = 120;
  const weights = pack.map((p) => p.weight * p.trend);
  const totalW = weights.reduce((a, b) => a + b, 0);
  const pickProduct = () => {
    let r = rand() * totalW;
    for (let i = 0; i < pack.length; i++) {
      r -= weights[i];
      if (r <= 0) return i;
    }
    return pack.length - 1;
  };
  // customer affinity: loyal/high_value appear more often
  const custBag: Profile[] = [];
  for (const c of custs) {
    const n = c.kind === "loyal" ? 5 : c.kind === "high_value" ? 4 : c.kind === "at_risk" ? 3 : c.kind === "new" ? 2 : c.kind === "one_time" ? 1 : 0;
    for (let k = 0; k < n; k++) custBag.push(c);
  }

  const salesRows: { businessId: string; saleDate: string; productName: string; quantity: number; unitPrice: number; totalAmount: number; customerId: string | null; demo: boolean }[] = [];

  for (let d = DAYS - 1; d >= 0; d--) {
    const date = addDays(today, -d);
    const dow = new Date(`${date}T00:00:00`).getDay();
    const weekend = dow === 0 || dow === 6;
    const indiaShop = category === "Kirana" || category === "Salon";
    const trendFactor = 1 + (DAYS - 1 - d) * 0.004; // gentle growth
    // Kirana/salon: weekdays run about 18% below weekend days.
    const dowBoost = indiaShop ? (weekend ? 1.22 : 1) : category === "Grocery Store" ? (dow === 1 || dow === 6 ? 1.25 : 1) : weekend ? 1.42 : 1;
    const baseTx = category === "Kirana" ? 46 : category === "Salon" ? 16 : category === "Bakery" ? 34 : category === "Restaurant" ? 26 : category === "Grocery Store" ? 40 : 18;
    const noise = 0.85 + rand() * 0.3;
    const nTx = Math.round(baseTx * dowBoost * trendFactor * noise);

    // product-level time modulation
    const dayBoost = pack.map((p, i) => {
      const wave = Math.sin(((DAYS - 1 - d) / DAYS) * Math.PI * 4 + i) * 0.25;
      const linear = p.trend !== 1 ? Math.pow(p.trend, (DAYS - 1 - d) / 20) : 1;
      return weights[i] * (1 + wave) * linear;
    });
    const dayTotalW = dayBoost.reduce((a, b) => a + b, 0);

    for (let t = 0; t < nTx; t++) {
      let r = rand() * dayTotalW;
      let pi = pack.length - 1;
      for (let i = 0; i < dayBoost.length; i++) {
        r -= dayBoost[i];
        if (r <= 0) {
          pi = i;
          break;
        }
      }
      const p = pack[pi];
      const qty = category === "Kirana" || category === "Grocery Store" ? 1 + Math.floor(rand() * 2) : 1 + Math.floor(rand() * 2);
      const total = Math.round(qty * p.price * 100) / 100;
      let customerId: string | null = null;
      if (custBag.length && rand() < 0.62) {
        const c = custBag[Math.floor(rand() * custBag.length)];
        // respect profile windows
        const minAge = c.kind === "new" ? 0 : c.kind === "inactive" ? 95 : c.kind === "at_risk" ? 40 : 0;
        const maxAge = c.kind === "new" ? 28 : c.kind === "inactive" ? 119 : c.kind === "at_risk" ? 88 : c.kind === "loyal" ? 12 : 45;
        if (d >= minAge && d <= maxAge) customerId = c.refId;
      }
      salesRows.push({ businessId, saleDate: date, productName: p.name, quantity: qty, unitPrice: p.price, totalAmount: total, customerId, demo: true });
    }
  }

  for (const c of custs) {
    if (c.kind !== "lapsed") continue;
    const visits = 1 + (rand() < 0.5 ? 1 : 0);
    for (let v = 0; v < visits; v++) {
      const date = addDays(today, -(45 + Math.floor(rand() * 65)));
      const p = pack[pickProduct()];
      const qty = 1 + Math.floor(rand() * 2);
      salesRows.push({ businessId, saleDate: date, productName: p.name, quantity: qty, unitPrice: p.price, totalAmount: Math.round(qty * p.price * 100) / 100, customerId: c.refId, demo: true });
    }
  }

  if (category === "Kirana") {
    for (const row of salesRows) {
      if (!/oil/i.test(row.productName)) continue;
      const dow = new Date(`${row.saleDate}T00:00:00`).getDay();
      const price = dow === 1 || dow === 2 ? 160 : dow === 5 || dow === 6 ? 190 : 175;
      row.quantity = Math.max(1, Math.round(12 * Math.pow(175 / price, 1.05) * (0.9 + Math.random() * 0.2)));
      row.unitPrice = price;
      row.totalAmount = Math.round(row.quantity * price * 100) / 100;
    }
  }

  // Planted dip for the drop detector: a supplier delay left the biggest category short for the last 5 days,
  // so about 70% of its sales were lost. This week sits well under a normal week, and the category and products are named.
  const dipCategory = [...pack].sort((a, b) => b.weight - a.weight)[0].category;
  const dipNames = new Set(pack.filter((p) => p.category === dipCategory).map((p) => p.name));
  const dipRand = mulberry32(seedFrom(`${businessId}:dip`));
  const dipFrom = addDays(today, -4);
  for (let i = salesRows.length - 1; i >= 0; i--) {
    if (dipNames.has(salesRows[i].productName) && salesRows[i].saleDate >= dipFrom && dipRand() < 0.7) salesRows.splice(i, 1);
  }

  // Planted example for the Impact page: a 10%-off WhatsApp promo sent 12 days ago.
  // Roughly 4 in 5 sales of that product in the next 7 days get a second, discounted sale.
  const promoProduct = pickPromoProduct(pack);
  const promoSentOn = addDays(today, -12);
  const promoFrom = addDays(promoSentOn, 1);
  const promoTo = addDays(promoSentOn, 7);
  const extra: typeof salesRows = [];
  for (const row of salesRows) {
    if (row.productName !== promoProduct.name || row.saleDate < promoFrom || row.saleDate > promoTo) continue;
    if (rand() < 0.8) {
      const unitPrice = Math.round(row.unitPrice * 0.9 * 100) / 100;
      extra.push({ ...row, unitPrice, totalAmount: Math.round(row.quantity * unitPrice * 100) / 100 });
    }
  }
  salesRows.push(...extra);

  // Planted holdout experiment: a win-back offer sent 12 days ago to consenting customers who had not bought for 3+ weeks,
  // with 30% held back. Lapsed customers have almost no organic purchases, so the comparison is clean.
  const expProduct = pack.filter((p) => !/oil|rice/i.test(p.name) && p.name !== promoProduct.name && p.price >= 100).sort((a, b) => b.weight - a.weight)[0] ?? promoProduct;
  const lastBefore = new Map<string, string>();
  for (const r of salesRows) {
    if (!r.customerId || r.saleDate >= promoSentOn) continue;
    const cur = lastBefore.get(r.customerId);
    if (!cur || r.saleDate > cur) lastBefore.set(r.customerId, r.saleDate);
  }
  const gap = (d: string) => Math.round((Date.parse(`${promoSentOn}T00:00:00Z`) - Date.parse(`${d}T00:00:00Z`)) / 86400000);
  const lapsedRefs = custs.filter((c) => consentOf.get(c.refId) && !!lastBefore.get(c.refId) && gap(lastBefore.get(c.refId) as string) >= 21).map((c) => c.refId);
  const split = assignHoldout(lapsedRefs, 30, `${businessId}:demo-experiment`);
  const expRand = mulberry32(seedFrom(`${businessId}:experiment`));
  const expFrom = addDays(promoSentOn, 1);
  const addVisit = (ref: string) => {
    const date = addDays(expFrom, Math.floor(expRand() * 11));
    const qty = 1 + Math.floor(expRand() * 2);
    const unitPrice = Math.round(expProduct.price * 0.9 * 100) / 100;
    salesRows.push({ businessId, saleDate: date, productName: expProduct.name, quantity: qty, unitPrice, totalAmount: Math.round(qty * unitPrice * 100) / 100, customerId: ref, demo: true });
  };
  for (const ref of split.treatment) if (expRand() < 0.6) addVisit(ref);
  for (const ref of split.holdout) if (expRand() < 0.05) addVisit(ref);

  for (let i = 0; i < salesRows.length; i += 500) await db.insert(salesTable).values(salesRows.slice(i, i + 500));
  const [promoCamp] = await db.insert(marketingCampaigns).values({
    businessId,
    type: "whatsapp",
    title: `${promoProduct.name} 10% off`,
    content: `${promoProduct.name} is 10% off this week. Reply to this message and we will keep one aside for you.`,
    inputsJson: JSON.stringify({ product: promoProduct.name, discount: 10, demo: true, source: "demo" }),
    engine: "builtin",
    status: "sent",
    approvedAt: new Date(`${promoSentOn}T12:00:00.000Z`),
  }).returning({ id: marketingCampaigns.id });
  const [expCamp] = await db.insert(marketingCampaigns).values({
    businessId,
    type: "whatsapp",
    title: `Win-back: ${expProduct.name} 10% off`,
    content: `We miss you! ${expProduct.name} is 10% off this week, just for you. Reply and we will keep one aside.`,
    inputsJson: JSON.stringify({ product: expProduct.name, discount: 10, demo: true, source: "demo", segment: "lapsed customers" }),
    engine: "builtin",
    status: "sent",
    approvedAt: new Date(`${promoSentOn}T12:00:00.000Z`),
  }).returning({ id: marketingCampaigns.id });
  const [exp] = await db
    .insert(promoExperiments)
    .values({ businessId, campaignId: expCamp.id, title: `Win-back: ${expProduct.name} 10% off`, segment: "Custom: no purchase for 21+ days", productName: expProduct.name, holdoutPct: 30, windowDays: 14, startedOn: promoSentOn, demo: true })
    .returning({ id: promoExperiments.id });
  await db.insert(promoAssignments).values([
    ...split.treatment.map((customerRef) => ({ experimentId: exp.id, businessId, customerRef, grp: "treatment" })),
    ...split.holdout.map((customerRef) => ({ experimentId: exp.id, businessId, customerRef, grp: "holdout" })),
  ]);

  // Cash picture sized from this shop's own weekly sales: bills and rent due, a few customers owing money.
  const since28 = addDays(today, -27);
  const weekly = salesRows.filter((r) => r.saleDate >= since28).reduce((a, r) => a + r.totalAmount, 0) / 4;
  const W = Math.max(1000, Math.round(weekly));
  const r100 = (n: number) => Math.round(n / 100) * 100;
  await db.update(businesses).set({ openingCash: r100(W * 1.3), openingCashOn: today }).where(eq(businesses.id, businessId));
  const owing = custs.filter((c) => c.kind === "loyal" || c.kind === "high_value").slice(0, 4);
  await db.insert(cashItems).values([
    { businessId, kind: "payable", party: "Wholesaler (staples)", amount: r100(W * 0.9), issuedOn: addDays(today, -6), dueDate: addDays(today, 12), recurrence: "none", note: "Rice, atta and oil", demo: true },
    { businessId, kind: "payable", party: "Distributor (packaged)", amount: r100(W * 1.1), issuedOn: addDays(today, -3), dueDate: addDays(today, 26), recurrence: "none", note: "Monthly order", demo: true },
    { businessId, kind: "recurring", party: "Shop rent", amount: r100(W * 0.2), issuedOn: addDays(today, -25), dueDate: addDays(today, 5), recurrence: "monthly", demo: true },
    // Credit at different ages so the collections agent has something real to chase: 4, 12 and 26 days late, and one not yet due.
    ...owing.map((c, i) => {
      const late = [4, 12, 26, -8][i] ?? -3;
      return { businessId, kind: "receivable", party: c.name, amount: r100(W * (0.05 + i * 0.015)), issuedOn: addDays(today, -(late + 20)), dueDate: addDays(today, -late), recurrence: "none", note: "Credit on groceries", demo: true };
    }),
  ]);
  if (category === "Kirana") {
    const since = addDays(today, -13);
    const qty = new Map<string, number>();
    for (const row of salesRows) {
      if (row.saleDate >= since) qty.set(row.productName, (qty.get(row.productName) ?? 0) + row.quantity);
    }
    for (const [name, q] of qty) {
      const daily = q / 14;
      const cover = /rice/i.test(name) ? 3 : 8;
      await db
        .update(productsTable)
        .set({ stockQty: Math.max(1, Math.round(daily * cover)) })
        .where(and(eq(productsTable.businessId, businessId), eq(productsTable.name, name)));
    }
  }
  await refreshCustomerAggregates(businessId);

  await db.insert(uploadedFiles).values({
    businessId,
    fileName: `demo-dataset-${category.toLowerCase().replace(/\s+/g, "-")}.csv`,
    datasetType: "sales",
    totalRows: salesRows.length,
    importedRows: salesRows.length,
    skippedRows: 0,
    issuesJson: JSON.stringify({ warnings: ["Demo dataset — 120 days of simulated-but-realistic sales."] }),
    isDemo: true,
  });

  return { products: pack.length, sales: salesRows.length, customers: custs.length };
}

export async function clearDemoData(businessId: string): Promise<void> {
  const oldProds = await db.select({ id: productsTable.id }).from(productsTable).where(and(eq(productsTable.businessId, businessId), eq(productsTable.demo, true)));
  if (oldProds.length) {
    const { inventoryTransactions } = await import("@/db/schema");
    const ids = oldProds.map((p) => p.id);
    await db.delete(inventoryTransactions).where(inArray(inventoryTransactions.productId, ids));
    await db.delete(productsTable).where(and(eq(productsTable.businessId, businessId), eq(productsTable.demo, true)));
  }
  await db.delete(salesTable).where(and(eq(salesTable.businessId, businessId), eq(salesTable.demo, true)));
  await db.delete(customersTable).where(and(eq(customersTable.businessId, businessId), eq(customersTable.demo, true)));
  await db.delete(uploadedFiles).where(and(eq(uploadedFiles.businessId, businessId), eq(uploadedFiles.isDemo, true)));
  await db.delete(promoAssignments).where(and(eq(promoAssignments.businessId, businessId), inArray(promoAssignments.experimentId, db.select({ id: promoExperiments.id }).from(promoExperiments).where(and(eq(promoExperiments.businessId, businessId), eq(promoExperiments.demo, true))))));
  await db.delete(promoExperiments).where(and(eq(promoExperiments.businessId, businessId), eq(promoExperiments.demo, true)));
  await db.delete(cashItems).where(and(eq(cashItems.businessId, businessId), eq(cashItems.demo, true)));
  await db.delete(marketingCampaigns).where(and(eq(marketingCampaigns.businessId, businessId), like(marketingCampaigns.inputsJson, '%"demo":true%')));
  // The action log describes the data that was just removed, so it goes too (including the daily operator's run record).
  await db.delete(actionLog).where(eq(actionLog.businessId, businessId));
  // Today's stored brief and its bell notification were built from the old data.
  await db.delete(waMessages).where(and(eq(waMessages.businessId, businessId), eq(waMessages.kind, "brief")));
  await db.delete(notifications).where(and(eq(notifications.businessId, businessId), eq(notifications.type, "daily_brief")));
}

export async function hasDemoData(businessId: string): Promise<boolean> {
  const rows = await db.select({ id: salesTable.id }).from(salesTable).where(and(eq(salesTable.businessId, businessId), eq(salesTable.demo, true))).limit(1);
  return rows.length > 0;
}

/* --------------------------- demo account --------------------------- */

const DEMO_EMAIL = "demo@bizcopilot.app";
const DEMO_PASSWORD = "demo1234";

export async function ensureDemoAccount(): Promise<{ userId: string; email: string }> {
  let user = await db.select().from(users).where(eq(users.email, DEMO_EMAIL)).limit(1);
  if (!user.length) {
    const [created] = await db
      .insert(users)
      .values({ name: "Lakshmi", email: DEMO_EMAIL, phone: "9845012345", passwordHash: hashPassword(DEMO_PASSWORD) })
      .returning({ id: users.id });
    const [biz] = await db
      .insert(businesses)
      .values({
        userId: created.id,
        name: "Annapurna Kirana",
        category: "Kirana",
        location: "Jayanagar, Bengaluru",
        size: "Micro (1-4)",
        employees: 3,
        phone: "9845012345",
        language: "kn",
        cashBudget: 25000,
        upiId: "annapurna@upi",
        gstin: "29AAAAA0000A1Z5",
        isDemo: true,
      })
      .returning({ id: businesses.id });
    await loadDemoData(biz.id, "Kirana");
    return { userId: created.id, email: DEMO_EMAIL };
  }
  await db.update(users).set({ phone: "9845012345", name: user[0].name || "Lakshmi" }).where(eq(users.id, user[0].id));
  const biz = await db.select().from(businesses).where(eq(businesses.userId, user[0].id)).limit(1);
  if (biz.length) {
    const needsKirana = biz[0].category !== "Kirana";
    await db
      .update(businesses)
      .set({
        name: "Annapurna Kirana",
        category: "Kirana",
        location: "Jayanagar, Bengaluru",
        phone: "9845012345",
        language: "kn",
        cashBudget: 25000,
        upiId: "annapurna@upi",
        gstin: "29AAAAA0000A1Z5",
        isDemo: true,
        updatedAt: new Date(),
      })
      .where(eq(businesses.id, biz[0].id));
    if (needsKirana || !(await hasDemoData(biz[0].id))) await loadDemoData(biz[0].id, "Kirana");
  }
  return { userId: user[0].id, email: DEMO_EMAIL };
}

export { setSession };
export const DEMO_CREDS = { email: DEMO_EMAIL, password: DEMO_PASSWORD };
