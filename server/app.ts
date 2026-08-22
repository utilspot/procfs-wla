import express, { type Express } from 'express';
import { routes } from './routes.js';

export function createApp(): Express {
  const app = express();

  // Allow the Vite dev server (or any other origin) to call this test server
  // directly, i.e. when the app is configured with an absolute base URL.
  app.use((_req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, OPTIONS');
    next();
  });

  app.use(express.json());
  app.use(routes());

  return app;
}
