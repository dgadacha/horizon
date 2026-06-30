import { defineConfig } from 'astro/config';
import svelte from '@astrojs/svelte';
import node from '@astrojs/node';

// Mode "hybrid" : la page reste statique, seule la route /api/analyze tourne
// cote serveur (pour appeler Claude sans exposer la cle API au navigateur).
export default defineConfig({
  output: 'hybrid',
  adapter: node({ mode: 'standalone' }),
  integrations: [svelte()],
  devToolbar: { enabled: false },
});
