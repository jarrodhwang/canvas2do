import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { LanguageProvider } from './context/LanguageProvider.tsx';
import { WorkspaceModeProvider } from './context/WorkspaceModeProvider.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LanguageProvider>
      <WorkspaceModeProvider>
        <App />
      </WorkspaceModeProvider>
    </LanguageProvider>
  </StrictMode>,
);
