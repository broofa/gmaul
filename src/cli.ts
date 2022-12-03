#!/usr/bin/env node

import fs from 'node:fs/promises';
import {
  connect,
  fetchAndFilter,
  getAddress,
  getConfig,
  getConfigPath,
  getRecipients,
  GMaulConnection,
} from './util.js';
import whitelist from './whitelist.js';

import { Config } from 'imap';
import { ParsedMail } from 'mailparser';
import { getFilters } from './filters.js';
import logger from './GMaulLogger.js';

export type GMaulConfig = {
  allowTerms: string[];
  emails: string[];
  names: string[];
  interval: number;
  server: Config;
  spamTerms: string[];
  trash: string;
};

export interface GMaulParsedMail extends ParsedMail {
  uid: number;
  size: number;
}

export type GMaulMessage = GMaulParsedMail & {
  allow: (why: string) => void;
  deny: (why: string) => void;
  _allow?: boolean;
  _deny?: boolean;
  _: {
    from: string;
    fromName: string;
    recipients: GMaulAddress[];
    subject: string;
  };
};

const SUBJECTS_FILE = '_subjects.json';
const SUBJECT_EXPIRY = 3600e3;

const config = await getConfig();

// Spammy term regex
const spamRegex =
  config.spamTerms &&
  new RegExp(`\\b((?:${config.spamTerms.join('|')})\\w*)`, 'i');

let uidNext = 0;

const FILTERS = getFilters(config, whitelist);

type SubjectInfo = {
  time: number;
  uid: ImapUID;
};

let foo: ParsedMail;

let _subjects: Record<string, SubjectInfo> = {};
try {
  _subjects = await getConfig<Record<string, SubjectInfo>>(SUBJECTS_FILE);
} catch (err) {
  logger.log('Subjects file not loaded', err);
}

/**
 * Mark messages with duplicate subjects as spam
 */
function checkSubject(msg: GMaulMessage, spamIds: Set<ImapUID>) {
  const time = Date.now();
  const { uid } = msg;
  let { subject = '' } = msg;

  subject = subject.toLowerCase().replace(/\d+/g, '').replace(/\W+/g, ' ');

  if (!subject) return;

  const last = _subjects[subject];

  // If last message with this subject was seen < 1h ago, mark both messages
  // as spam
  if (last && last.uid != uid && time - last.time < SUBJECT_EXPIRY) {
    if (!msg._deny || !spamIds.has(last.uid))
      logger.log('(duplicate subject)', msg.subject);
    spamIds.add(last.uid);
    spamIds.add(uid);
  }
  _subjects[subject] = { time, uid };
}

async function writeSubjects(subjects: Record<string, SubjectInfo>) {
  // Purge stale entries
  const now = Date.now();
  for (const [k, { time }] of Object.entries(subjects)) {
    if (time < now - SUBJECT_EXPIRY) delete subjects[k];
  }

  await fs.writeFile(
    getConfigPath(SUBJECTS_FILE),
    JSON.stringify(subjects, null, 2)
  );
}

/**
 * Main entry point
 */
