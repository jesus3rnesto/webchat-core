import { neon } from '@neondatabase/serverless';

if (!process.env.DATABASE_URL) {
  throw new Error('Falta la variable de entorno DATABASE_URL.');
}

// `sql` es una funcion "tagged template": sql`SELECT * FROM x WHERE y = ${valor}`
// El driver parametriza automaticamente los valores interpolados, lo que evita
// inyeccion SQL sin que tengamos que escribir placeholders a mano.
export const sql = neon(process.env.DATABASE_URL);
