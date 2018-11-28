const asyncProxy = require('@broofa/asyncproxy');
const fs = asyncProxy(require('fs'));
const path = require('path');
const util = require('./util');

const FILEPATH = path.join(__dirname, '../config/whitelist.json');

function line(str) {
  // Write a string on the current line, clearing to end of line
  // process.stdout.write(`\r${str}\x1b[K`);
}

class Addresses {
  static async load(filePath) {
    const data = await fs.readFileAsync(filePath, 'utf8');
    return new Addresses(JSON.parse(data).addresses)
  }

  constructor(addresses) {
    this._cache = addresses || {};
  }

  lookup(email) {
    return this._cache[email.toLowerCase()];
  }

  save(filePath) {
    // TODO: This should be atomic (write to temp then move to path)
    const json = JSON.stringify({addresses: this._cache});
    return fs.writeFileAsync(filePath, json);
  }

  markAddress(source, address, date) {
    address = address.toLowerCase();

    // Nope
    if (/^mailer-daemon/.test(address)) return;

    if (!(date instanceof Date)) date = new Date(date);

    if (!(address in this._cache)) this._cache[address] = {};
    const a = this._cache[address];

    a[`${source}Count`] = (a[`${source}Count`] || 0) + 1;
    if (!a[`${source}Date`] || a[`${source}Date`] < date) a[`${source}Date`] = date;
  }
}

async function processInbox(imap, addresses, bySize = []) {
  // Open INBOX
  const box = await imap.openBoxAsync('INBOX');

  // Get unseen message ids
  let unseen = new Set(await imap.searchAsync(['UNSEEN']));

  const range = `${1}:*`;
  const senders = {};
  await util.fetchAndFilter(imap, range, (msg, i) => {
    if (i % 100 == 0) line(`${box.name}: ${i} of ${box.messages.total}`);
    if (msg.size > 1e6) bySize.push(msg);

    // Don't use unseen messages in whitelist
    if (unseen.has(msg.uid)) return;

    // Mark sender
    addresses.markAddress('inbox', msg.from.value[0].address, msg.date);

    // Mark recipients
    const emails = util.getRecipients(msg);
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
      console.error('Invalid domain', address);
    }
  });
  Object.entries(domains)
    .sort((a, b) => b[1] - a[1])
    .forEach(e => console.log);
  */

  console.log('Done with Inbox');

  await imap.closeBoxAsync(false);

  imap.end(imap);
}

async function processSent(imap, addresses, bySize = []) {
  // Open Sent Mail (read)
  const box = await imap.openBoxAsync('[Gmail]/Sent Mail');

  // Get UNSEEN messages since yesterday
  const days = process.env.DAYS || 1;
  const since = new Date(Date.now() - days * 864e5);

  const range = `${1}:*`;

  // Get messages that don't have a subject
  await util.fetchAndFilter(imap, range, (msg, i) => {
    if (i % 100 == 0) line(`${box.name}: ${i} of ${box.messages.total}`);
console.log(msg.size);
    if (msg.size > 1e6) bySize.push(msg);

    for (let email of util.getRecipients(msg)) {
      addresses.markAddress('sent', email, msg.date);
    }
  });

  console.log('Done with Sent');

  await imap.closeBoxAsync(false);

  imap.end(imap);
}

module.exports = {
  async init() {
    try {
      const stats = await fs.statAsync(FILEPATH);
      if (Date.now() - stats.mtime > 864e5) {
        console.log('Updating whitelist');
        this.generate().then(() => console.log('Updated whitelist'));
      }
      this.addresses = await Addresses.load(FILEPATH);
    } catch (err) {
      if (err.code == 'ENOENT') {
        console.log('Generating whitelist (This may take a few minutes)');
        await this.generate();
        console.log('Created whitelist');
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
      util.connect().then(imap => processSent(imap, addresses, bySize)),
      util.connect().then(imap => processInbox(imap, addresses, bySize))
    ]);
    await this._generating;
    this._generating = null;

    await addresses.save(FILEPATH);
    this.addresses = addresses;

    bySize.sort((a, b) => {
      a = a.size;
      b = b.size;
      return a > b;
    });

    // Log largest messages
    // for (const msg in bySize) {
      // console.log(msg.size, msg.subject);
    // }
  }
};
