import { purgeExpiredSessions } from '../../lib/expiry.js';

// Lo llama Vercel Cron una vez al dia (ver "crons" en vercel.json).
// Si defines CRON_SECRET en Vercel, Vercel lo envia como "Authorization: Bearer <secreto>"
// y aqui rechazamos cualquier otra llamada.
export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'No autorizado.' });
  }

  try {
    await purgeExpiredSessions();
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('cron/cleanup error:', err);
    return res.status(500).json({ error: 'Error interno en la limpieza.' });
  }
}
