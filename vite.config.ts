import basicSsl from '@vitejs/plugin-basic-ssl';
import { defineConfig } from 'vite';

// `npm run dev:lan` — HTTPS в локальной сети: сетевая игра считает хэши через crypto.subtle,
// а браузер даёт его только по HTTPS (или на localhost). Сертификат самоподписанный — браузер предупредит.
export default defineConfig(({ mode }) => ({
  base: './',
  server: { port: 5173 },
  plugins: mode === 'lan' ? [basicSsl()] : [],
}));
