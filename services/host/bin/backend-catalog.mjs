#!/usr/bin/env node
// Run with Node's strip-types flag (see docs/BACKEND-VERSIONS.md). Never selects or starts a service.
import { provisionLocalCodex } from '../src/backend-artifacts.ts';
const args=process.argv.slice(2),allowed=['--source-package','--artifacts-dir','--catalog','--expected-catalog-revision'];
if(args.length!==8||args.some((arg,i)=>i%2===0&&!allowed.includes(arg))||new Set(args.filter((_,i)=>i%2===0)).size!==4)throw Error('Explicit --source-package, --artifacts-dir, --catalog and --expected-catalog-revision required');
const get=key=>args[args.indexOf(key)+1];
const result=provisionLocalCodex({sourcePackage:get('--source-package'),artifactsDir:get('--artifacts-dir'),catalogFile:get('--catalog'),expectedCatalogRevision:Number(get('--expected-catalog-revision'))});
console.log(JSON.stringify({catalogRevision:result.catalogRevision,artifactId:result.artifact.id,version:result.artifact.version,changed:result.changed,downloaded:false,validated:false,selected:false,running:false}));
