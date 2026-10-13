import { sql } from '../../lib/db.js';
import {
  verifyPassword,
  hashIdentifier,
  isValidDeviceId,
  isValidPassword,
  isValidCode,
  CONFIG,
} from '../../lib/security.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Metodo no permitido.' });
  }

  const { deviceId, code, password } = req.body || {};

  if (!isValidDeviceId(deviceId)) {
    return res.status(400).json({ error: 'Identificador de dispositivo invalido.' });
  }
  if (!isValidCode(code)) {
    return res.status(400).json({ error: 'Codigo de sesion invalido.' });
  }
  if (!isValidPassword(password)) {
    return res.status(400).json({ error: 'Contrasena invalida.' });
  }

  const deviceHash = hashIdentifier(deviceId);

  try {
    const rows = await sql`SELECT * FROM sessions WHERE code = ${code.toUpperCase()}`;
    const session = rows[0];

    if (!session) {
      return res.status(404).json({ error: 'No existe ninguna sesion con ese codigo.' });
    }

    if (new Date(session.expires_at) <= new Date() || session.status === 'expired') {
      return res.status(410).json({ error: 'Esa sesion ya expiro.' });
    }

    // El creador tambien puede "unirse" (reconectar) a su propia sesion con este mismo endpoint
    if (session.creator_device_hash === deviceHash) {
      const ok = await verifyPassword(password, session.password_hash);
      if (!ok) return res.status(401).json({ error: 'Contrasena incorrecta.' });
      return res.status(200).json({ role: 'creator', expiresAt: session.expires_at });
    }

    // Ya hay una segunda persona registrada: solo esa misma maquina puede volver a entrar
    if (session.joiner_device_hash) {
      if (session.joiner_device_hash === deviceHash) {
        return res.status(200).json({ role: 'joiner', expiresAt: session.expires_at });
      }
      return res.status(403).json({ error: 'Esta sesion ya tiene una segunda persona conectada desde otro dispositivo.' });
    }

    if (session.locked_until && new Date(session.locked_until) > new Date()) {
      return res.status(423).json({ error: 'Demasiados intentos fallidos. Intenta de nuevo mas tarde.' });
    }

    const ok = await verifyPassword(password, session.password_hash);

    if (!ok) {
      const attempts = session.failed_attempts + 1;
      const lockedUntil =
        attempts >= CONFIG.MAX_FAILED_ATTEMPTS
          ? new Date(Date.now() + CONFIG.LOCKOUT_MINUTES * 60 * 1000).toISOString()
          : null;
      await sql`
        UPDATE sessions SET failed_attempts = ${attempts}, locked_until = ${lockedUntil}
        WHERE id = ${session.id}
      `;
      return res.status(401).json({ error: 'Contrasena incorrecta.' });
    }

    // Password correcta y nadie ha tomado el lugar de "persona 2": lo registramos a esta maquina
    await sql`
      UPDATE sessions
      SET joiner_device_hash = ${deviceHash}, status = 'active', failed_attempts = 0, locked_until = NULL
      WHERE id = ${session.id} AND joiner_device_hash IS NULL
    `;

    const check = await sql`SELECT joiner_device_hash FROM sessions WHERE id = ${session.id}`;
    if (check[0]?.joiner_device_hash !== deviceHash) {
      // Carrera: otra maquina gano el registro entre el SELECT y el UPDATE
      return res.status(403).json({ error: 'Esta sesion ya tiene una segunda persona conectada.' });
    }

    return res.status(200).json({ role: 'joiner', expiresAt: session.expires_at });
  } catch (err) {
    console.error('session/join error:', err);
    return res.status(500).json({ error: 'Error interno al unirse a la sesion.' });
  }
}
