import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MiniApp } from './MiniApp.js';

const root = document.getElementById('root');
if (!root) throw new Error('mini mode markup missing #root');
createRoot(root).render(
  <StrictMode>
    <MiniApp />
  </StrictMode>,
);
