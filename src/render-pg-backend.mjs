import net from 'node:net';
import tls from 'node:tls';
import crypto from 'node:crypto';

/**
 * Cliente PostgreSQL minimalista (wire protocol v3 + TLS + SCRAM-SHA-256) sin dependencias npm,
 * para conectar el gateway ReKids Sandbox directamente a Render PostgreSQL (o cualquier PostgreSQL)
 * invocando únicamente public.integration_catalog_read(...).
 */
export function executePgQuery(connectionUrl, sql, params = []) {
  const parsed = new URL(connectionUrl);
  const host = parsed.hostname;
  const port = Number(parsed.port || 5432);
  const user = decodeURIComponent(parsed.username);
  const password = decodeURIComponent(parsed.password);
  const database = parsed.pathname.replace(/^\//, '');

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('PostgreSQL connection timeout'));
    }, 10000);

    let rawSocket = null;
    let tlsSocket = null;

    function cleanup() {
      clearTimeout(timeout);
      try { if (tlsSocket) tlsSocket.destroy(); } catch {}
      try { if (rawSocket) rawSocket.destroy(); } catch {}
    }

    rawSocket = net.connect(port, host, () => {
      // SSLRequest message
      const sslReq = Buffer.alloc(8);
      sslReq.writeInt32BE(8, 0);
      sslReq.writeInt32BE(80877103, 4);
      rawSocket.write(sslReq);
    });

    rawSocket.on('error', (err) => { cleanup(); reject(err); });

    rawSocket.once('data', (chunk) => {
      if (chunk[0] === 0x53) { // 'S' -> SSL supported
        tlsSocket = tls.connect(
          { socket: rawSocket, servername: host, rejectUnauthorized: false },
          () => sendStartup(tlsSocket)
        );
        tlsSocket.on('error', (err) => { cleanup(); reject(err); });
        attachProtocolHandler(tlsSocket);
      } else if (chunk[0] === 0x4e) { // 'N' -> Internal Render network without SSL
        attachProtocolHandler(rawSocket);
        sendStartup(rawSocket);
      } else {
        cleanup();
        return reject(new Error('Unexpected PostgreSQL SSL handshake response'));
      }
    });

    function sendStartup(sock) {
      const kv = Buffer.concat([
        Buffer.from(`user\0${user}\0database\0${database}\0client_encoding\0UTF8\0\0`, 'utf8')
      ]);
      const buf = Buffer.alloc(8 + kv.length);
      buf.writeInt32BE(buf.length, 0);
      buf.writeInt32BE(196608, 4); // protocol 3.0
      kv.copy(buf, 8);
      sock.write(buf);
    }

    function sendPacket(sock, typeChar, payloadBuf) {
      const out = Buffer.alloc(1 + 4 + payloadBuf.length);
      out.write(typeChar, 0, 1, 'ascii');
      out.writeInt32BE(4 + payloadBuf.length, 1);
      payloadBuf.copy(out, 5);
      sock.write(out);
    }

    function attachProtocolHandler(sock) {
      let buffer = Buffer.alloc(0);
      let clientNonce = '';
      let clientFirstBare = '';
      let serverSignature = null;
      const rows = [];

      sock.on('data', (data) => {
        buffer = Buffer.concat([buffer, data]);
        while (buffer.length >= 5) {
          const type = String.fromCharCode(buffer[0]);
          const len = buffer.readInt32BE(1);
          if (buffer.length < 1 + len) break;
          const body = buffer.subarray(5, 1 + len);
          buffer = buffer.subarray(1 + len);
          handleMessage(sock, type, body);
        }
      });

      function handleMessage(sock, type, body) {
        if (type === 'R') {
          const authType = body.readInt32BE(0);
          if (authType === 0) {
            // Auth OK -> wait for ReadyForQuery ('Z')
          } else if (authType === 10) {
            // SASL (SCRAM-SHA-256)
            clientNonce = crypto.randomBytes(18).toString('base64');
            clientFirstBare = `n=,r=${clientNonce}`;
            const clientFirst = `n,,${clientFirstBare}`;
            const mech = Buffer.from('SCRAM-SHA-256\0', 'utf8');
            const cfBuf = Buffer.from(clientFirst, 'utf8');
            const lenBuf = Buffer.alloc(4);
            lenBuf.writeInt32BE(cfBuf.length, 0);
            sendPacket(sock, 'p', Buffer.concat([mech, lenBuf, cfBuf]));
          } else if (authType === 11) {
            // SASLContinue
            const serverFirst = body.subarray(4).toString('utf8');
            const parts = Object.fromEntries(serverFirst.split(',').map(p => [p[0], p.slice(2)]));
            const salt = Buffer.from(parts.s, 'base64');
            const iter = Number(parts.i);
            const rNonce = parts.r;
            if (!rNonce.startsWith(clientNonce)) {
              cleanup();
              return reject(new Error('Invalid SCRAM nonce'));
            }
            const clientFinalWithoutProof = `c=biws,r=${rNonce}`;
            const saltedPassword = crypto.pbkdf2Sync(password, salt, iter, 32, 'sha256');
            const clientKey = crypto.createHmac('sha256', saltedPassword).update('Client Key').digest();
            const storedKey = crypto.createHash('sha256').update(clientKey).digest();
            const authMsg = `${clientFirstBare},${serverFirst},${clientFinalWithoutProof}`;
            const clientSig = crypto.createHmac('sha256', storedKey).update(authMsg).digest();
            const clientProof = Buffer.alloc(clientKey.length);
            for (let i = 0; i < clientKey.length; i++) clientProof[i] = clientKey[i] ^ clientSig[i];
            const serverKey = crypto.createHmac('sha256', saltedPassword).update('Server Key').digest();
            serverSignature = crypto.createHmac('sha256', serverKey).update(authMsg).digest('base64');
            const clientFinal = `${clientFinalWithoutProof},p=${clientProof.toString('base64')}`;
            sendPacket(sock, 'p', Buffer.from(clientFinal, 'utf8'));
          } else if (authType === 12) {
            // SASLFinal
            const serverFinal = body.subarray(4).toString('utf8');
            if (!serverFinal.includes(`v=${serverSignature}`)) {
              cleanup();
              return reject(new Error('SCRAM server signature mismatch'));
            }
          } else if (authType === 3) {
            sendPacket(sock, 'p', Buffer.from(password + '\0', 'utf8'));
          } else {
            cleanup();
            return reject(new Error(`Unsupported PG auth type: ${authType}`));
          }
        } else if (type === 'Z') {
          if (rows.length === 0 && !sock._querySent) {
            sock._querySent = true;
            sendExtendedQuery(sock, sql, params);
          } else {
            sendPacket(sock, 'X', Buffer.alloc(0));
            cleanup();
            resolve(rows);
          }
        } else if (type === 'D') {
          const numCols = body.readInt16BE(0);
          let offset = 2;
          const row = [];
          for (let i = 0; i < numCols; i++) {
            const colLen = body.readInt32BE(offset);
            offset += 4;
            if (colLen === -1) {
              row.push(null);
            } else {
              row.push(body.subarray(offset, offset + colLen).toString('utf8'));
              offset += colLen;
            }
          }
          rows.push(row);
        } else if (type === 'E') {
          cleanup();
          reject(new Error('PostgreSQL query execution error'));
        }
      }

      function sendExtendedQuery(sock, queryText, queryParams) {
        // Parse ('P')
        const qBuf = Buffer.from(queryText + '\0', 'utf8');
        const parsePayload = Buffer.concat([Buffer.from('\0', 'utf8'), qBuf, Buffer.alloc(2)]);
        sendPacket(sock, 'P', parsePayload);

        // Bind ('B')
        const paramCountBuf = Buffer.alloc(2);
        paramCountBuf.writeInt16BE(queryParams.length, 0);
        const paramChunks = [Buffer.from('\0\0', 'utf8'), Buffer.alloc(2), paramCountBuf];
        for (const p of queryParams) {
          if (p === null || p === undefined) {
            const nullLen = Buffer.alloc(4);
            nullLen.writeInt32BE(-1, 0);
            paramChunks.push(nullLen);
          } else {
            const valBuf = Buffer.from(String(p), 'utf8');
            const lenBuf = Buffer.alloc(4);
            lenBuf.writeInt32BE(valBuf.length, 0);
            paramChunks.push(lenBuf, valBuf);
          }
        }
        paramChunks.push(Buffer.alloc(2)); // default text result format
        sendPacket(sock, 'B', Buffer.concat(paramChunks));

        // Execute ('E')
        const execPayload = Buffer.alloc(5);
        execPayload[0] = 0;
        execPayload.writeInt32BE(0, 1);
        sendPacket(sock, 'E', execPayload);

        // Sync ('S')
        sendPacket(sock, 'S', Buffer.alloc(0));
      }
    }
  });
}

