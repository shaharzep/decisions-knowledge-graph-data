import winston from 'winston';
import path from 'path';

/**
 * Logger Configuration
 *
 * Provides structured logging for the batch processing system
 */

const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.splat(),
  winston.format.json()
);

const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.printf(({ timestamp, level, message, ...metadata }) => {
    let msg = `${timestamp} [${level}] ${message}`;
    if (Object.keys(metadata).length > 0) {
      msg += ` ${JSON.stringify(metadata)}`;
    }
    return msg;
  })
);

/**
 * Create a logger instance
 * @param component Component name (e.g., 'BatchJobGenerator', 'AzureBatchClient')
 */
export function createLogger(component: string): winston.Logger {
  const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: logFormat,
    defaultMeta: { component },
    transports: [
      // Console output
      new winston.transports.Console({
        format: consoleFormat,
      }),
      // File output - all logs
      new winston.transports.File({
        filename: path.join(process.cwd(), 'logs', 'combined.log'),
        maxsize: 5242880, // 5MB
        maxFiles: 5,
      }),
      // File output - errors only
      new winston.transports.File({
        filename: path.join(process.cwd(), 'logs', 'error.log'),
        level: 'error',
        maxsize: 5242880, // 5MB
        maxFiles: 5,
      }),
    ],
  });

  return logger;
}

/**
 * Default logger instance
 */
export const logger = createLogger('App');

/**
 * Log levels:
 * - error: Error events that might still allow the application to continue running
 * - warn: Potentially harmful situations
 * - info: Informational messages that highlight progress
 * - debug: Detailed information for debugging
 */

/**
 * Helper to log job events with consistent formatting
 */
export class JobLogger {
  private logger: winston.Logger;
  private jobId: string;

  constructor(jobId: string) {
    this.jobId = jobId;
    this.logger = createLogger(`Job:${jobId}`);
  }

  info(message: string, metadata?: object) {
    this.logger.info(message, { jobId: this.jobId, ...metadata });
  }

  error(message: string, error?: Error | unknown, metadata?: object) {
    this.logger.error(message, {
      jobId: this.jobId,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      ...metadata,
    });
  }

  warn(message: string, metadata?: object) {
    this.logger.warn(message, { jobId: this.jobId, ...metadata });
  }

  debug(message: string, metadata?: object) {
    this.logger.debug(message, { jobId: this.jobId, ...metadata });
  }

  /**
   * Log job status change
   */
  statusChange(from: string, to: string, metadata?: object) {
    this.info(`Status changed: ${from} → ${to}`, metadata);
  }

  /**
   * Log job started
   */
  started(metadata?: object) {
    this.info('Job started', metadata);
  }

  /**
   * Log job completed
   */
  completed(metadata?: object) {
    this.info('Job completed', metadata);
  }

  /**
   * Log job failed
   */
  failed(error: Error | unknown, metadata?: object) {
    this.error('Job failed', error, metadata);
  }
}
