import fs from 'node:fs/promises';
import { connect, fetchAndFilter, getAddress, getConfig, getConfigPath, getRecipients, } from './util.js';
import logger from './GMaulLogger.js';
const WHITELIST_FILE = '_whitelist.json';
// eslint-disable-next-line no-unused-vars
function line(str) {
    // Write a string on the current line, clearing to end of line
    // process.stdout.write(`\r${str}\x1b[K`);
}
class Addresses {
    addresses;
    static async load() {
        const whitelist = await getConfig(WHITELIST_FILE);
        // Parse dates
        // TODO: Do this using JSON reviver function in getConfig
        for (const addr of Object.values(whitelist.addresses)) {
            if (addr.sentDate)
                addr.sentDate = new Date(addr.sentDate);
            if (addr.inboxDate)
                addr.inboxDate = new Date(addr.inboxDate);
        }
        return new Addresses(whitelist.addresses);
    }
    constructor(addresses = {}) {
        this.addresses = addresses;
    }
    lookup(email) {
        return this.addresses[email.toLowerCase()];
    }
    save(filePath) {
        // TODO: This should be atomic (write to temp then move to path)
        const json = JSON.stringify({ addresses: this.addresses }, null, 2);
        return fs.writeFile(filePath, json);
    }
    markAddress(source, address, date) {
        if (typeof address != 'string')
            throw Error(`"${address}" is not a string`);
        address = address.toLowerCase();
        // Nope
        if (/^mailer-daemon/.test(address))
            return;
        if (!(address in this.addresses))
            this.addresses[address] = {
                sentCount: 0,
                inboxCount: 0,
            };
        const a = this.addresses[address];
        if (source == 'sent') {
            a.sentCount += 1;
            if (date && (!a.sentDate || a.sentDate < date))
                a.sentDate = date;
        }
        else if (source == 'inbox') {
            a.inboxCount += 1;
            if (date && (!a.inboxDate || a.inboxDate < date))
                a.inboxDate = date;
        }
    }
}
async function processInbox(imap, addresses, bySize) {
    // Open INBOX
    const box = await imap.openBoxAsync('INBOX');
    // Get unseen message ids
    let unseen = new Set(await imap.searchAsync(['UNSEEN']));
    const range = `${1}:*`;
    await fetchAndFilter(imap, range, (msg, i) => {
        if (i % 100 == 0)
            line(`${box.name}: ${i} of ${box.messages.total}`);
        if (msg.size > 1e6)
            bySize.push(msg);
        // Don't use unseen messages in whitelist
        if (unseen.has(msg.uid))
            return false;
        // Mark sender
        const address = getAddress(msg.from);
        if (address?.address) {
            addresses.markAddress('inbox', address.address, msg.date);
        }
        // Mark recipients
        const emails = getRecipients(msg);
        for (let e of emails)
            addresses.markAddress('inbox', e.address, msg.date);
        return true;
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
    imap.end();
}
async function processSent(imap, addresses, bySize) {
    // Open Sent Mail (read)
    const box = await imap.openBoxAsync('[Gmail]/Sent Mail');
    // Get UNSEEN messages since yesterday
    // const days = process.env.DAYS || 1;
    // const since = new Date(Date.now() - days * 864e5);
    const range = `${1}:*`;
    // Get messages that don't have a subject
    await fetchAndFilter(imap, range, (msg, i) => {
        if (i % 100 == 0)
            line(`${box.name}: ${i} of ${box.messages.total}`);
        if (msg.size > 1e6)
            bySize.push(msg);
        for (let address of getRecipients(msg)) {
            addresses.markAddress('sent', address.address, msg.date);
        }
        return false;
    });
    logger.log('Done with Sent');
    await imap.closeBoxAsync(false);
    imap.end();
}
export default {
    addresses: undefined,
    _generating: undefined,
    async init() {
        if (this._generating)
            return;
        try {
            const stats = await fs.stat(getConfigPath(WHITELIST_FILE));
            if (Date.now() - stats.mtime.getTime() > 864e5) {
                logger.log('Updating whitelist');
                await this.generate();
                logger.log('Updated whitelist');
            }
            this.addresses = await Addresses.load();
        }
        catch (err) {
            if (err.code == 'ENOENT') {
                logger.log('Generating whitelist (This may take a few minutes)');
                await this.generate();
                logger.log('Created whitelist');
            }
            else {
                throw err;
            }
        }
    },
    lookup(...args) {
        if (!this.addresses)
            throw Error('Whitelist not initialized');
        return this.addresses.lookup(...args);
    },
    async generate() {
        if (this._generating)
            return null;
        const addresses = new Addresses();
        const bySize = [];
        this._generating = Promise.all([
            connect().then((imap) => processSent(imap, addresses, bySize)),
            connect().then((imap) => processInbox(imap, addresses, bySize)),
        ]);
        await this._generating;
        this._generating = undefined;
        await addresses.save(getConfigPath(WHITELIST_FILE));
        this.addresses = addresses;
        bySize.sort((a, b) => (a.size > b.size ? 1 : a.size < b.size ? -1 : 0));
        // Log largest messages
        // for (const msg in bySize) {
        // logger.log(msg.size, msg.subject);
        // }
    },
};
//# sourceMappingURL=whitelist.js.map