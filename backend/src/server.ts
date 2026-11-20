import express from 'express';
import cors from 'cors';
import { env } from './common/env.config';
import { logger } from './common/logger.service';
import { globalErrorHandler } from './common/error.middleware';
import { AuthService } from './common/auth.service';
import { CacheClient } from './common/cache.middleware';
import { createStoreRouter } from './modules/store.routes';

const app = express();
app.use(cors());
app.use(express.json());

// Cache compatible Redis (implémentation mémoire prête à être remplacée par node-redis)
const memoryStore = new Map<string, string>();
const cacheClient: CacheClient = {
  get: async (key) => memoryStore.get(key) ?? null,
  setEx: async (key, _ttl, val) => {
    memoryStore.set(key, val);
  },
  del: async (keys) => {
    (Array.isArray(keys) ? keys : [keys]).forEach((k) => memoryStore.delete(k));
  },
};

const authService = new AuthService({
  accessSecret: env.JWT_SECRET,
  refreshSecret: `${env.JWT_SECRET}_refresh`,
});

app.use('/api', createStoreRouter(authService, cacheClient));
app.use(globalErrorHandler);

app.listen(env.PORT, () => {
  logger.info({ port: env.PORT, env: env.NODE_ENV }, 'Serveur E-commerce démarré');
});
