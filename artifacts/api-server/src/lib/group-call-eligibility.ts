import { pool } from "@workspace/db";

/** Current PostgreSQL membership is checked in addition to the immutable
 * invitation roster. Leaving a room immediately revokes group-call actions. */
export async function currentGroupCallMember(roomId: number, userId: number): Promise<boolean> {
  const result = await pool.query(
    `SELECT 1
       FROM dm_rooms room
       JOIN dm_room_members member ON member.room_id = room.id
      WHERE room.id = $1 AND room.type = 'group' AND member.user_id = $2
      LIMIT 1`,
    [roomId, userId],
  );
  return result.rows.length > 0;
}