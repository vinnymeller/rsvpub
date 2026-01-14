import { App } from './ui/app';
import './styles.css';

document.addEventListener('DOMContentLoaded', () => {
  const container = document.getElementById('app');
  if (container) {
    new App(container);
  }
});
