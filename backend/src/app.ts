import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import type { ErrorRequestHandler } from 'express';
import type { AppConfig } from './config/env.js';
import { AuthStore } from './config/database.js';
import { AuthService } from './services/auth.js';
import { authRoutes } from './routes/auth.js';
import { verifyOrigin } from './middlewares/auth.js';
import { panelRoutes } from './routes/panel.js';
import { HttpError, isUniqueConstraint } from './middlewares/errors.js';
import type { PostalFetch } from './services/postal-code.js';

export async function createApp(config: AppConfig, dependencies: { postalFetch?: PostalFetch } = {}) {
  const store = new AuthStore(config.databasePath);
  const auth = await AuthService.create(store, config);
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 1);
  app.use(helmet());
  app.use(cors({ origin: config.frontendOrigins, credentials: true }));
  app.use(verifyOrigin(config));
  app.use(['/api/usuarios', '/api/membros', '/api/cadastro'], express.json({ limit: '32kb' }));
  app.use(express.json({ limit: '8kb' }));
  app.use(cookieParser());
  app.get('/api/health', (_req, res) => { res.json({ status: 'ok' }); });
  app.use('/api/auth', authRoutes(auth, config));
  app.use('/api', panelRoutes(store, auth, config, dependencies.postalFetch));
  app.use((_req, res) => { res.status(404).json({ message: 'Rota não encontrada.' }); });
  const errorHandler: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
    if (error instanceof HttpError) {
      res.status(error.status).json({ message: error.message, ...(error.fields ? { errors: error.fields } : {}) });
      return;
    }
    if (isUniqueConstraint(error)) { res.status(409).json({ message: 'Já existe um cadastro com este e-mail.' }); return; }
    const type = error instanceof Error && 'type' in error ? error.type : undefined;
    if (type === 'entity.parse.failed') { res.status(400).json({ message: 'JSON inválido.' }); return; }
    if (type === 'entity.too.large') { res.status(413).json({ message: 'Requisição muito grande.' }); return; }
    if (type === 'encoding.unsupported') { res.status(415).json({ message: 'Não envie arquivos comprimidos no upload de fotos.' }); return; }
    console.error('Falha interna na API:', error instanceof Error ? error.message : 'Erro desconhecido');
    res.status(500).json({ message: 'Não foi possível concluir a solicitação. Tente novamente.' });
  };
  app.use(errorHandler);
  return { app, store };
}
