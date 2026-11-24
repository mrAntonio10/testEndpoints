import { createSandboxServer } from './server.mjs';
import { renderPostgresBackend } from './src/render-pg-backend.mjs';
import { sandboxBackend } from './src/backend.mjs';

const deps = process.env.RENDER_DATABASE_URL
  ? renderPostgresBackend(process.env)
  : sandboxBackend(process.env);

const server = createSandboxServer(deps);
const port = Number(process.env.PORT ?? 8080);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('Puerto inválido.');
server.listen(port, process.env.HOST ?? '0.0.0.0', () => {
  const mode = process.env.RENDER_DATABASE_URL ? 'Render PostgreSQL' : 'Supabase';
  console.log(`ReKids sandbox HTTP iniciado en puerto ${port} (${mode}). Solo datos ficticios y entorno test.`);
});
const stop = () => server.close(() => process.exit(0));
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
