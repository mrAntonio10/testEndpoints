import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { integrationRead } from './src/integration-http.ts';
import { sandboxBackend } from './src/backend.mjs';

export function createSandboxServer(deps=sandboxBackend()) {
  const server=createServer({maxHeaderSize:8192},async(req,res)=>{
    try {
      if(!req.url || req.url.length>4096){res.writeHead(414);res.end();return;}
      const url=new URL(req.url,'http://sandbox.invalid');
      if(url.pathname==='/health' && req.method==='GET'){
        res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});
        res.end(JSON.stringify({service:'rekids-api-sandbox',environment:'test',configured:deps.enabled}));return;
      }
      const root='/integrations/v1';let kind;let productId;
      if(url.pathname===`${root}/branches`)kind='branches';
      else if(url.pathname===`${root}/products`)kind='products';
      else if(new RegExp(`^${root}/products/[^/]+$`).test(url.pathname)){
        kind='product';productId=url.pathname.split('/').pop();
      }
      if(!kind){res.writeHead(404,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({code:'NOT_FOUND',message:'Ruta no disponible en este sandbox.'}));return;}
      // No body parser, cookie session, CORS wildcard, or generic proxy to tables.
      const headers=new Headers();
      if(typeof req.headers.authorization==='string')headers.set('authorization',req.headers.authorization);
      const request=new Request(url,{method:req.method,headers});
      const response=await integrationRead(request,kind,productId,deps);
      const outgoing=Object.fromEntries(response.headers);
      if(response.status===405)outgoing.Allow='GET';
      res.writeHead(response.status,outgoing);
      res.end(req.method==='HEAD' ? undefined : await response.text());
    }catch{
      res.writeHead(503,{'Content-Type':'application/json','Cache-Control':'no-store'});
      res.end(JSON.stringify({code:'TEMPORARILY_UNAVAILABLE',message:'No se pudo consultar el sandbox.'}));
    }finally{req.resume();}
  });
  server.requestTimeout=15000;server.headersTimeout=10000;server.maxRequestsPerSocket=100;
  return server;
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try {
    const server=createSandboxServer();
    const port=Number(process.env.PORT ?? 8080);
    if(!Number.isInteger(port)||port<1||port>65535)throw Error('Puerto inválido.');
    server.listen(port,process.env.HOST ?? '0.0.0.0',()=>console.log(`ReKids sandbox HTTP iniciado en puerto ${port}. Solo datos ficticios y entorno test.`));
    const stop=()=>server.close(()=>process.exit(0));
    process.on('SIGTERM',stop);process.on('SIGINT',stop);
  }catch(error){console.error(error.message);process.exitCode=1;}
}
