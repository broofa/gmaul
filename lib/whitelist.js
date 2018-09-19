#!/usr/bin/env node

const asyncProxy = require('@broofa/asyncproxy');
const fs = asyncProxy(require('fs'));
const path = require('path');
const util = require('./util');

function line(str) {
  // Write a string on the current line, clearing to end of line
  process.stdout.write(`\r${str}\x1b[K`);
}

class Addresses {
  static async load(filePath) {
    const stats = await fs.statAsync(filePath);

    if (!stats.isFile() || (Date.now() - stats.mtime > 864e5)) return null;

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

async function processInbox(imap, addresses) {
  // Open INBOX
  const box = await imap.openBoxAsync('INBOX');

  // Get unseen message ids
  let unseen = new Set(await imap.searchAsync(['UNSEEN']));

  const range = `${1}:*`;
  const senders = {};
  await util.fetchAndFilter(imap, range, (msg, i) => {
    if (i % 100 == 0) line(`${box.name}: ${i} of ${box.messages.total}`);

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

async function processSent(imap, addresses) {
  // Open Sent Mail (read)
  const box = await imap.openBoxAsync('[Gmail]/Sent Mail');

  // Get UNSEEN messages since yesterday
  const days = process.env.DAYS || 1;
  const since = new Date(Date.now() - days * 864e5);

  const range = `${1}:*`;

  // Get messages that don't have a subject
  await util.fetchAndFilter(imap, range, (msg, i) => {
    if (i % 100 == 0) line(`${box.name}: ${i} of ${box.messages.total}`);

    for (let email of util.getRecipients(msg)) {
      addresses.markAddress('sent', email, msg.date);
    }
  });

  console.log('Done with Sent');

  await imap.closeBoxAsync(false);

  imap.end(imap);
}


const FILEPATH = path.join(__dirname, '../config/whitelist.json');

module.exports = {
  async init() {
    this.addresses = await Addresses.load(FILEPATH);
  },

  lookup(...args) {
    return this.addresses.lookup(...args);
  },

  async generate() {
    const addresses = new Addresses();

    await Promise.all([
      util.connect().then(imap => processSent(imap, addresses)),
      util.connect().then(imap => processInbox(imap, addresses))
    ]);

    await addresses.save(FILEPATH);
    console.log('Created whitelist');

    this.addresses = addresses;
  }
};
