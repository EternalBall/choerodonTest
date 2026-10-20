import pino from 'pino';

/**
 * 日志统一写 stderr（fd 2）：
 * 动机——`ata facts` 等命令把 YAML 结果写到 stdout 供管道/重定向使用，
 * 日志若同写 stdout 会污染机器可读输出。
 */
export const logger = pino(
  {
    level: process.env.LOG_LEVEL || 'info',
    transport:
      process.env.NODE_ENV === 'production'
        ? undefined
        : {
            target: 'pino-pretty',
            options: { colorize: true, translateTime: 'SYS:standard', destination: 2 },
          },
  },
  process.env.NODE_ENV === 'production' ? pino.destination(2) : undefined,
);
