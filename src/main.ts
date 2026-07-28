import { initFederation } from '@angular-architects/native-federation';

initFederation('/federation.manifest.json')
  .then(() => import('./bootstrap'))
  .catch(err => console.error(err));
