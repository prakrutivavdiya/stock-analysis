import React from 'react';
import ReactDOM from 'react-dom/client';
import './styles/index.css';
import App from './app/App';
import { migrateLegacyPrefs } from './app/data/localPrefs';

// Migrate any existing single-blob preferences to individual keys (idempotent)
migrateLegacyPrefs();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
