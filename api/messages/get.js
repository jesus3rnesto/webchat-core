import { sql } from '../../lib/db.js';
import { hashIdentifier, isValidDeviceId, isValidCode, getDeviceIdFromHeader } from '../../lib/security.js';
import { expireSession } from '../../lib/expiry.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Metodo no permitido.' });
  }

  const { code, after } = req.query;
  const deviceId = getDeviceIdFromHeader(req);
  const afterId = Number.parseInt(after, 10) || 0;

  if (!isValidCode(code) || !isValidDeviceId(deviceId)) {
    return res.status(400).json({ error: 'Parametros invalidos.' });
  }

  const deviceHash = hashIdentifier(deviceId);

  try {
    const rows = await sql`SELECT * FROM sessions WHERE code = ${code.toUpperCase()}`;
    const session = rows[0];
    if (!session) return res.status(404).json({ error: 'Sesion no encontrada.' });

    let role = null;
    if (session.creator_device_hash === deviceHash) role = 'creator';
    else if (session.joiner_device_hash === deviceHash) role = 'joiner';
    if (!role) return res.status(403).json({ error: 'No perteneces a esta sesion.' });

    const otherPresent = role === 'creator' ? !!session.joiner_device_hash : true;

    // Sesion vencida: se borran todos sus mensajes y no se devuelve ninguno.
    if (new Date(session.expires_at) <= new Date()) {
      await expireSession(session);
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json({
        messages: [],
        status: 'expired',
        expiresAt: session.expires_at,
        otherPresent,
      });
    }

    const messages = await sql`
      SELECT id, sender, msg_type, content, created_at FROM messages
      WHERE session_id = ${session.id} AND id > ${afterId}
      ORDER BY id ASC
      LIMIT 200
    `;

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({
      messages,
      status: session.status,
      expiresAt: session.expires_at,
      otherPresent,
    });
  } catch (err) {
    console.error('messages/get error:', err);
    return res.status(500).json({ error: 'Error interno al obtener mensajes.' });
  }
}
