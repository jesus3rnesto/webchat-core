import { sql } from '../../lib/db.js';
import {
  hashIdentifier,
  isValidDeviceId,
  isValidCode,
  isValidTextMessage,
  isValidGifUrl,
  stripHtml,
} from '../../lib/security.js';
import { expireSession } from '../../lib/expiry.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Metodo no permitido.' });
  }

  const { code, deviceId, type, content } = req.body || {};

  if (!isValidCode(code) || !isValidDeviceId(deviceId)) {
    return res.status(400).json({ error: 'Parametros invalidos.' });
  }
  if (type !== 'text' && type !== 'gif') {
    return res.status(400).json({ error: 'Tipo de mensaje invalido.' });
  }
  if (type === 'text' && !isValidTextMessage(content)) {
    return res.status(400).json({ error: 'Mensaje invalido (vacio o demasiado largo).' });
  }
  if (type === 'gif' && !isValidGifUrl(content)) {
    return res.status(400).json({ error: 'La URL del GIF debe ser https y terminar en .gif' });
  }

  const deviceHash = hashIdentifier(deviceId);

  try {
    const rows = await sql`SELECT * FROM sessions WHERE code = ${code.toUpperCase()}`;
    const session = rows[0];
    if (!session) return res.status(404).json({ error: 'Sesion no encontrada.' });

    if (new Date(session.expires_at) <= new Date() || session.status === 'expired') {
      await expireSession(session);
      return res.status(410).json({ error: 'La sesion expiro.' });
    }

    let sender;
    if (session.creator_device_hash === deviceHash) sender = 'creator';
    else if (session.joiner_device_hash === deviceHash) sender = 'joiner';
    else return res.status(403).json({ error: 'No perteneces a esta sesion.' });

    // Freno simple contra spam: maximo 10 mensajes en los ultimos 5 segundos por emisor.
    const [{ count: recentCount }] = await sql`
      SELECT count(*)::int AS count FROM messages
      WHERE session_id = ${session.id} AND sender = ${sender} AND created_at > now() - interval '5 seconds'
    `;
    if (recentCount >= 10) {
      return res.status(429).json({ error: 'Estas enviando mensajes demasiado rapido.' });
    }

    const safeContent = type === 'text' ? stripHtml(content).trim() : content;

    const [message] = await sql`
      INSERT INTO messages (session_id, sender, msg_type, content)
      VALUES (${session.id}, ${sender}, ${type}, ${safeContent})
      RETURNING id, sender, msg_type, content, created_at
    `;

    return res.status(201).json({ message });
  } catch (err) {
    console.error('messages/send error:', err);
    return res.status(500).json({ error: 'Error interno al enviar el mensaje.' });
  }
}
