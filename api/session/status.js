import { sql } from '../../lib/db.js';
import { hashIdentifier, isValidDeviceId, isValidCode, getDeviceIdFromHeader } from '../../lib/security.js';
import { expireSession } from '../../lib/expiry.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Metodo no permitido.' });
  }

  const { code } = req.query;
  const deviceId = getDeviceIdFromHeader(req);

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

    const expired = new Date(session.expires_at) <= new Date();
    if (expired) await expireSession(session);

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({
      role,
      status: expired ? 'expired' : session.status,
      expiresAt: session.expires_at,
      otherPresent: role === 'creator' ? !!session.joiner_device_hash : true,
    });
  } catch (err) {
    console.error('session/status error:', err);
    return res.status(500).json({ error: 'Error interno.' });
  }
}
