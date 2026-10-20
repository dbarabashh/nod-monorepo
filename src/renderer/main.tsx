import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/index.css';
import { App } from './app.tsx';
import {
  MeetingSuggestion,
  RecordingWidget,
} from './features/recording/index.ts';

const view =
  window.location.hash === '#widget'
    ? 'widget'
    : window.location.hash === '#suggestion'
      ? 'suggestion'
      : 'main';
document.documentElement.dataset.platform = window.api.platform;
document.documentElement.dataset.window = view;

const root = document.getElementById('root');
if (!root) {
  throw new Error('Missing #root element');
}

createRoot(root).render(
  <StrictMode>
    {view === 'widget' ? (
      <RecordingWidget />
    ) : view === 'suggestion' ? (
      <MeetingSuggestion />
    ) : (
      <App />
    )}
  </StrictMode>,
);
