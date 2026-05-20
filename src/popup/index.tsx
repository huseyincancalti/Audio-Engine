// src/popup/index.tsx

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Popup } from './Popup';
import './popup.css';

const root = document.getElementById('root');
if (!root) throw new Error('[Popup] #root element not found');

createRoot(root).render(
  <StrictMode>
    <Popup />
  </StrictMode>,
);
