import React from 'react';
import ReactDOM from 'react-dom/client';
import './hub/index.css';
import './shell/shell.css';
import { installMdsShim } from './hub/mds-shim';
import Shell from './shell/Shell';

(async () => {
  let mds = 20003;
  try { mds = (await window.minima.ports()).mds; } catch (e) { /* preload missing: dev in a browser */ }
  installMdsShim(mds);
  ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <React.StrictMode>
      <Shell />
    </React.StrictMode>
  );
})();
