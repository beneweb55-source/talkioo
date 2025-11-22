import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

// Service Worker is now registered inside hooks/usePushNotifications.ts 
// to ensure the scriptURL is handled correctly relative to the domain.

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);