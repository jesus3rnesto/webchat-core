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
 
    // Identificamos el rol de este dispositivo. El creador (persona 1) tiene su propio
    // identificador (creator_device_hash), asi que siempre puede volver a su sesion.
    const isCreator = session.creator_device_hash === deviceHash;
    const isJoiner = !!session.joiner_device_hash && session.joiner_device_hash === deviceHash;
 
    // Solo se bloquea a un dispositivo que NO es ni el creador ni la persona 2 registrada,
    // cuando el lugar de persona 2 ya esta ocupado (aunque tenga la contrasena).
    if (!isCreator && !isJoiner && session.joiner_device_hash) {
      return res.status(403).json({ error: 'Esta sesion ya tiene una segunda persona conectada desde otro dispositivo.' });
    }
 
    if (session.locked_until && new Date(session.locked_until) > new Date()) {
      return res.status(423).json({ error: 'Demasiados intentos fallidos. Intenta de nuevo mas tarde.' });
    }
 
    // La contrasena se valida siempre, tanto para entrar por primera vez como para
    // reconectarse desde un dispositivo ya registrado (creador o persona 2).
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
 
    await sql`
      UPDATE sessions SET failed_attempts = 0, locked_until = NULL WHERE id = ${session.id}
    `;
 
    if (isCreator) {
      return res.status(200).json({ role: 'creator', expiresAt: session.expires_at });
    }
 
    if (isJoiner) {
      return res.status(200).json({ role: 'joiner', expiresAt: session.expires_at });
    }
 
    // Nadie ha tomado el lugar de "persona 2" todavia: lo registramos a esta maquina.
    // La condicion en el WHERE evita que dos dispositivos ganen la carrera al mismo tiempo.
    await sql`
      UPDATE sessions
      SET joiner_device_hash = ${deviceHash}, status = 'active'
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