export function renderPostgresBackend(env = process.env) {
  const enabled = env.REKIDS_SANDBOX_ENABLED === 'true';
  if (!enabled) return { enabled: false, environment: 'test', read: async () => { throw Error('Disabled'); } };
  const pgUrl = env.RENDER_DATABASE_URL || env.DATABASE_URL || '';
  if (!pgUrl.startsWith('postgres://') && !pgUrl.startsWith('postgresql://')) {
    throw Error('Configurar RENDER_DATABASE_URL o DATABASE_URL con la cadena postgres:// de Render PostgreSQL.');
  }
  const sql = `SELECT public.integration_catalog_read($1::text, 'test'::text, $2::text, $3::uuid, $4::uuid, $5::uuid, $6::integer, $7::uuid)::text`;
  return {
    enabled: true,
    environment: 'test',
    read: async (args) => {
      if (args.p_environment !== 'test') throw Error('Sandbox only');
      const rows = await executePgQuery(pgUrl, sql, [
        args.p_token,
        args.p_operation,
        args.p_branch,
        args.p_product,
        args.p_after,
        args.p_limit,
        args.p_request_id
      ]);
      if (!rows.length || !rows[0][0]) throw Error('Empty RPC response');
      return JSON.parse(rows[0][0]);
    }
  };
}
