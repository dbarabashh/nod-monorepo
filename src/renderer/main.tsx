import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/index.css';
import { App } from './app.tsx';
import { RecordingWidget } from './features/recording/index.ts';

const isWidget = window.location.hash === '#widget';
document.documentElement.dataset.platform = window.api.platform;
document.documentElement.dataset.window = isWidget ? 'widget' : 'main';

const root = document.getElementById('root');
if (!root) {
  throw new Error('Missing #root element');
}

createRoot(root).render(
  <StrictMode>{isWidget ? <RecordingWidget /> : <App />}</StrictMode>,
);
