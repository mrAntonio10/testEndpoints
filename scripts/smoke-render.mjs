import { spawn } from 'node:child_process';
import { createSandboxServer } from '../server.mjs';
import { renderPostgresBackend } from '../src/render-pg-backend.mjs';

const port = Number(process.env.PORT ?? 8090);
const server = createSandboxServer(renderPostgresBackend(process.env));

await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
console.log(`Gateway ReKids Sandbox (Render PostgreSQL) escuchando en http://localhost:${port}`);

try {
  const exitCode = await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ['scripts/smoke.mjs'],
      {
        stdio: 'inherit',
        env: {
          ...process.env,
          API_BASE_URL: `http://localhost:${port}`,
          REKIDS_CREDENTIAL_FILE: process.env.REKIDS_CREDENTIAL_FILE ?? '.secrets/sandbox-credential.json'
        }
      }
    );
    child.on('error', reject);
    child.on('exit', (code) => resolve(code ?? 1));
  });
  if (exitCode !== 0) process.exitCode = exitCode;
} finally {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
}
