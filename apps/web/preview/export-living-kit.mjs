import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..')
const output=process.argv[2]
if(!output||!path.isAbsolute(output)||!fs.statSync(output).isDirectory())throw new Error('Pass an existing absolute output directory')
const deps=process.env.LIVING_ASSET_DEPS||repo
const requireWeb=createRequire(path.join(deps,'apps/web/package.json'))
const { build }=createRequire(requireWeb.resolve('vite/package.json'))('esbuild')
const nodePaths=[path.join(deps,'apps/web/node_modules'),path.join(deps,'node_modules')]
const pkg=path.join(repo,'packages/halo-face')
const bundleOptions={bundle:true,jsx:'automatic',nodePaths,define:{'process.env.NODE_ENV':'"production"'}}
await build({...bundleOptions,entryPoints:[path.join(repo,'apps/web/preview/living-atlas.tsx')],outfile:path.join(output,'living-atlas.js'),format:'iife',minify:true})
await build({...bundleOptions,stdin:{contents:`
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LivingIcon } from './LivingIcon';
import { WorkspaceMark } from './WorkspaceMark';
import { LIVING_ICONS } from './icon-catalog';
export function render(){
 const icons={}, catalog={};
 for(const [name,def] of Object.entries(LIVING_ICONS)){
   const {Glyph,...metadata}=def;catalog[name]=metadata;
   for(const variant of ['tile','glyph'])icons[variant+'/'+name+'.svg']=renderToStaticMarkup(<LivingIcon name={name} variant={variant} size={144} paused/>);
 }
 for(const brand of ['agent-base','siso-agency','halo'])icons['approved/'+brand+'.svg']=renderToStaticMarkup(<WorkspaceMark brand={brand} size={144} paused/>);
 return {icons,catalog};
}`,resolveDir:pkg,sourcefile:'export-icons.tsx',loader:'tsx'},outfile:path.join(output,'living-svg-render.cjs'),platform:'node',format:'cjs',minify:true})
const {icons,catalog}=createRequire(import.meta.url)(path.join(output,'living-svg-render.cjs')).render()
const css=fs.readFileSync(path.join(output,'living-atlas.css'),'utf8')
const svgCss=['living-icon.css','industry-glyphs.css','navigation-glyphs.css','project-glyphs.css','workspace-mark.css'].map(f=>fs.readFileSync(path.join(pkg,f),'utf8')).join('\n')
const svgFiles={}
for(const [name,markup] of Object.entries(icons)){
 const host=markup.match(/^<span([^>]*)>/)?.[1]||''
 const style=host.match(/style="([^"]*)"/)?.[1]||''
 const cls=name.startsWith('approved/')?'wm':'li'
 const attrs=`xmlns="http://www.w3.org/2000/svg" class="${cls}" data-motion="off" data-active="false" data-tier="portrait" data-pulse="off" style="${style}"`
 svgFiles[name]=markup.slice(markup.indexOf('<svg'),markup.lastIndexOf('</svg>')+6).replace('<svg ',`<svg ${attrs} `).replace('aria-hidden="true"','role="img"').replace(/(<svg[^>]*>)/,`$1<style>${svgCss}</style>`)
}
const sourceNames=fs.readdirSync(pkg).filter(n=>/\.(tsx?|css|js|json|md)$/.test(n)||['VERSION','FILES.sha256','UPSTREAM.sha256'].includes(n)).sort()
const manifest={version:'2026-10-06',scope:'SISO living assets review kit',icons:catalog,approvedBrands:['agent-base','siso-agency','halo'],svgCount:Object.keys(svgFiles).length,sourceSha256:Object.fromEntries(sourceNames.map(n=>[n,createHash('sha256').update(fs.readFileSync(path.join(pkg,n))).digest('hex')]))}
fs.writeFileSync(path.join(output,'living-kit-catalog.json'),JSON.stringify(manifest,null,2)+'\n')
fs.writeFileSync(path.join(output,'living-kit-svgs.json'),JSON.stringify(svgFiles))
const zipPath=path.join(output,'siso-living-assets-20261006.zip')
const python=`import json,pathlib,sys,zipfile\npkg=pathlib.Path(sys.argv[1]); out=pathlib.Path(sys.argv[2])\nmanifest=json.loads((out/'living-kit-catalog.json').read_text())\nwith zipfile.ZipFile(out/'siso-living-assets-20261006.zip','w',compression=zipfile.ZIP_DEFLATED) as z:\n for name in manifest['sourceSha256']:\n  z.write(pkg/name,'siso-living-assets/source/'+name)\n for name,svg in json.loads((out/'living-kit-svgs.json').read_text()).items():\n  z.writestr('siso-living-assets/svg/'+name,svg)\n z.write(out/'living-kit-catalog.json','siso-living-assets/catalog.json')\n z.write(pkg/'LIVING-ASSETS.md','siso-living-assets/README.md')\n`
const zipped=spawnSync('python3',['-c',python,pkg,output],{encoding:'utf8'})
if(zipped.status!==0)throw new Error(zipped.stderr||'ZIP export failed')
// A sandboxed host can supply an explicit file URL; the default remains portable.
const zipUrl=process.env.LIVING_KIT_URL||'data:application/zip;base64,'+fs.readFileSync(zipPath).toString('base64')
const js='window.LIVING_KIT_URL='+JSON.stringify(zipUrl)+';'+fs.readFileSync(path.join(output,'living-atlas.js'),'utf8').replace(/<\/script/gi,'<\\/script')
const html=`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><title>SISO · Living atelier</title><style>${css}</style></head><body><div id="root"></div><script>${js}</script></body></html>`
fs.writeFileSync(path.join(output,'living-atlas.html'),html)
console.log(JSON.stringify({html:path.join(output,'living-atlas.html'),htmlBytes:Buffer.byteLength(html),zip:zipPath,zipBytes:fs.statSync(zipPath).size,svgCount:manifest.svgCount,sourceCount:sourceNames.length}))
