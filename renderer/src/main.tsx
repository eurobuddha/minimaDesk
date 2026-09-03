import React from 'react';
import ReactDOM from 'react-dom/client';
import './hub/index.css';
import './shell/shell.css';
import type { Ports } from './minima';
import { installMdsShim } from './hub/mds-shim';
import Shell from './shell/Shell';

(async () => {
  let ports: Ports | null = null;
  try { ports = await window.minima.ports(); } catch (e) { /* preload missing: dev in a browser */ }
  installMdsShim(ports ? ports.mds : 20003);
  ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <React.StrictMode>
      <Shell ports={ports} />
    </React.StrictMode>
  );
})();
