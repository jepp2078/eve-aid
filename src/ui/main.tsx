import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './theme.css';
import './components/components.css';
import './screens/screens.css';
import './screens/reference.css';
import './screens/panel/panel.css';
import './screens/table.css';
import './screens/combat/combat.css';
import './screens/combat/fight.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
