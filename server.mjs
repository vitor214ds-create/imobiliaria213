import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=path.dirname(fileURLToPath(import.meta.url));
const port=Number(process.env.PORT||8787);
const jobs=new Map(), media=new Map();
const google='https://generativelanguage.googleapis.com/v1beta';
const vsa='https://api.virtualstagingai.app/v2';
const kling='https://api-singapore.klingai.com/v1/videos/image2video';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const allowed=(v,a,d)=>a.includes(v)?v:d;
function required(v,name){if(typeof v!=='string'||!v.trim())throw Error('Configure '+name+' em Conexões.');return v.trim();}
function image(s){const m=typeof s==='string'&&s.match(/^data:(image\/(?:jpeg|png));base64,([A-Za-z0-9+/=]+)$/);if(!m||m[2].length>14e6)throw Error('Envie JPG ou PNG de até 10 MB.');return {mimeType:m[1],data:m[2]};}
function text(v){if(typeof v!=='string'||!v.trim()||v.length>3000)throw Error('Informe um prompt de até 3000 caracteres.');return v.trim();}
function key(c,n){return required(c?.[n]||process.env[n],n);}
async function json(url,{method='GET',headers={},body}={}){
 const r=await fetch(url,{method,headers:{...headers,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(90000),redirect:'error'});
 const d=await r.json().catch(()=>({}));
 if(!r.ok|| (typeof d.code==='number'&&d.code!==0))throw Error('Provedor retornou '+r.status+' — '+String(d.error?.message||d.message||'verifique credenciais, saldo e modelo').slice(0,350));
 return d;
}
async function access(c){if(c.GOOGLE_ACCESS_TOKEN)return c.GOOGLE_ACCESS_TOKEN; if(process.env.GOOGLE_ACCESS_TOKEN)return process.env.GOOGLE_ACCESS_TOKEN;
 try{return (await promisify(execFile)('gcloud',['auth','application-default','print-access-token'],{timeout:30000})).stdout.trim();}catch{throw Error('Autentique o Google Cloud com gcloud auth application-default login ou informe um token de acesso temporário.');}}
function vertex(c,model){const p=required(c.GOOGLE_PROJECT||process.env.GOOGLE_PROJECT,'ID do projeto Google Cloud');if(!/^[a-z][a-z0-9-]{4,62}$/.test(p))throw Error('ID do projeto inválido.');return 'https://us-central1-aiplatform.googleapis.com/v1/projects/'+p+'/locations/us-central1/publishers/google/models/'+model;}
async function vertexHeaders(c){return {Authorization:'Bearer '+await access(c)};}
async function external(url,max=100e6){const u=new URL(url);if(u.protocol!=='https:'||u.username||u.password||u.port||!/(^|\.)(googleapis\.com|virtualstagingai\.app|klingai\.com|kling\.ai|kwai\.net|kuaishou\.com|klingai\.net|cloudfront\.net)$/.test(u.hostname))throw Error('URL de mídia do provedor não reconhecida.');const r=await fetch(u,{redirect:'error',signal:AbortSignal.timeout(90000)});if(!r.ok)throw Error('Não foi possível baixar mídia: '+r.status);const b=Buffer.from(await r.arrayBuffer());if(b.length>max)throw Error('Arquivo acima do limite.');return {b,mime:r.headers.get('content-type')?.split(';')[0]};}
function putMedia(b,mime){const id=randomUUID();media.set(id,{b,mime,at:Date.now()});return '/media/'+id;}
async function stage(b,c){
 const i=image(b.first);
 if(b.provider==='virtual'){
  const headers={Authorization:'Api-Key '+key(c,'VSA_API_KEY')};
  const room=allowed(b.room,['living','bed','kitchen','dining','home_office','outdoor','kids_room'],'living');
  const style=allowed(b.style,['standard','modern','scandinavian','industrial','midcentury','luxury','farmhouse','coastal'],'modern');
  const d=await json(vsa+'/renders',{method:'POST',headers,body:{image_url:b.first,config:{type:'staging',add_furniture:{room_type:room,style},add_virtually_staged_watermark:true},variation_count:1,wait_for_completion:false}});
  if(!d.id)throw Error('Virtual Staging não retornou ID.');
  for(let n=0;n<100;n++){await sleep(3000);const r=await json(vsa+'/renders/'+encodeURIComponent(d.id)+'?include_variations=true',{headers});const a=r.variations?.items||[];const done=a.find(x=>x.status==='done');if(done){const result=Array.isArray(done.result)?done.result[0]:done.result;const {b:buf,mime}=await external(result.url,15e6);return {image:'data:'+(['image/png','image/jpeg'].includes(mime)?mime:'image/jpeg')+';base64,'+buf.toString('base64')};}if(a.length&&a.every(x=>['error','deleted'].includes(x.status)))throw Error('Virtual Staging falhou.');}
  throw Error('Tempo de espera excedido. Render '+d.id+' pode continuar no provedor.');
 }
 const model=allowed(b.imageModel,['gemini-2.5-flash-image','gemini-3-pro-image-preview','gemini-3.1-flash-image-preview'],'gemini-2.5-flash-image');
 const d=await json(google+'/models/'+model+':generateContent',{method:'POST',headers:{'x-goog-api-key':key(c,'GEMINI_API_KEY')},body:{contents:[{parts:[{text:text(b.prompt)},{inlineData:i}]}],generationConfig:{responseModalities:['IMAGE']}}});
 const p=d.candidates?.flatMap(x=>x.content?.parts||[]).find(x=>x.inlineData?.data||x.inline_data?.data);const m=p?.inlineData||p?.inline_data;if(!m)throw Error('Gemini não retornou uma imagem.');const out='data:'+(m.mimeType||m.mime_type||'image/png')+';base64,'+m.data;image(out);return {image:out};
}
async function animate(b,c){
 const first=image(b.first),last=image(b.last),prompt=text(b.prompt);
 const negative='warping, flicker, floating objects, duplicated furniture, architectural changes, abrupt cuts, camera rotation';
 if(b.provider==='kling'){
  const headers={Authorization:'Bearer '+key(c,'KLING_API_KEY')};
  const d=await json(kling,{method:'POST',headers,body:{model_name:'kling-v2-5-turbo',image:first.data,image_tail:last.data,prompt,negative_prompt:negative,duration:allowed(String(b.duration),['5','10'],'5'),mode:'pro'}});
  const id=d.data?.task_id;if(!id)throw Error('Kling não retornou ID.');
  for(let n=0;n<120;n++){await sleep(5000);const r=await json(kling+'/'+encodeURIComponent(id),{headers});const t=r.data;if(t?.task_status==='failed')throw Error(t.task_status_msg||'Kling falhou.');if(t?.task_status==='succeed'){const u=t.task_result?.videos?.[0]?.url;if(!u)throw Error('Kling não retornou vídeo.');return {video:u,remote:true};}}
  throw Error('Tempo excedido. Tarefa Kling '+id+' pode continuar.');
 }
 const model=allowed(b.videoModel,['veo-3.1-fast-generate-001','veo-3.1-generate-001'],'veo-3.1-fast-generate-001'),endpoint=vertex(c,model);
 const params={aspectRatio:allowed(b.ratio,['9:16','16:9'],'9:16'),durationSeconds:8,resolution:allowed(b.resolution,['720p','1080p'],'720p'),sampleCount:1,generateAudio:false,negativePrompt:negative,personGeneration:'disallow'};
 const d=await json(endpoint+':predictLongRunning',{method:'POST',headers:await vertexHeaders(c),body:{instances:[{prompt,image:{mimeType:first.mimeType,bytesBase64Encoded:first.data},lastFrame:{mimeType:last.mimeType,bytesBase64Encoded:last.data}}],parameters:params}});
 if(!d.name)throw Error('Veo não retornou uma operação.');
 for(let n=0;n<120;n++){await sleep(5000);const r=await json(endpoint+':fetchPredictOperation',{method:'POST',headers:await vertexHeaders(c),body:{operationName:d.name}});if(r.error)throw Error(r.error.message||'Veo falhou.');if(r.done){const v=r.response?.videos?.[0];if(!v?.bytesBase64Encoded)throw Error('Veo não retornou vídeo inline; verifique filtros e configuração.');return {video:putMedia(Buffer.from(v.bytesBase64Encoded,'base64'),'video/mp4')};}}
 throw Error('Tempo excedido. Operação '+d.name+' pode continuar no Google Cloud.');
}
async function check(b,c){
 if(b.provider==='gemini'){await json(google+'/models?pageSize=1',{headers:{'x-goog-api-key':key(c,'GEMINI_API_KEY')}});}
 else if(b.provider==='virtual'){await json(vsa+'/user',{headers:{Authorization:'Api-Key '+key(c,'VSA_API_KEY')}});}
 else if(b.provider==='kling'){await json(kling+'?pageNum=1&pageSize=1',{headers:{Authorization:'Bearer '+key(c,'KLING_API_KEY')}});}
 else if(b.provider==='veo'){const endpoint=vertex(c,'veo-3.1-fast-generate-001');const project=endpoint.match(/projects\/([^/]+)/)[1];await json('https://cloudresourcemanager.googleapis.com/v3/projects/'+project,{headers:await vertexHeaders(c)});}
 else throw Error('Provedor inválido.');
 return {ok:true,message:'Autenticação verificada; a geração depende de permissões, modelo e saldo.'};
}
async function body(req){let chunks=[],size=0;for await(const c of req){size+=c.length;if(size>32e6)throw Error('Requisição muito grande.');chunks.push(c);}return JSON.parse(Buffer.concat(chunks).toString()||'{}');}
function send(res,status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));}
const files={'/':'index.html','/app.js':'app.js','/style.css':'style.css'};
const types={'/':'text/html; charset=utf-8','/app.js':'text/javascript; charset=utf-8','/style.css':'text/css; charset=utf-8'};
const server=http.createServer(async(req,res)=>{
 try{
 const host=req.headers.host||'';if(!['127.0.0.1:'+port,'localhost:'+port].includes(host))return send(res,403,{error:'Acesso apenas local.'});
 if(req.headers.origin&& !['http://127.0.0.1:'+port,'http://localhost:'+port].includes(req.headers.origin))return send(res,403,{error:'Origem inválida.'});
 res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Content-Security-Policy',"default-src 'self'; img-src 'self' data: blob: https:; media-src 'self' blob: https:; style-src 'self'; script-src 'self'; connect-src 'self' https:; frame-ancestors 'none'; base-uri 'none'");
 const p=new URL(req.url,'http://localhost').pathname;
 if(req.method==='GET'&&files[p]){res.writeHead(200,{'Content-Type':types[p],'Cache-Control':'no-store'});return res.end(await readFile(path.join(root,files[p])));}
 if(req.method==='GET'&&p.startsWith('/media/')){const m=media.get(p.slice(7));if(!m)return send(res,404,{error:'Mídia expirada.'});res.writeHead(200,{'Content-Type':m.mime,'Content-Length':m.b.length,'Cache-Control':'no-store'});return res.end(m.b);}
 if(req.method==='GET'&&p.startsWith('/api/job/')){const j=jobs.get(p.slice(9));return j?send(res,200,j):send(res,404,{error:'Tarefa não encontrada.'});}
 if(req.method==='POST'&&['/api/check','/api/stage','/api/video'].includes(p)){if(!req.headers['content-type']?.startsWith('application/json'))return send(res,415,{error:'JSON obrigatório.'});const b=await body(req),c=b.credentials||{};delete b.credentials;if(p==='/api/check')return send(res,200,await check(b,c));
 if([...jobs.values()].some(j=>j.status==='running'))return send(res,409,{error:'Já existe uma geração em andamento.'});
 const id=randomUUID(),j={status:'running',at:Date.now()};jobs.set(id,j);send(res,202,{id});
 Promise.resolve().then(()=>p==='/api/stage'?stage(b,c):animate(b,c)).then(result=>Object.assign(j,{status:'done',result})).catch(e=>Object.assign(j,{status:'error',error:String(e.message).slice(0,500)}));return;}
 send(res,404,{error:'Rota não encontrada.'});
 }catch(e){if(!res.headersSent)send(res,400,{error:String(e.message).slice(0,500)});else res.end();}
});
setInterval(()=>{const cutoff=Date.now()-3600000;for(const [id,j] of jobs)if(j.status!=='running'&&j.at<cutoff)jobs.delete(id);for(const [id,m] of media)if(m.at<cutoff)media.delete(id);},60000).unref();
server.listen(port,'127.0.0.1',()=>console.log('Imobiliária Studio: http://localhost:'+port));
