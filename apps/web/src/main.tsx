import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// Self-hosted Noto Sans JP (repo assets/fonts, OFL). Subsets load per unicode-range.
import '@fonts/400.css';
import '@fonts/700.css';
import './styles/index.css';
import App from './App';

const root = document.getElementById('root');
if (!root) throw new Error('#root missing');
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