let imap: GMaulConnection | undefined;
async function main() {
  if (!imap) {
    try {
      // Open imap connection
      imap = await connect();
    } catch (err) {
      logger.log('IMAP connect() error', (err as Error).message);
      imap?.end();
      imap = undefined;
      return;
    }

    /*
    // List mailboxes
    const boxes = await imap.getBoxesAsync();
    function logBoxes(boxes, prefix = '') {
      if (!boxes) return;
      for (const [name, box] of Object.entries(boxes)) {
        const boxPath = `${prefix ? `${prefix}${box.delimiter}` : ''}${name}`;
        logBoxes(box.children, boxPath);
      }
    }

    logBoxes(boxes);
    */

    /*
    // Note: This doesn't appear to work (possibly due to [GMAIL]/Spam folder
    // having \Noselect option?)
    const spam = await imap.openBoxAsync('[GMAIL]/Spam', true);
    const since = new Date(Date.now() - 24 * 3600e3); // Previous day
    ids = await imap.searchAsync([['SINCE', since.toDateString()]]);
    await imap.closeBoxAsync();
    */
  }

  // Load whitelist
  try {
    await whitelist.init();
  } catch (err) {
    logger.error('Failed to initialize whitelist', err);
  }

  if (!whitelist.addresses) {
    throw Error('Whitelist unexpectedly uninitialized');
  }

  // Open INBOX (read-write)
  const box = await imap.openBoxAsync('INBOX', false);

  let ids: ImapUID[];
  const lastUid = uidNext || 0;
  if (uidNext) {
    // Get messages since last
    ids = await imap.searchAsync(['UNSEEN', ['UID', `${uidNext}:*`]]);
  } else {
    // First time through, get messages for the past week
    const days = process.env.DAYS ? parseInt(process.env.DAYS) : 7;
    const since = new Date(Date.now() - days * 864e5);
    ids = await imap.searchAsync(['UNSEEN', ['SINCE', since.toDateString()]]);
  }
  uidNext = box.uidnext;

  if (ids.length > 0) {
    let loggedTime = false;

    // For each message ...
    const spamIds: Set<ImapUID> = new Set();

    const filteredIds = await fetchAndFilter(imap, ids.map(String), (msg) => {
      // Fetch will return the last message, even if it's uid is less than the
      // range requested (wtf?!?), so we throw those away here.
      if (msg.uid < lastUid) return false;

      const from = getAddress(msg.from);

      // Build enhanced message object
      const gMsg: GMaulMessage = Object.assign(Object.create(msg), {
        _allow: undefined as undefined | string,
        _deny: undefined as undefined | string,
        _: {
          from: from?.address.toLowerCase(),
          fromName: from?.name?.toLowerCase(),
          recipients: getRecipients(msg),
          subject: msg.subject
            ? msg.subject.replace(/^(?:re:\s*|fwd:\s*)+/i, '')
            : '',
        },
        allow(status: string) {
          this._allow = status;
        },
        deny(status: string) {
          this._deny = status;
        },
      });

      // Apply each filter
      FILTERS.find((filter) => {
        filter?.(gMsg);
        return gMsg._deny || gMsg._allow;
      });

      // Check for messages w/ duplicate subjects
      if (!gMsg._allow) checkSubject(gMsg, spamIds);

      if (gMsg._deny) {
        if (!loggedTime) logger.log(new Date().toLocaleString());
        loggedTime = true;
        logger.log(
          `${gMsg._deny}: (${gMsg._.from})${
            gMsg._.subject ? ` "${gMsg.subject}"` : ''
          }`
        );
      }

      return gMsg._deny ? true : false;
    });

    await writeSubjects(_subjects);
    for (const id of filteredIds) spamIds.add(id);

    if (spamIds.size) {
      // Also mark as seen.  Do this before moving, as message uids change as a
      // result of the move, below?
      // await imap.addFlagsAsync(spamIds, '\\Seen');

      // Move out of Inbox
      await imap.moveAsync([...spamIds], config.trash);
    }
  }

  await imap.closeBoxAsync(true);
}

process.on('uncaughtException', (err) => {
  logger.error('UNCAUGHT', err);
  process.exit();
});

process.on('unhandledRejection', (err) => {
  logger.error('UNHANDLED', err);
  process.exit();
});

const delay = process.env.interval
  ? Number(process.env.interval)
  : config.interval ?? 1e3;

logger.log(`Starting loop with ${delay}ms delay`);

// eslint-disable-next-line no-constant-condition
while (true) {
  logger.tick('-');

  try {
    await main();
  } catch (err) {
    logger.error('MAIN LOOP ERROR', err);
  }

  logger.tick('.');
  await new Promise((resolve) => setTimeout(resolve, delay));
}
