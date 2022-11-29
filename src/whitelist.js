import fs from 'node:fs/promises';
import {
  connect,
  fetchAndFilter,
  getConfig,
  getConfigPath,
  getRecipients,
} from './util.js';

import logger from './GMaulLogger.js';

const WHITELIST_FILE = '_whitelist.json';

// eslint-disable-next-line no-unused-vars
function line(str) {
  // Write a string on the current line, clearing to end of line
  // process.stdout.write(`\r${str}\x1b[K`);
}

class Addresses {
  static async load() {
    return new Addresses(await getConfig(WHITELIST_FILE));
  }

  constructor(addresses) {
    this._cache = addresses || {};
  }

  lookup(email) {
    return this._cache[email.toLowerCase()];
  }

  save(filePath) {
    // TODO: This should be atomic (write to temp then move to path)
    const json = JSON.stringify({ addresses: this._cache }, null, 2);
    return fs.writeFile(filePath, json);
  }

  markAddress(source, address, date) {
    if (typeof address != 'string') throw Error(`"${address}" is not a string`);
    address = address.toLowerCase();

    // Nope
    if (/^mailer-daemon/.test(address)) return;

    if (!(date instanceof Date)) date = new Date(date);

    if (!(address in this._cache)) this._cache[address] = {};
    const a = this._cache[address];

    a[`${source}Count`] = (a[`${source}Count`] || 0) + 1;
    if (!a[`${source}Date`] || a[`${source}Date`] < date)
      a[`${source}Date`] = date;
  }
}

function* getAddresses(field) {
  const addresses = field.value || field;
  if (!Array.isArray(addresses)) throw Error('No addresses array found');
  for (const add of addresses) {
    if (add.address) {
      yield add.address;
    } else if (add.group) {
      yield* getAddresses(add.group);
    } else {
      throw Error('No address found');
    }
  }
}

async function processInbox(imap, addresses, bySize = []) {
  // Open INBOX
  const box = await imap.openBoxAsync('INBOX');

  // Get unseen message ids
  let unseen = new Set(await imap.searchAsync(['UNSEEN']));

  const range = `${1}:*`;
  await fetchAndFilter(imap, range, (msg, i) => {
    if (i % 100 == 0) line(`${box.name}: ${i} of ${box.messages.total}`);
    if (msg.size > 1e6) bySize.push(msg);

    // Don't use unseen messages in whitelist
    if (unseen.has(msg.uid)) return;

    // Mark sender
    const address = getAddresses(msg.from).next().value;
    if (address) {
      addresses.markAddress('inbox', address, msg.date);
    }

    // Mark recipients
    const emails = getRecipients(msg);
    for (let e of emails) addresses.markAddress('inbox', e, msg.date);
  });

  // Count senders by TLD
  /*
  const domains = {};
  Object.keys(addresses).forEach(address => {
    try {
      const domain = address.split('@')[1].split('.').slice(-2).join('.').toLowerCase();
      domains[domain] = (domains[domain] || 0) + 1;
    } catch (err) {
      logger.error('Invalid domain', address);
    }
  });
  Object.entries(domains)
    .sort((a, b) => b[1] - a[1])
    .forEach(e => logger.log);
  */

  logger.log('Done with Inbox');

  await imap.closeBoxAsync(false);

  imap.end(imap);
}

async function processSent(imap, addresses, bySize = []) {
  // Open Sent Mail (read)
  const box = await imap.openBoxAsync('[Gmail]/Sent Mail');

  // Get UNSEEN messages since yesterday
  // const days = process.env.DAYS || 1;
  // const since = new Date(Date.now() - days * 864e5);

  const range = `${1}:*`;

  // Get messages that don't have a subject
  await fetchAndFilter(imap, range, (msg, i) => {
    if (i % 100 == 0) line(`${box.name}: ${i} of ${box.messages.total}`);
    if (msg.size > 1e6) bySize.push(msg);

    for (let email of getRecipients(msg)) {
      addresses.markAddress('sent', email, msg.date);
    }
  });

  logger.log('Done with Sent');

  await imap.closeBoxAsync(false);

  imap.end(imap);
}

export default {
  async init() {
    if (this._generating) return;
    try {
      const stats = await fs.stat(getConfigPath(WHITELIST_FILE));
      if (Date.now() - stats.mtime > 864e5) {
        logger.log('Updating whitelist');
        await this.generate();
        logger.log('Updated whitelist');
      }
      this.addresses = await Addresses.load();
    } catch (err) {
      if (err.code == 'ENOENT') {
        logger.log('Generating whitelist (This may take a few minutes)');
        await this.generate();
        logger.log('Created whitelist');
      } else {
        throw err;
      }
    }
  },

  lookup(...args) {
    return this.addresses.lookup(...args);
  },

  async generate() {
    if (this._generating) return null;

    const addresses = new Addresses();
    const bySize = [];
    this._generating = Promise.all([
      connect().then((imap) => processSent(imap, addresses, bySize)),
      connect().then((imap) => processInbox(imap, addresses, bySize)),
    ]);
    await this._generating;
    this._generating = null;

    await addresses.save(getConfigPath(WHITELIST_FILE));
    this.addresses = addresses;

    bySize.sort((a, b) => {
      a = a.size;
      b = b.size;
      return a > b;
    });

    // Log largest messages
    // for (const msg in bySize) {
    // logger.log(msg.size, msg.subject);
    // }
  },
};
