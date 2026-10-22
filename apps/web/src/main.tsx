import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './components/arc/foundation.css';
import './styles.css';
import { App } from './App';

const node = document.getElementById('root');
if (!node) throw new Error('AgentMargin root missing');
createRoot(node).render(<StrictMode><App /></StrictMode>);
