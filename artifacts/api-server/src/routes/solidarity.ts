import { Router, type IRouter } from "express";
import { pool as _pool } from "@workspace/db";
import { pushNotification } from "./notifications";

const router: IRouter = Router();
const pool = _pool!;
const STATUSES = new Set(["available", "listening", "seeking", "focused", "offline"]);
// Kept in lockstep with the Solidarity Relay domain selector.
const DOMAINS = new Set(["future", "justice", "culture", "education", "health", "environment", "technology", "community"]);

async function blocked(a: number, b: number) {
  const r = await pool.query("SELECT 1 FROM citizen_blocks WHERE (blocker_id=$1 AND blocked_id=$2) OR (blocker_id=$2 AND blocked_id=$1) LIMIT 1", [a, b]);
  return r.rows.length > 0;
}
async function profile(userId: number) {
  await pool.query("INSERT INTO citizen_solidarity_profiles (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING", [userId]);
  const r = await pool.query("SELECT score, initiatives_completed AS \"initiativesCompleted\", supports_completed AS \"supportsCompleted\", status, status_visible AS \"statusVisible\" FROM citizen_solidarity_profiles WHERE user_id=$1", [userId]);
  return r.rows[0];
}

router.get("/solidarity/initiatives", async (req, res): Promise<void> => {
  const userId = req.session?.userId;
  if (!userId) { res.status(401).json({ error: "Login required" }); return; }
  const roomId = req.query.roomId === undefined ? null : Number(req.query.roomId);
  if (roomId !== null && (!Number.isInteger(roomId) || roomId < 1)) { res.status(400).json({ error: "Invalid room ID" }); return; }
  if (roomId !== null) {
    const m = await pool.query("SELECT 1 FROM dm_room_members WHERE room_id=$1 AND user_id=$2", [roomId, userId]);
    if (!m.rows.length) { res.status(403).json({ error: "Access denied" }); return; }
  }
  const r = await pool.query(
    `SELECT i.id, i.creator_id AS "creatorId", u.username AS "creatorUsername", i.title, i.body, i.domain,
            i.room_id AS "roomId", dr.name AS "roomName", i.target_support AS "targetSupport",
            COUNT(s.id)::int AS "supportCount", BOOL_OR(s.user_id=$1) AS "supportedByMe", i.status,
            i.created_at AS "createdAt", i.completed_at AS "completedAt"
     FROM solidarity_initiatives i JOIN users u ON u.id=i.creator_id
     LEFT JOIN dm_rooms dr ON dr.id=i.room_id LEFT JOIN solidarity_supports s ON s.initiative_id=i.id
     WHERE ($2::integer IS NOT NULL AND i.room_id=$2)
        OR ($2::integer IS NULL AND (i.room_id IS NULL OR EXISTS (
          SELECT 1 FROM dm_room_members visible_room WHERE visible_room.room_id=i.room_id AND visible_room.user_id=$1
        )))
     GROUP BY i.id,u.username,dr.name ORDER BY i.created_at DESC`, [userId, roomId]);
  res.json({ initiatives: r.rows.map(x => ({ ...x, supportedByMe: x.supportedByMe ?? false })), profile: await profile(userId) });
});

router.post("/solidarity/initiatives", async (req, res): Promise<void> => {
  const userId = req.session?.userId;
  if (!userId) { res.status(401).json({ error: "Login required" }); return; }
  const { title, body, domain, targetSupport, roomId } = req.body as Record<string, unknown>;
  if (typeof title !== "string" || title.trim().length < 3 || title.trim().length > 140 || typeof body !== "string" || body.trim().length < 3 || body.trim().length > 4000 || typeof domain !== "string" || !DOMAINS.has(domain) || !Number.isInteger(targetSupport) || (targetSupport as number) < 3 || (targetSupport as number) > 1000 || (roomId !== undefined && (!Number.isInteger(roomId) || (roomId as number) < 1))) {
    res.status(400).json({ error: "Invalid initiative" }); return;
  }
  if (roomId !== undefined) {
    const m = await pool.query("SELECT 1 FROM dm_room_members WHERE room_id=$1 AND user_id=$2", [roomId, userId]);
    if (!m.rows.length) { res.status(403).json({ error: "Access denied" }); return; }
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // One user-specific transaction lock makes the cooldown check and insert a
    // single serial operation even when requests land on different workers.
    await client.query("SELECT pg_advisory_xact_lock($1)", [userId]);
    const cool = await client.query(
      "SELECT 1 FROM solidarity_initiatives WHERE creator_id=$1 AND created_at > now() - interval '60 seconds' LIMIT 1",
      [userId],
    );
    if (cool.rows.length) {
      await client.query("ROLLBACK");
      res.status(429).json({ error: "Please wait before creating another initiative" }); return;
    }
    const r = await client.query(`INSERT INTO solidarity_initiatives (creator_id,title,body,domain,room_id,target_support) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, creator_id AS "creatorId",title,body,domain,room_id AS "roomId",target_support AS "targetSupport",status,created_at AS "createdAt",completed_at AS "completedAt"`, [userId, title.trim(), body.trim(), domain, roomId ?? null, targetSupport]);
    await client.query("COMMIT");
    res.status(201).json({ initiative: r.rows[0] });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    req.log.error({ error }, "Solidarity initiative creation failed");
    res.status(500).json({ error: "Unable to create initiative" });
  } finally {
    client.release();
  }
});

