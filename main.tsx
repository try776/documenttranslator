import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.tsx';
import './index.css'; 
// Falls index.css nicht existiert, kannst du die Zeile entfernen oder eine leere Datei anlegen. 
// App.css wird in App.tsx importiert.

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);