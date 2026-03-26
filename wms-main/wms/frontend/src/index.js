import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

// Use the built asset as the favicon (so it can live under src/).
// If you add `src/images/logo-thai.png`, it will be used automatically.
let logoThai;
try {
  // eslint-disable-next-line global-require
  logoThai = require('./images/logo-thai.png');
} catch (e) {
  logoThai = null;
}

if (logoThai) {
  const faviconLink =
    document.querySelector("link[rel='icon']") ||
    (() => {
      const link = document.createElement('link');
      link.rel = 'icon';
      document.head.appendChild(link);
      return link;
    })();

  faviconLink.href = logoThai;
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
