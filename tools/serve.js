// 시험용 작은 웹서버: node tools/serve.js
const http=require('http'),fs=require('fs'),path=require('path');
const root=path.join(__dirname,'..'),T={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png'};
http.createServer((q,r)=>{let p=decodeURIComponent(q.url.split('?')[0]);if(p.endsWith('/'))p+='index.html';const f=path.join(root,p);if(!f.startsWith(root))return r.writeHead(403).end();fs.readFile(f,(e,d)=>{if(e)return r.writeHead(404).end('404');r.writeHead(200,{'Content-Type':T[path.extname(f)]||'application/octet-stream','Cache-Control':'no-store'});r.end(d);});}).listen(5177,()=>console.log('http://localhost:5177'));
