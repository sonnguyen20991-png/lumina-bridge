import express from 'express';
import {fileURLToPath} from 'node:url';
import {existsSync} from 'node:fs';

export function registerFrontend(app) {
  const root=fileURLToPath(new URL('./frontend-dist/',import.meta.url));
  if(!existsSync(`${root}index.html`))throw new Error('Lumina frontend-dist/index.html is missing.');
  app.get(/^\/app$/,(_req,res)=>res.redirect(302,'/app/'));
  // Static application shell only. All business data continues through existing
  // /api/v1 IAP verification and membership authorization. No auth changes.
  app.use('/app',(_req,res,next)=>{res.set('X-Content-Type-Options','nosniff');res.set('Referrer-Policy','same-origin');next();},express.static(root,{
    dotfiles:'deny',index:'index.html',fallthrough:false,
    setHeaders(res,path){res.setHeader('Cache-Control',/\/assets\/app-[0-9a-f]+\.(js|css)$/.test(path)?'public, max-age=31536000, immutable':'no-store');},
  }));
  app.use('/app',(error,_req,res,_next)=>{
    const status=[400,403,404].includes(error.status)?error.status:500;
    res.status(status).type('text').send('Frontend file unavailable.');
  });
}
