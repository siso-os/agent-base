import React from 'react';
import { createRoot } from 'react-dom/client';
import { RemoteInventoryNavigation } from '../src/components/RemoteInventoryNavigation';
import { RemoteInventory } from '../src/components/RemoteInventory';
document.body.style.cssText='margin:0;background:#101013;color:#dedee6;font-family:Inter,system-ui,sans-serif;';
createRoot(document.getElementById('root')!).render(<main style={{maxWidth:location.search.includes('navigation')?300:1050,margin:'0 auto',padding:16}}><p style={{fontSize:11,color:'#88889b',margin:'4px 0 16px'}}>SYNTHETIC REVIEW · Remote inventory</p>{location.search.includes('navigation') ? <RemoteInventoryNavigation /> : <RemoteInventory />}</main>);
