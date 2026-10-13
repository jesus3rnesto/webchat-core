import { sql } from '../../lib/db.js';
import {
  generateSessionCode,
  hashPassword,
  hashIdentifier,
  getClientIp,
  sessionExpiryDate,
  isValidDeviceId,
  isValidPassword,
  CONFIG,
} from '../../lib/security.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Metodo no permitido.' });
  }

  const { deviceId, password } = req.body || {};

  if (!isValidDeviceId(deviceId)) {
    return res.status(400).json({ error: 'Identificador de dispositivo invalido.' });
  }
  if (!isValidPassword(password)) {
    return res.status(400).json({ error: 'La contrasena debe tener entre 6 y 128 caracteres.' });
  }

  const deviceHash = hashIdentifier(deviceId);
  const ipHash = hashIdentifier(getClientIp(req));
  const windowStart = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();

  try {
    const [{ count: byDevice }] = await sql`
      SELECT count(*)::int AS count FROM sessions
      WHERE creator_device_hash = ${deviceHash} AND created_at > ${windowStart}
    `;
    const [{ count: byIp }] = await sql`
      SELECT count(*)::int AS count FROM sessions
      WHERE creator_ip_hash = ${ipHash} AND created_at > ${windowStart}
    `;

    if (byDevice >= CONFIG.MAX_SESSIONS_PER_WINDOW || byIp >= CONFIG.MAX_SESSIONS_PER_WINDOW) {
      return res.status(429).json({
        error: `Ya creaste el maximo de ${CONFIG.MAX_SESSIONS_PER_WINDOW} sesiones en los ultimos 3 dias. Intenta mas tarde.`,
      });
    }

    const passwordHash = await hashPassword(password);
    const expiresAt = sessionExpiryDate();

    let code;
    let inserted = null;
    for (let attempt = 0; attempt < 5 && !inserted; attempt++) {
      code = generateSessionCode();
      try {
        const rows = await sql`
          INSERT INTO sessions (code, password_hash, creator_device_hash, creator_ip_hash, status, expires_at)
          VALUES (${code}, ${passwordHash}, ${deviceHash}, ${ipHash}, 'waiting', ${expiresAt.toISOString()})
          RETURNING code, expires_at
        `;
        inserted = rows[0];
      } catch (err) {
        if (!String(err.message).includes('duplicate key')) throw err;
        // codigo repetido: probamos de nuevo con uno nuevo
      }
    }

    if (!inserted) {
      return res.status(500).json({ error: 'No se pudo generar un codigo unico, intenta de nuevo.' });
    }

    return res.status(201).json({
      code: inserted.code,
      expiresAt: inserted.expires_at,
    });
  } catch (err) {
    console.error('session/create error:', err);
    return res.status(500).json({ error: 'Error interno al crear la sesion.' });
  }
}
