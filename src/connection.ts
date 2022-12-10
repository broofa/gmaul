/* eslint-disable no-unused-vars */
import asyncProxy from '@broofa/asyncproxy';
import { GMaulConfig } from 'config';
import { Box, default as Connection, default as Imap } from 'imap';
import { logger } from './logger.js';

// Declare promisified versions of methods that we call via asyncproxy
export interface GMaulConnection extends Connection {
  openBoxAsync(mailboxName: string, openReadOnly?: boolean): Promise<Box>;
  searchAsync(criteria: any[]): Promise<ImapUID[]>;
  closeBoxAsync(autoExpunge?: boolean): Promise<void>;
  moveAsync(
    source: any /* MessageSource */,
    mailboxName: string
  ): Promise<void>;
}

function _connect(
  config: GMaulConfig,
  listeners: Record<string, (...args: any[]) => void>
) {
  const imap = new Imap(config.server);
  const asyncImap = asyncProxy(imap) as GMaulConnection;

  logger.log('Connecting to IMAP server');
  const listenerEntries = Object.entries(listeners).map(
    ([event, listener]) =>
      [
        event,
        (...args: any[]) => {
          logger.log(`listener ('${event}') called`);
          listener(asyncImap, ...args);
        },
      ] as [string, (...args: any[]) => void]
  );

  function subscribe() {
    for (const [event, listener] of listenerEntries) {
      logger.log(`subscribing '${event}'`);
      imap.on(event, listener);
    }
  }

  function unsubscribe() {
    for (const [event, listener] of listenerEntries) {
      logger.log(`unsubscribing '${event}'`);
      imap.off(event, listener);
    }
  }

  imap.on('ready', (...args: any[]) => {
    logger.log('READY', ...args);
  });
  imap.on('error', (...args: any[]) => {
    logger.log('ERROR', ...args);
    () => unsubscribe();
  });

  imap.on('close', (...args: any[]) => {
    logger.log('CLOSE', ...args);
    () => unsubscribe();
  });
  imap.on('end', (...args: any[]) => {
    logger.log('END', ...args);
    () => unsubscribe();
  });

  subscribe();

  imap.connect();

  return asyncImap;
}

export function connect(
  config: GMaulConfig,
  listeners: Record<string, (...args: any[]) => void>,
  autoReconnect = true
): Promise<void> {
  if (autoReconnect) {
    let delay = 0;
    let timer: NodeJS.Timeout | undefined;

    function reconnect(reason: string | Error) {
      if (timer) return;

      logger.log(`Reconnecting in ${delay} ms`, reason);

      setTimeout(() => {
        timer = undefined;
        const imap = _connect(config, listeners);

        // Reset delay on successful connection
        imap.on('ready', () => (delay = 0));

        // Reconnect if connection is lost
        imap.on('error', (err: Error) => reconnect(err));
        imap.on('close', (hadError: boolean) =>
          reconnect(`close(hadError = ${hadError})`)
        );
        imap.on('end', () => reconnect('end'));
      }, delay);

      delay = Math.max(2e3, Math.min(delay * 2, 60e3));
    }

    reconnect('initial');

    return Promise.resolve(undefined);
  } else {
    const imap = _connect(config, listeners);
    return new Promise((resolve, reject) => {
      logger.log('connect promise');
      imap.on('ready', () => resolve(undefined));
      imap.on('error', (err: Error) => reject(err));
      imap.on('end', (err: Error) => resolve());
    });
  }
}