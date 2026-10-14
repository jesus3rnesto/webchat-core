import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';

const SECRET = process.env.APP_SECRET || '';
if (!SECRET) {
  // No tiramos el proceso abajo para no romper el build, pero avisamos fuerte.
  console.error('ADVERTENCIA: APP_SECRET no esta configurado. Configuralo en Vercel.');
}

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // sin 0/O/1/I/L para evitar confusiones
const SESSION_DAYS = 3;
const MAX_SESSIONS_PER_WINDOW = 3;
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

export function generateSessionCode(length = 8) {
  let code = '';
  const bytes = crypto.randomBytes(length);
  for (let i = 0; i < length; i++) {
    code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return code;
}

export async function hashPassword(password) {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

// Hash de identificadores (deviceId, IP) con un secreto del servidor como "pepper".
// Asi nunca guardamos la IP ni el deviceId en texto plano en la base de datos.
export function hashIdentifier(value) {
  return crypto.createHash('sha256').update(SECRET + ':' + value).digest('hex');
}

export function getClientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length > 0) {
    return fwd.split(',')[0].trim();
  }
  return req.socket?.remoteAddress || 'unknown';
}

export function sessionExpiryDate() {
  return new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
}

// El deviceId de las peticiones GET viaja en la cabecera X-Device-Id y no en la URL,
// para que no quede escrito en los logs de acceso (las URLs si se registran).
export function getDeviceIdFromHeader(req) {
  const v = req.headers['x-device-id'];
  return Array.isArray(v) ? v[0] : v;
}

export function isValidDeviceId(id) {
  return typeof id === 'string' && /^[A-Za-z0-9-]{10,64}$/.test(id);
}

export function isValidPassword(pw) {
  return typeof pw === 'string' && pw.length >= 6 && pw.length <= 128;
}

export function isValidCode(code) {
  return typeof code === 'string' && /^[A-Z0-9]{6,12}$/.test(code);
}

export function isValidTextMessage(text) {
  return typeof text === 'string' && text.trim().length > 0 && text.length <= 2000;
}

// Solo aceptamos una URL https que apunte a un .gif: nunca un archivo subido por el usuario.
export function isValidGifUrl(url) {
  if (typeof url !== 'string' || url.length > 500) return false;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && /\.gif($|\?)/i.test(u.pathname + u.search);
  } catch {
    return false;
  }
}

// Quita cualquier etiqueta HTML por si algun punto del front llegara a usar innerHTML.
// El cliente ya renderiza con textContent, esto es una segunda capa de defensa.
export function stripHtml(str) {
  return String(str).replace(/<\/?[^>]+(>|$)/g, '');
}

export const CONFIG = {
  SESSION_DAYS,
  MAX_SESSIONS_PER_WINDOW,
  MAX_FAILED_ATTEMPTS,
  LOCKOUT_MINUTES,
};
