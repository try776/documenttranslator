import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.tsx';
// import './index.css';  <-- Diese Zeile hat den Fehler verursacht und wurde entfernt.

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);