router.post("/solidarity/initiatives/:id/support", async (req, res): Promise<void> => {
  const userId = req.session?.userId, id = Number(req.params.id);
  if (!userId) { res.status(401).json({ error: "Login required" }); return; }
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid initiative ID" }); return; }
  const c = await pool.connect();
  let completionRecipients: number[] = [];
  try {
    await c.query("BEGIN");
    await c.query("SELECT pg_advisory_xact_lock($1)", [id]);
    const found = await c.query<{creator_id:number;target_support:number;status:string;room_id:number|null}>("SELECT creator_id,target_support,status,room_id FROM solidarity_initiatives WHERE id=$1 FOR UPDATE", [id]);
    const initiative = found.rows[0];
    if (!initiative) { await c.query("ROLLBACK"); res.status(404).json({ error: "Initiative not found" }); return; }
    if (initiative.creator_id === userId) { await c.query("ROLLBACK"); res.status(400).json({ error: "Creators cannot support their own initiative" }); return; }
    if (initiative.status !== "open") { await c.query("ROLLBACK"); res.status(409).json({ error: "Initiative is closed" }); return; }
    if (initiative.room_id) { const m = await c.query("SELECT 1 FROM dm_room_members WHERE room_id=$1 AND user_id=$2", [initiative.room_id,userId]); if (!m.rows.length) { await c.query("ROLLBACK"); res.status(403).json({error:"Access denied"}); return; } }
    const insert = await c.query("INSERT INTO solidarity_supports (initiative_id,user_id) VALUES ($1,$2) ON CONFLICT (initiative_id,user_id) DO NOTHING RETURNING id", [id,userId]);
    const count = await c.query<{count:number}>("SELECT COUNT(*)::int AS count FROM solidarity_supports WHERE initiative_id=$1", [id]);
    let completed = false;
    if (count.rows[0].count >= initiative.target_support) {
      const done = await c.query("UPDATE solidarity_initiatives SET status='completed',completed_at=now() WHERE id=$1 AND status='open' RETURNING id", [id]);
      completed = done.rows.length > 0;
      if (completed) {
        await c.query("INSERT INTO citizen_solidarity_profiles (user_id,score,initiatives_completed) VALUES ($1,10,1) ON CONFLICT (user_id) DO UPDATE SET score=citizen_solidarity_profiles.score+10,initiatives_completed=citizen_solidarity_profiles.initiatives_completed+1,updated_at=now()", [initiative.creator_id]);
        await c.query("UPDATE users SET xp=xp+10 WHERE id=$1", [initiative.creator_id]);
        await c.query(`INSERT INTO citizen_solidarity_profiles (user_id,score,supports_completed) SELECT user_id,5,1 FROM solidarity_supports WHERE initiative_id=$1 ON CONFLICT (user_id) DO UPDATE SET score=citizen_solidarity_profiles.score+5,supports_completed=citizen_solidarity_profiles.supports_completed+1,updated_at=now()`, [id]);
        await c.query("UPDATE users SET xp=xp+5 WHERE id IN (SELECT user_id FROM solidarity_supports WHERE initiative_id=$1)", [id]);
        completionRecipients = (await c.query<{user_id:number}>(
          "SELECT user_id FROM solidarity_supports WHERE initiative_id=$1", [id])).rows.map(row => row.user_id);
      }
    }
    await c.query("COMMIT");
    if (insert.rows.length) void pushNotification({ userId: initiative.creator_id, type:"solidarity_support", title:"New solidarity support", body:"A citizen supported your initiative", icon:"🤝", linkPath:"/solidarity", sourceRef:`solidarity-support:${id}:${userId}` });
    if (completed) {
      void pushNotification({userId:initiative.creator_id,type:"solidarity_completed",title:"Initiative completed",body:"Your solidarity initiative reached its goal",icon:"🎉",linkPath:"/solidarity",sourceRef:`solidarity-complete:${id}:${initiative.creator_id}`});
      completionRecipients.forEach(recipient => void pushNotification({userId:recipient,type:"solidarity_completed",title:"Initiative completed",body:"An initiative you supported reached its goal",icon:"🎉",linkPath:"/solidarity",sourceRef:`solidarity-complete:${id}:${recipient}`}));
    }
    res.json({ supported: true, alreadySupported: !insert.rows.length, completed, supportCount: count.rows[0].count });
  } catch (error) { await c.query("ROLLBACK").catch(()=>{}); req.log.error({error}, "Solidarity support failed"); res.status(500).json({error:"Unable to support initiative"}); } finally { c.release(); }
});

