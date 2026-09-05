import { VERSION } from '@cobot/shared';
import pino from 'pino';

const isProduction = process.env.NODE_ENV === 'production';

const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  ...(isProduction ? {} : { transport: { target: 'pino-pretty' } }),
});

logger.info({ version: VERSION }, 'boot');
