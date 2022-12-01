/* eslint-disable no-unused-vars */
import asyncProxy from '@broofa/asyncproxy';
import Imap from 'imap';
import { simpleParser, } from 'mailparser';
import fs from 'node:fs/promises';
import path from 'node:path';
import logger from './GMaulLogger.js';
const __dirname = path.dirname(new URL(import.meta.url).pathname);
const CONFIG_DIR = 'config';
const CONFIG_FILE = 'gmaul.json';
export function getConfigPath(filename) {
    return path.join(__dirname, '..', CONFIG_DIR, filename);
}
function isAddressObject(obj) {
    return 'value' in obj;
}
function isEmailAddress(obj) {
    return 'address' in obj;
}
// Get all emails from AddressObject
export function getAddresses(obj, emails) {
    if (!emails)
        emails = [];
    if (!obj) {
        // do nothing
    }
    else if (Array.isArray(obj)) {
        for (const o of obj) {
            getAddresses(o, emails);
        }
    }
    else if (isAddressObject(obj)) {
        getAddresses(obj.value, emails);
    }
    else if (isEmailAddress(obj) && obj.address) {
        const { group, name, address } = obj;
        if (group)
            getAddresses(group, emails);
        if (name || address)
            emails.push({ address, name });
    }
    return emails;
}
export function getAddress(obj) {
    const addresses = getAddresses(obj);
    return addresses.length ? addresses[0] : undefined;
}
export async function getConfig(filename = 'gmaul.json') {
    const json = await fs.readFile(getConfigPath(filename), 'utf8');
    return JSON.parse(json);
}
const config = await getConfig();
function parseMessage(msg) {
    return new Promise((resolve, reject) => {
        let raw;
        let attributes;
        msg.on('error', (err) => reject(err));
        msg.on('body', (stream) => {
            const chunks = [];
            stream.once('error', (err) => logger.error(err));
            stream.on('data', (chunk) => chunks.push(chunk));
            stream.once('end', () => {
                raw = Buffer.concat(chunks).toString('utf8');
            });
        });
        msg.on('attributes', (atts) => {
            attributes = atts;
        });
        msg.on('end', async () => {
            const parsed = (await simpleParser(raw));
            parsed.uid = attributes.uid;
            parsed.size = attributes.size ?? 0;
            resolve(parsed);
        });
    });
}
export function getBoxes() {
    /*
    // List mailboxes
    const boxes = await imap.getBoxesAsync(imap);
    const names = [];
    Object.keys(boxes).sort().forEach(boxName =>  {
      names.push(boxName);
      const box = boxes[boxName];
      if (box.children) {
        Object.keys(box.children).sort().forEach(childName => {
          names.push(`${boxName}${box.delimiter}${childName}`);
        });
      }
    });
    logger.log('Mailboxes', names);
    */
}
export function connect() {
    return new Promise((resolve, reject) => {
        const imap = new Imap(config.server);
        imap.once('ready', () => resolve(asyncProxy(imap)));
        imap.once('error', reject);
        imap.connect();
    });
}
export function fetchAndFilter(imap, source, // See MessageSource in Imap type defs
detector) {
    return new Promise((resolve, reject) => {
        if (Array.isArray(source) && source.length <= 0) {
            resolve([]);
            return;
        }
        const fetch = imap.fetch(source, { bodies: 'HEADER', size: true });
        const pending = [];
        const msgUIDs = [];
        let i = 0;
        fetch.on('message', function (msg, seqNo) {
            pending.push(parseMessage(msg).then((parsed) => {
                if (detector(parsed, i++))
                    msgUIDs.push(parsed.uid);
            }));
        });
        fetch.on('end', async function () {
            await Promise.all(pending); // Wait for all messages to finish parsing
            resolve(msgUIDs);
        });
    });
}
export function getRecipients(msg) {
    const addresses = [
        ...getAddresses(msg.to),
        ...getAddresses(msg.cc),
        ...getAddresses(msg.bcc),
    ];
    addresses.forEach((addr) => (addr.address = addr.address.toLowerCase()));
    return addresses;
}
// export function parseEmail(emails) {
//   const arr = [];
//   if (!emails) {
//     // do nothing
//   } else if (Array.isArray(emails)) {
//     emails.forEach((r) => arr.push(...parseEmail(r)));
//   } else {
//     // Strip out quoted strings (in display names), as this just confuses the
//     // regex
//     emails = emails.replace(/"[^"]*"/g, '');
//     // Split and add
//     emails.split(/, */).forEach((email) => {
//       // Extract email from "<...>" brackets
//       if (/<([^>]+)>/.test(email)) email = RegExp.$1;
//       // Sanity check that we have an email
//       if (/@/.test(email)) {
//         arr.push(email.trim().toLowerCase());
//       } else {
//         logger.error('Malformed email:', email);
//       }
//     });
//   }
//   return arr;
// }
//# sourceMappingURL=util.js.map