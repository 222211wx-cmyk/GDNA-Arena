import { Router } from "express";
import { pool, db, usersTable, transactionsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";

const router = Router();

export const CATALOGUE = [
  { id: 1, name: "GDNA T-Shirt",         name_ar: "تيشيرت GDNA",         price: 100, category: "clothing",    emoji: "👕" },
  { id: 2, name: "Empire Cup",           name_ar: "كأس الإمبراطورية",     price: 50,  category: "collectible", emoji: "🏆" },
  { id: 3, name: "Arena Cap",            name_ar: "قبعة الأرينا",          price: 80,  category: "clothing",    emoji: "🧢" },
  { id: 4, name: "Golden Profile Frame", name_ar: "إطار بروفيل ذهبي",     price: 200, category: "digital",     emoji: "🖼️" },
  { id: 5, name: "VIP Badge",            name_ar: "شارة VIP",              price: 150, category: "digital",     emoji: "⭐" },
  { id: 6, name: "Digital Sticker Pack", name_ar: "ملصق رقمي",             price: 30,  category: "digital",     emoji: "🎨" },
  { id: 7, name: "Exclusive Background", name_ar: "خلفية حصرية",           price: 120, category: "digital",     emoji: "🌟" },
  { id: 8, name: "Hero Bundle",          name_ar: "حزمة البطل",            price: 300, category: "bundle",      emoji: "🦁" },
];

// GET /api/shop/items
router.get("/shop/items", async (req, res): Promise<void> => {
  const userId = req.session?.userId;
  let purchasedIds: number[] = [];
  if (userId) {
    const { rows } = await pool!.query(`SELECT item_id FROM purchases WHERE user_id = $1`, [userId]);
    purchasedIds = rows.map((r: any) => r.item_id);
  }
  res.json({ items: CATALOGUE, purchasedIds });
});

// POST /api/shop/buy/:id
router.post("/shop/buy/:id", async (req, res): Promise<void> => {
  const userId = req.session?.userId;
  if (!userId) { res.status(401).json({ error: "Login required" }); return; }
  const itemId = parseInt(req.params.id);
  const item = CATALOGUE.find(i => i.id === itemId);
  if (!item) { res.status(404).json({ error: "Item not found" }); return; }

  const [user] = await db.select({ balance: usersTable.balance })
    .from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (!user) { res.status(404).json({ error: "User not found" }); return; }
  if ((user.balance ?? 0) < item.price) {
    res.status(400).json({ error: "رصيدك غير كافٍ", required: item.price, balance: user.balance });
    return;
  }

  const { rows: existing } = await pool!.query(
    `SELECT id FROM purchases WHERE user_id = $1 AND item_id = $2`, [userId, itemId]
  );
  if (existing.length > 0) { res.status(400).json({ error: "لديك هذا المنتج مسبقاً" }); return; }

  await db.update(usersTable)
    .set({ balance: sql`${usersTable.balance} - ${item.price}` })
    .where(eq(usersTable.id, userId));

  await db.insert(transactionsTable).values({
    userId, amount: -item.price, type: "purchase",
    description: `شراء: ${item.name_ar}`,
  });

  await pool!.query(
    `INSERT INTO purchases (user_id, item_id, item_name, coins_spent, created_at) VALUES ($1,$2,$3,$4,NOW())`,
    [userId, itemId, item.name_ar, item.price]
  );

  const [updated] = await db.select({ balance: usersTable.balance })
    .from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  res.json({ ok: true, newBalance: updated.balance, item: item.name_ar });
});

// GET /api/shop/my-purchases
router.get("/shop/my-purchases", async (req, res): Promise<void> => {
  const userId = req.session?.userId;
  if (!userId) { res.json({ purchases: [] }); return; }
  const { rows } = await pool!.query(
    `SELECT * FROM purchases WHERE user_id = $1 ORDER BY created_at DESC`, [userId]
  );
  res.json({ purchases: rows });
});

export default router;
