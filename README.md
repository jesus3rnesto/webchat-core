# Línea directa — mensajería por código de sesión

App de mensajería efímera: una persona genera un código + contraseña de sesión,
se lo comparte a una sola persona, y conversan durante 3 días. En cuanto la
segunda persona entra desde su dispositivo, ningún otro dispositivo puede
tomar su lugar aunque tenga la contraseña.

## Qué incluye cada carpeta

```
public/        Frontend (HTML, CSS, JS) — se sirve tal cual, sin build.
api/           Funciones serverless de Vercel (Node.js).
lib/           Código compartido: conexión a la base y utilidades de seguridad.
schema.sql     Script para crear las tablas en Neon.
vercel.json    Cabeceras de seguridad (CSP, X-Frame-Options, etc.)
.env.example   Plantilla de variables de entorno.
```

## Paso 1 — Crear la base de datos en Neon

1. Entrá a https://neon.tech y creá una cuenta (o iniciá sesión).
2. Creá un **proyecto nuevo**. Neon te crea automáticamente una base llamada `neondb`.
3. En el panel del proyecto, abrí **SQL Editor**.
4. Pegá el contenido completo del archivo `schema.sql` de este proyecto y ejecutalo (Run).
   Esto crea las tablas `sessions` y `messages`.
5. Andá a **Connection Details** (o "Connect") y copiá la cadena de conexión
   en modo **pooled connection** (la que tiene `-pooler` en el host). Se ve así:
   ```
   postgresql://usuario:password@ep-xxxx-pooler.region.aws.neon.tech/neondb?sslmode=require
   ```
   La vas a necesitar en el paso 3.

## Paso 2 — Subir el proyecto a un repositorio

Vercel despliega desde un repositorio de GitHub, GitLab o Bitbucket.

1. Creá un repositorio nuevo (por ejemplo en GitHub).
2. Subí todos los archivos de esta carpeta tal como están:
   ```
   git init
   git add .
   git commit -m "Primera version"
   git branch -M main
   git remote add origin https://github.com/TU-USUARIO/TU-REPO.git
   git push -u origin main
   ```
   (El archivo `.env` real **nunca** se sube; por eso está en `.gitignore` — creá
   ese archivo si todavía no existe y agregá la línea `.env`.)

## Paso 3 — Desplegar en Vercel

1. Entrá a https://vercel.com y creá una cuenta (podés usar la de GitHub).
2. Click en **Add New → Project** e importá el repositorio que acabás de subir.
3. Vercel va a detectar las funciones en `api/` automáticamente. No hace falta
   configurar ningún "build command" especial.
4. Antes de desplegar, abrí **Environment Variables** y agregá:
   - `DATABASE_URL` → la cadena de conexión de Neon que copiaste en el paso 1.
   - `APP_SECRET` → una cadena propia, larga y aleatoria (podés generarla con
     `openssl rand -hex 32` en una terminal, o cualquier generador de contraseñas
     largas). Esto se usa para proteger los identificadores de dispositivo e IP,
     nunca lo compartas ni lo subas al repositorio.
5. Click en **Deploy**. En un minuto vas a tener una URL tipo
   `https://tu-proyecto.vercel.app`.

## Paso 4 — Probarlo

1. Abrí la URL que te dio Vercel.
2. Click en **Generar código de sesión**, poné una contraseña, anotá el código.
3. Click en **Entrar al chat**. El navegador te va a pedir permiso para mandar
   notificaciones — aceptalo si querés que te avise cuando la sesión esté por
   expirar.
4. Desde otro dispositivo (o una ventana de incógnito, que simula otro navegador),
   entrá a la misma URL, click en **Unirse a una sesión**, ingresá el código y
   la contraseña.
5. Listo: ya pueden chatear. Si un tercer dispositivo intenta unirse con el
   mismo código y contraseña, el servidor lo va a rechazar porque el lugar de
   "persona 2" ya está ocupado.

## Notas de seguridad ya incluidas

- Las contraseñas se guardan con **bcrypt** (hash + salt), nunca en texto plano.
- El código de sesión se genera con un generador aleatorio criptográfico
  (`crypto.randomBytes`), no con `Math.random()`.
- El identificador de dispositivo y la IP se guardan **hasheados** (SHA-256 +
  un secreto del servidor), nunca en texto plano.
- Todas las consultas a la base usan parámetros (vía `@neondatabase/serverless`),
  lo que evita inyección SQL.
- El mensaje de texto se renderiza con `textContent` en el navegador (nunca
  `innerHTML`), lo que evita que alguien inyecte HTML o scripts en el chat.
- Los GIFs solo se aceptan como **enlace https** que termine en `.gif`; no hay
  ningún endpoint que reciba archivos subidos.
- Después de 5 intentos de contraseña incorrectos para unirse a una sesión, esa
  sesión se bloquea 15 minutos.
- Cada sesión expira sola a los 3 días (se valida en el servidor en cada
  pedido, no solo en el navegador), y cada persona puede crear como máximo 3
  sesiones en una ventana móvil de 3 días.
- Cabeceras de seguridad (CSP, X-Frame-Options, Referrer-Policy) configuradas
  en `vercel.json`.

## Limitaciones a tener en cuenta

- El chat usa *polling* (el navegador pregunta cada 3 segundos si hay mensajes
  nuevos) en vez de WebSockets, porque las funciones serverless de Vercel no
  mantienen conexiones abiertas. Para un chat con menos de 3 segundos de
  latencia percibida, se podría migrar a un servicio como Pusher o Ably.
- El límite de "3 sesiones cada 3 días" se controla por dispositivo (guardado
  en `localStorage`) y por IP. Si alguien borra los datos del navegador o
  cambia de red, en teoría podría crear sesiones adicionales; para un control
  estricto por persona haría falta un sistema de cuentas con inicio de sesión.
- Las notificaciones de expiración solo funcionan si el usuario dejó la
  pestaña abierta (o el navegador la mantiene en segundo plano) y aceptó el
  permiso de notificaciones.
