#!/usr/bin/env node

import { ParsedMail } from 'mailparser';
import { initConfig } from './config.js';
import { connect, GMaulConnection } from './connection.js';
import { initFilters } from './filters.js';
import { logger } from './logger.js';
import { checkSubject, initSubjects, writeSubjects } from './subjects.js';
import { fetchAndFilter, getAddress, getRecipients } from './util.js';
import whitelist from './whitelist.js';

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

const config = await initConfig();
await initSubjects(config);
const filters = initFilters(config, whitelist);

let uidNext = 0;

async function processMail(imap: GMaulConnection, numNewMessages = 0) {
  logger.log('CHECKING');
  // Load whitelist
  try {
    await whitelist.init(config);
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
      filters.find((filter) => {
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

    await writeSubjects();
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

let imap: GMaulConnection | undefined;
let reconnectTimer: NodeJS.Timeout | undefined;

logger.log('starting');

connect(config, {
  ready: processMail,
  mail: processMail,
});
