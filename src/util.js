/* eslint-disable no-unused-vars */
import asyncProxy from '@broofa/asyncproxy';
import Imap from 'imap';
import { simpleParser2 as simpleParser } from 'mailparser2';
import fs from 'node:fs/promises';
import path from 'node:path';

import logger from './GMaulLogger.js';

const __dirname = path.dirname(new URL(import.meta.url).pathname);
const CONFIG_DIR = 'config';
const CONFIG_FILE = 'gmaul.json';

export function getConfigPath(filename) {
  return path.join(__dirname, '..', CONFIG_DIR, filename);
}

export async function getConfig(filename = 'gmaul.json') {
  const json = await fs.readFile(getConfigPath(filename));
  return JSON.parse(json);
}

const config = await getConfig();

function parseMessage(msg) {
  return new Promise((resolve, reject) => {
    let raw;
    let attributes;

    msg.on('error', (err) => reject(err));

    msg.on('body', (stream, info) => {
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
      const parsed = await simpleParser(raw);
      parsed.uid = attributes.uid;
      parsed.size = attributes.size;
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

export function connect(err, cb) {
  return new Promise((resolve, reject) => {
    const imap = new Imap(config.server);
    imap.once('ready', () => resolve(asyncProxy(imap)));
    imap.once('error', reject);
    imap.connect();
  });
}

export function search(imap, criteria) {
  return new Promise((resolve, reject) => {
    imap.search(criteria, function (err, uids) {
      err ? reject(err) : resolve(uids);
    });
  });
}

export function fetchAndFilter(imap, source, detector) {
  return new Promise((resolve, reject) => {
    if (Array.isArray(source) && source.length <= 0) {
      resolve([]);
      return;
    }

    const fetch = imap.fetch(source, { bodies: 'HEADER', size: true });
    const pending = [];
    const msgs = [];
    let i = 0;
    fetch.on('message', function (msg, seqNo) {
      pending.push(
        parseMessage(msg, 'utf8').then((parsed) => {
          const result = detector(parsed, i++);
          if (result != null) msgs.push(result);
        })
      );
    });

    fetch.on('end', async function () {
      await Promise.all(pending); // Wait for all messages to finish parsing
      resolve(msgs);
    });
  });
}

export function getRecipients(msg) {
  let emails = [];
  if (msg.to && msg.to.value) emails.push(...(msg.to.value || msg.to));
  if (msg.cc && msg.cc.value) emails.push(...(msg.cc.value || msg.cc));
  if (msg.bcc && msg.bcc.value) emails.push(...(msg.bcc.value || msg.bcc));
  return emails
    .map((e) => e.address && e.address.toLowerCase())
    .filter((e) => e);
}

export function parseEmail(emails) {
  const arr = [];

  if (!emails) {
    // do nothing
  } else if (Array.isArray(emails)) {
    emails.forEach((r) => arr.push(...parseEmail(r)));
  } else {
    // Strip out quoted strings (in display names), as this just confuses the
    // regex
    emails = emails.replace(/"[^"]*"/g, '');

    // Split and add
    emails.split(/, */).forEach((email) => {
      // Extract email from "<...>" brackets
      if (/<([^>]+)>/.test(email)) email = RegExp.$1;

      // Sanity check that we have an email
      if (/@/.test(email)) {
        arr.push(email.trim().toLowerCase());
      } else {
        logger.error('Malformed email:', email);
      }
    });
  }

  return arr;
}
