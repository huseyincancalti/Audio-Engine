// src/options/index.tsx — dashboard React giriş noktası.
import '../lib/shim';
import { createRoot } from 'react-dom/client';
import '../styles/theme.css';
import '../styles/components.css';
import './options.css';
import { Dashboard } from './Dashboard';

const root = document.getElementById('root');
if (root) createRoot(root).render(<Dashboard />);