router.delete("/solidarity/initiatives/:id/support", async (req,res): Promise<void> => { const userId=req.session?.userId,id=Number(req.params.id); if(!userId){res.status(401).json({error:"Login required"});return;} const r=await pool.query(`DELETE FROM solidarity_supports s USING solidarity_initiatives i WHERE s.initiative_id=i.id AND s.initiative_id=$1 AND s.user_id=$2 AND i.status='open' RETURNING s.id`,[id,userId]); if(!r.rows.length){res.status(409).json({error:"Support cannot be withdrawn"});return;} res.json({supported:false}); });
router.patch("/solidarity/initiatives/:id", async (req,res): Promise<void> => { const userId=req.session?.userId,id=Number(req.params.id); if(!userId){res.status(401).json({error:"Login required"});return;} if(req.body?.status!=="cancelled"){res.status(400).json({error:"Only cancellation is allowed"});return;} const r=await pool.query("UPDATE solidarity_initiatives SET status='cancelled' WHERE id=$1 AND creator_id=$2 AND status='open' RETURNING id",[id,userId]); if(!r.rows.length){res.status(403).json({error:"Cannot cancel initiative"});return;} res.json({ok:true}); });
router.get("/solidarity/status", async (req,res): Promise<void> => {const id=req.session?.userId;if(!id){res.status(401).json({error:"Login required"});return;}res.json({profile:await profile(id)});});
router.put("/solidarity/status", async (req,res): Promise<void> => {const id=req.session?.userId;if(!id){res.status(401).json({error:"Login required"});return;} const {status,statusVisible}=req.body??{};if(!STATUSES.has(status)||typeof statusVisible!=="boolean"){res.status(400).json({error:"Invalid status"});return;} await pool.query("INSERT INTO citizen_solidarity_profiles (user_id,status,status_visible) VALUES ($1,$2,$3) ON CONFLICT (user_id) DO UPDATE SET status=$2,status_visible=$3,updated_at=now()",[id,status,statusVisible]);res.json({profile:await profile(id)});});
router.get("/solidarity/blocks", async (req,res): Promise<void> => {const id=req.session?.userId;if(!id){res.status(401).json({error:"Login required"});return;}const r=await pool.query("SELECT u.id,u.username FROM citizen_blocks b JOIN users u ON u.id=b.blocked_id WHERE b.blocker_id=$1 ORDER BY u.username",[id]);res.json({blocks:r.rows});});
router.post("/solidarity/blocks/:userId", async (req,res): Promise<void> => {const id=req.session?.userId,target=Number(req.params.userId);if(!id){res.status(401).json({error:"Login required"});return;}if(!Number.isInteger(target)||target===id){res.status(400).json({error:"Invalid citizen"});return;}const u=await pool.query("SELECT 1 FROM users WHERE id=$1",[target]);if(!u.rows.length){res.status(404).json({error:"Citizen not found"});return;}await pool.query("INSERT INTO citizen_blocks (blocker_id,blocked_id) VALUES ($1,$2) ON CONFLICT (blocker_id,blocked_id) DO NOTHING",[id,target]);res.json({blocked:true});});
router.delete("/solidarity/blocks/:userId", async (req,res): Promise<void> => {const id=req.session?.userId,target=Number(req.params.userId);if(!id){res.status(401).json({error:"Login required"});return;}await pool.query("DELETE FROM citizen_blocks WHERE blocker_id=$1 AND blocked_id=$2",[id,target]);res.json({blocked:false});});
export default router;