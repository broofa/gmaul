import fs from 'node:fs/promises';
import {
  fetchAndFilter,
  getAddress,
  getRecipients,
  isNodeError,
} from './util.js';

import { GMaulConfig, getConfigPath, readFile } from './config.js';
import { connect } from './connection.js';
import { logger } from './logger.js';

type ActivityStats = {
  sentCount: number;
  sentDate?: Date;
  sentBytes: number;
  inboxCount: number;
  inboxDate?: Date;
  inboxBytes: number;
};

type ActivityCounts = Record<string, ActivityStats>;

const WHITELIST_FILE = '_whitelist.json';
const BOX_MOD = 1000; // How often to update the spinner

// eslint-disable-next-line no-unused-vars
function line(str: string) {
  // Write a string on the current line, clearing to end of line
  // process.stdout.write(`\r${str}\x1b[K`);
}

class Addresses {
  static async load() {
    const whitelist = await readFile<{ addresses: ActivityCounts }>(
      WHITELIST_FILE
    );

    // Parse dates
    // TODO: Do this using JSON reviver function in getConfig
    for (const addr of Object.values(whitelist.addresses)) {
      if (addr.sentDate) addr.sentDate = new Date(addr.sentDate);
      if (addr.inboxDate) addr.inboxDate = new Date(addr.inboxDate);
    }

    return new Addresses(whitelist.addresses);
  }

  constructor(private addresses: ActivityCounts = {}) {}

  lookup(email: string) {
    return this.addresses[email.toLowerCase()];
  }

  async save(filePath: string) {
    const tmpPath = filePath + '.tmp';

    // TODO: This should be atomic (write to temp then move to path)
    const json = JSON.stringify({ addresses: this.addresses }, null, 2);
    await fs.writeFile(tmpPath, json);
    await fs.rename(tmpPath, filePath);
  }

  markAddress(
    source: 'sent' | 'inbox',
    address: string,
    date?: Date,
    bytes = 0
  ) {
    if (typeof address != 'string') throw Error(`"${address}" is not a string`);
    address = address.toLowerCase();

    // Nope
    if (/^mailer-daemon/.test(address)) return;

    if (!(address in this.addresses))
      this.addresses[address] = {
        sentCount: 0,
        sentBytes: 0,
        inboxCount: 0,
        inboxBytes: 0,
      };

    const a = this.addresses[address];

    if (source == 'sent') {
      a.sentCount += 1;
      a.sentBytes += bytes;
      if (date && (!a.sentDate || a.sentDate < date)) a.sentDate = date;
    } else if (source == 'inbox') {
      a.inboxCount += 1;
      a.inboxBytes += bytes;
      if (date && (!a.inboxDate || a.inboxDate < date)) a.inboxDate = date;
    }
  }
}

export default class Whitelist {
  addresses?: Addresses;
  _generating?: Promise<any>;

  constructor(private config: GMaulConfig) {
    this.config = config;
  }

  async update() {
    if (this._generating) {
      return await this._generating;
    }

    let needsUpdate = false;
    try {
      const stats = await fs.stat(getConfigPath(WHITELIST_FILE));
      if (Date.now() - stats.mtime.getTime() > 864e5) {
        logger.spin('Updating whitelist');
        needsUpdate = true;
      }
    } catch (err) {
      if (isNodeError(err) && err.code == 'ENOENT') {
        logger.spin('Generating whitelist');
        needsUpdate = true;
      } else {
        throw err;
      }
    }

    if (needsUpdate) {
      try {
        await this.generate();
      } catch (err) {
        logger.error('Error during generate()', err);
      }
    }

    logger.spin('Loading whitelist addresses');
    this.addresses = await Addresses.load();
  }

  lookup(email: string) {
    if (!this.addresses) throw Error('Whitelist not initialized');
    return this.addresses.lookup(email);
  }

  async scanInboxForWhitelist(addresses: Addresses): Promise<void> {
    return new Promise((resolve, reject) => {
      connect(
        this.config,
        {
          async ready(imap) {
            logger.log('Whitelist ingesting Sent Mail');

            try {
              // Open INBOX
              const box = await imap.openBoxAsync('INBOX');

              // Get unseen message ids
              let unseen = new Set(await imap.searchAsync(['UNSEEN']));

              const range = `${1}:*`;
              await fetchAndFilter(imap, range, (msg, i) => {
                if (i % BOX_MOD == 0) {
                  logger.spin(`${box.name}: ${i} of ${box.messages.total}`);
                }

                // Mailing list?
                if (msg?.headers.has('list')) {
                  // logger.log('LIST', msg.from?.value[0]?.name, msg.subject);
                }

                // Don't use unseen messages in whitelist
                if (unseen.has(msg.uid)) {
                  return false;
                }

                // Mark sender
                const address = getAddress(msg.from);
                if (address?.address) {
                  addresses.markAddress(
                    'inbox',
                    address.address,
                    msg.date,
                    msg.size
                  );
                }

                // Mark recipients
                const emails = getRecipients(msg);
                for (let e of emails)
                  addresses.markAddress('inbox', e.address, msg.date);

                return true;
              });

              await imap.closeBoxAsync(false);
            } catch (err) {
            } finally {
              imap.end();
            }
          },

          error: reject,
          end: resolve,
        },
        false
      );
    });
  }

  scanSentForWhitelist(addresses: Addresses): Promise<void> {
    if (!this.config) return Promise.reject(Error('No config'));

    return new Promise((resolve, reject) => {
      connect(
        this.config,
        {
          async ready(imap) {
            // Open Sent Mail (read)
            const box = await imap.openBoxAsync('[Gmail]/Sent Mail');

            // Get UNSEEN messages since yesterday
            // const days = process.env.DAYS || 1;
            // const since = new Date(Date.now() - days * 864e5);

            const range = `${1}:*`;

            await fetchAndFilter(imap, range, (msg, i) => {
              if (i % BOX_MOD == 0) {
                logger.spin(`${box.name}: ${i} of ${box.messages.total}`);
              }

              for (let address of getRecipients(msg)) {
                addresses.markAddress('sent', address.address, msg.date);
              }

              return false;
            });

            await imap.closeBoxAsync(false);

            imap.end();

            // TODO: Need to makes
          },

          error: reject,
          end: resolve,
        },
        false
      );
    });
  }

  async generate() {
    if (this._generating) {
      return this._generating;
    }

    const addresses = new Addresses();

    this._generating = Promise.all([
      this.scanSentForWhitelist(addresses),
      this.scanInboxForWhitelist(addresses),
    ]) as unknown as Promise<void>;

    try {
      logger.log('Generating whitelist (this may take a while)');
      await this._generating;
      logger.log('*************************************');
      logger.spin();

      await addresses.save(getConfigPath(WHITELIST_FILE));
    } finally {
      this._generating = undefined;
    }

    this.addresses = addresses;
  }
}
