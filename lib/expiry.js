import { sql } from './db.js';

// Borra TODOS los mensajes de una sesion vencida y la marca como expirada.
// Es idempotente: si ya estaba limpia, simplemente no borra nada.
export async function expireSession(session) {
  await sql`DELETE FROM messages WHERE session_id = ${session.id}`;
  if (session.status !== 'expired') {
    await sql`UPDATE sessions SET status = 'expired' WHERE id = ${session.id}`;
  }
}

// Limpieza general de todas las sesiones vencidas (la usa el cron diario y, de forma
// oportunista, la creacion de sesiones):
//  1) borra los mensajes de cualquier sesion vencida,
//  2) las marca como 'expired',
//  3) elimina la fila de la sesion un dia despues de vencer.
// Borrar sesiones vencidas no afecta el limite de "3 sesiones cada 3 dias", porque una
// sesion vencida ya salio de esa ventana de 3 dias.
export async function purgeExpiredSessions() {
  await sql`
    DELETE FROM messages
    WHERE session_id IN (SELECT id FROM sessions WHERE expires_at <= now())
  `;
  await sql`
    UPDATE sessions SET status = 'expired'
    WHERE expires_at <= now() AND status <> 'expired'
  `;
  await sql`DELETE FROM sessions WHERE expires_at <= now() - interval '1 day'`;
}
