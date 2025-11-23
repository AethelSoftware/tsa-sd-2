import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom'; // 👈 Import required components
import './index.css';
import App from './App.jsx';
import Login from './Login.jsx';
import MapClone from './Dashboard.jsx';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<App />} />
        <Route path="/login" element={<Login />} />
        <Route path="/dashboard" element={<MapClone />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);