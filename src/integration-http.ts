import { randomUUID } from 'node:crypto';

export type ReadKind = 'branches' | 'products' | 'product';
export type ReadArgs = {
  p_token: string; p_environment: 'test' | 'production'; p_operation: ReadKind;
  p_branch: string | null; p_product: string | null; p_after: string | null;
  p_limit: number; p_request_id: string;
};
type Dependencies = {
  enabled: boolean;
  environment: 'test' | 'production';
  read: (args: ReadArgs) => Promise<unknown>;
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const record = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const fields = ['id','code','legacy_code','branch_id','name','category','size','brand','condition','price','currency','availability','photos','updated_at','version'];
function product(value: unknown) {
  if (!record(value) || !uuid.test(String(value.id)) || !uuid.test(String(value.branch_id))
    || typeof value.price !== 'string' || !/^\d+\.\d{2}$/.test(value.price)
    || !['available','unavailable'].includes(String(value.availability)) || value.currency !== 'BOB'
    || !['code','name','category','condition','updated_at'].every(key=>typeof value[key]==='string')
    || !['legacy_code','size','brand'].every(key=>value[key]===null || typeof value[key]==='string')
    || typeof value.version!=='number' || !Number.isSafeInteger(value.version) || value.version<1
    || !Array.isArray(value.photos)) throw new Error('Invalid commercial response');
  const safe = Object.fromEntries(fields.map(key => [key, value[key]]));
  safe.photos = value.photos.map(photo => {
    if (!record(photo) || !uuid.test(String(photo.id)) || typeof photo.primary!=='boolean'
      || typeof photo.url !== 'string' || !photo.url.startsWith('https://')) throw new Error('Invalid photo');
    return { id: photo.id, url: photo.url, primary: photo.primary };
  });
  return safe;
}
function decodeCursor(cursor: string, branchId: string): string {
  if (cursor.length > 512 || !/^[A-Za-z0-9_-]+$/.test(cursor)) throw new Error('Invalid cursor');
  const value: unknown = JSON.parse(Buffer.from(cursor,'base64url').toString('utf8'));
  if (!record(value) || value.branch !== branchId || typeof value.after !== 'string' || !uuid.test(value.after)) throw new Error('Invalid cursor');
  return value.after;
}

// Pure HTTP boundary: tests inject a fake database; no session/roles of staff.
export async function integrationRead(request: Request, kind: ReadKind, productId: string | undefined, deps: Dependencies): Promise<Response> {
  const requestId = randomUUID();
  const headers: Record<string,string> = {
    'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store, max-age=0',
    'Vary':'Authorization','X-Request-Id':requestId,'X-Content-Type-Options':'nosniff',
  };
  const fail = (status: number, code: string, message: string) => {
    if (status===401) headers['WWW-Authenticate']='Bearer';
    if (status===429 || status===503) headers['Retry-After']='60';
    return new Response(JSON.stringify({code,message,request_id:requestId}),{status,headers});
  };
  if (!deps.enabled) return fail(503,'INTEGRATION_NOT_ENABLED','La integración todavía no está habilitada.');
  if (request.method!=='GET') return fail(405,'METHOD_NOT_ALLOWED','Solo lectura.');
  const authorization=request.headers.get('authorization') ?? '';
  const match=/^Bearer (rk_(?:test|live)_[0-9a-f]{64})$/.exec(authorization);
  if (!match) return fail(401,'UNAUTHORIZED','Credencial de integración ausente o inválida.');
  const token=match[1];
  if ((deps.environment==='test' && !token.startsWith('rk_test_')) || (deps.environment==='production' && !token.startsWith('rk_live_'))) {
    return fail(401,'UNAUTHORIZED','Credencial de integración ausente o inválida.');
  }
  const params=new URL(request.url).searchParams;
  const allowed=kind==='products' ? ['branch_id','cursor','limit'] : [];
  if ([...params.keys()].some(key=>!allowed.includes(key) || params.getAll(key).length!==1)) return fail(400,'INVALID_REQUEST','Parámetros no válidos.');
  const branchId=params.get('branch_id');
  const limitText=params.get('limit') ?? '50';
  if (kind==='products' && (!branchId || !uuid.test(branchId) || !/^\d{1,3}$/.test(limitText) || Number(limitText)<1 || Number(limitText)>100)) {
    return fail(400,'INVALID_REQUEST','Indicá una sucursal válida y un límite entre 1 y 100.');
  }
  if (kind==='product' && (!productId || !uuid.test(productId))) return fail(400,'INVALID_REQUEST','Identificador de producto inválido.');
  let after: string | null=null;
  try { if(params.has('cursor')) after=decodeCursor(params.get('cursor')!,branchId!); }
  catch { return fail(400,'INVALID_REQUEST','Cursor inválido para esta sucursal.'); }
  try {
    const result=await deps.read({p_token:token,p_environment:deps.environment,p_operation:kind,p_branch:branchId,p_product:productId ?? null,p_after:after,p_limit:Number(limitText),p_request_id:requestId});
    if (!record(result)) throw new Error('Invalid API response');
    const status=Number(result.status);
    if (status!==200) {
      const errors: Record<number,[string,string]>={
        400:['INVALID_REQUEST','Solicitud no válida.'],401:['UNAUTHORIZED','Credencial de integración ausente o inválida.'],
        403:['SCOPE_DENIED','La credencial no permite esta operación o sucursal.'],404:['NOT_FOUND','Producto no encontrado.'],
        429:['RATE_LIMITED','Límite de consultas alcanzado.'],
      };
      return errors[status] ? fail(status,...errors[status]) : fail(503,'TEMPORARILY_UNAVAILABLE','No se pudo consultar el catálogo.');
    }
    let data: unknown;
    if (kind==='product') data=product(result.data);
    else {
      if(!record(result.data) || !Array.isArray(result.data.items)) throw new Error('Invalid collection');
      if(kind==='branches') data={items:result.data.items.map(item=>{
        if(!record(item) || !uuid.test(String(item.id)) || typeof item.name!=='string') throw new Error('Invalid branch');
        return {id:item.id,name:item.name};
      })};
      else {
        const next=result.data.next_after;
        if(next!==null && (typeof next!=='string' || !uuid.test(next))) throw new Error('Invalid page');
        const items=result.data.items.map(product);
        if(items.some(item=>item.branch_id!==branchId)) throw new Error('Invalid branch response');
        data={items,next_cursor:next===null?null:Buffer.from(JSON.stringify({branch:branchId,after:next})).toString('base64url')};
      }
    }
    return new Response(JSON.stringify(data),{status:200,headers});
  } catch {
    // Do not echo database errors, tokens, arguments or exception messages.
    return fail(503,'TEMPORARILY_UNAVAILABLE','No se pudo consultar el catálogo.');
  }
}
