import React from 'react';
import ReactDOM from 'react-dom/client';
import './styles.css';

function App() {
  return <main className="min-h-screen bg-white" aria-label="Multi-Agent Workspace" />;
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
