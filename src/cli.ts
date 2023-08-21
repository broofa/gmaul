#!/usr/bin/env node

import { ParsedMail } from 'mailparser';
import { initConfig } from './config.js';
import { GMaulConnection, connect } from './connection.js';
import { initFilters } from './filters.js';
import { logger } from './logger.js';
import { checkSubject, initSubjects, writeSubjects } from './subjects.js';
import { fetchAndFilter, getAddress, getRecipients } from './util.js';
import Whitelist from './whitelist.js';

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

async function processMail(imap: GMaulConnection, whitelist: Whitelist) {
  // Load whitelist
  logger.spin('Loading whitelist');
  await whitelist.update();

  // Open INBOX (read-write)
  logger.spin('Opening INBOX...');
  let box = await imap.openBoxAsync('INBOX', false);

  let ids: ImapUID[];
  const lastUid = uidNext || 0;
  if (uidNext) {
    // Get messages since last
    logger.spin('Searching UNSEEN messages (update)...');
    ids = await imap.searchAsync(['UNSEEN', ['UID', `${uidNext}:*`]]);
  } else {
    // First time through, get messages for the past week
    const days = process.env.DAYS ? parseInt(process.env.DAYS) : 30;
    const since = new Date(Date.now() - days * 864e5);
    logger.spin('Searching UNSEEN messages (past week)...');
    ids = await imap.searchAsync(['UNSEEN', ['SINCE', since.toDateString()]]);
  }
  uidNext = box.uidnext;

  if (ids.length > 0) {
    // For each message ...
    const spamIds: Set<ImapUID> = new Set();

    logger.spin('Filtering UNSEEN...');
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
      filters.find((filter) => {
        filter?.(gMsg);
        return gMsg._deny || gMsg._allow;
      });

      // Check for messages w/ duplicate subjects
      if (!gMsg._allow) checkSubject(gMsg, spamIds);

      if (gMsg._deny) {
        logger.log(
          `${gMsg._deny}: (${gMsg._.from})${
            gMsg._.subject ? ` "${gMsg.subject}"` : ''
          }`
        );
      }

      return gMsg._deny ? true : false;
    });

    logger.spin('Saving subjects...');
    await writeSubjects();
    for (const id of filteredIds) spamIds.add(id);

    if (spamIds.size) {
      // Also mark as seen.  Do this before moving, as message uids change as a
      // result of the move, below?
      // await imap.addFlagsAsync(spamIds, '\\Seen');

      // Move out of Inbox
      logger.spin(`Moving messages to ${config.trash}...`);
      await imap.moveAsync([...spamIds], config.trash);
    }
  }

  logger.spin('Closing INBOX...');
  await imap.closeBoxAsync(true);
}

async function pollForMail(imap: GMaulConnection, whitelist: Whitelist) {
  const since = Date.now() - lastPoll;

  if (since < config.interval) {
    logger.spin(`Polling in ${Math.round((config.interval - since) / 1000)}`);
  } else {
    try {
      isProcessing = true;
      await processMail(imap, whitelist);
    } catch (err) {
      if ('source' in (err as Error)) {
        logger.error(err);
      } else {
        throw err;
      }
    } finally {
      isProcessing = false;
      lastPoll = Date.now();
    }
  }

  setTimeout(() => pollForMail(imap, whitelist), 1000);
}

process.on('uncaughtException', (err) => {
  logger.error('UNCAUGHT', err);
  process.exit();
});

process.on('unhandledRejection', (err) => {
  logger.error('UNHANDLED', err);
  process.exit();
});

import readline from 'readline';

function watchStdin() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  rl.on('line', () => (lastPoll = 0));
}

let uidNext = 0;
let isProcessing = false;
let lastPoll = 0;

const config = await initConfig();
await initSubjects(config);

const whitelist = new Whitelist(config);

const filters = await initFilters(config, whitelist);

connect(config, {
  ready(imap: GMaulConnection) {
    pollForMail(imap, whitelist);
  },
});

watchStdin();