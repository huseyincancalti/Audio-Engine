// src/popup/index.tsx — popup React giriş noktası.
import '../lib/shim';
import { createRoot } from 'react-dom/client';
import '../styles/theme.css';
import '../styles/components.css';
import './popup.css';
import { Popup } from './Popup';

const root = document.getElementById('root');
if (root) createRoot(root).render(<Popup />);
