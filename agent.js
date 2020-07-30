#!/usr/bin/env node

const StringLang = require('@broofa/stringlang');
const colors = require('colors');
const fs = require('fs').promises;
const path = require('path');
const util = require('./lib/util');
const whitelist = require('./lib/whitelist');
const {URL} = require('url');
const chalk = require('chalk');

const CONFIG_PATH = path.join(__dirname, 'config/gmaul');
const SUBJECTS_PATH = path.join(__dirname, 'config/_subjects.json');
const SUBJECT_EXPIRY = 3600e3;

const config = require(CONFIG_PATH);

// List of user addresses
const userAliases = [config.server.user, ...config.aliases];

// Spammy term regex
const spamRegex = config.spamTerms && new RegExp(`\\b((?:${config.spamTerms.join('|')})\\w*)`, 'i');

let uidNext;

// ORDER HERE IS IMPORTANT
const FILTERS = [
  // Filters that allow should go first
  msg => {
    if (msg._.from && whitelist.lookup(msg._.from)) msg.allow('sender in whitelist');
  },
  msg => {
    // Allow emails sent to someone we've corresponded with
    const friends = msg._.emails.filter(e => !/broofa/i.test(e) && whitelist.lookup(e))
    if (friends.length > 0) msg.allow('other recipient in whitelist');
  },

  // Filters that deny should go after allow filters
  msg => {
    if (!spamRegex) return;
    const regex = /\b((?:market|opportunit|campaign|seo|pric|ppe|sanitiz|mask|fintech)\w*)/i;
    if (spamRegex.test(msg._.from)) msg.deny(`spammy term: "${RegExp.$1}" (sender)`);
    if (spamRegex.test(msg._.fromName)) msg.deny(`spammy term: "${RegExp.$1}" (sender)`);
    if (spamRegex.test(msg._.subject)) msg.deny(`spammy term: "${RegExp.$1}" (subject)`);
  },
  msg => {
    if (msg._.from.split(/\s+/).length > 2) msg.deny(`too many words in sender`);
  },
  msg => {
    const prop = ['name', 'address'].find(prop => {
      const v = msg.from.value[0][prop];
      return v && v.length > 5 && v.toUpperCase() == v;
    })
    if (prop) msg.deny(`All caps (${prop})`);
  },
  msg => {
    if (msg._.from && /(\.com\.tw)$/.test(msg._.from)) msg.deny(`from domain ${RegExp.$1}`);
  },
  msg => {
    if (!msg._.subject) msg.deny('empty subject');
  },
  msg => {
    const ctype = msg.headers.get('content-type');
    const charset = ctype && ctype.params && ctype.params.charset;

    if (charset && charset.toLowerCase() != 'utf-8') msg.deny(`charset ${charset}`);
  },
  msg => {
    const name = msg._.fromName;
    if (name.length <= 1) return;

    const sl = new StringLang(name);
    if (name.length - sl.basicLatin > 0) msg.deny('non-latin chars (name)');
  },
  msg => {
    const sl = new StringLang(msg._.subject);
    if (msg._.subject.length - sl.basicLatin > 0) msg.deny('non-latin chars (subject)');
  },
  msg => {
    if (msg._.emails.length <= 0) msg.deny('empty recipients');
  },
  msg => {
    if (!msg._.emails.find(e => userAliases.includes(e))) msg.deny('not sent to user');
  },
  msg => {
    // Spam comes from "foo###@gmail.com" address
    if (/\d\d@gmail.com/.test(msg._.from)) msg.deny('gmail## sender');
  },
  msg => {
    // Spam often sent to "foo###@gmail.com" addresses
    const suspect = msg._.emails.filter(e => /\d\d@gmail.com/.test(e));
    if (suspect.length >= 2) msg.deny('gmail## recipients');
  },
  msg => {
    if (/^(?:\w[\w-]+\w\.)+(?:com)$/i.test(msg._.subject)) msg.deny('subject is domain');
  },
  msg => {
    const user = msg._.emails.find(e => userAliases.includes(e.address));
    if (user && user.name &&
      !config.nameRegex.test(user.name)) msg.deny('user email but not user name');
  },
];

/**
 * Mark messages with duplicate subjects as spam
 */
let _subjects = {};
try {
  _subjects = require(SUBJECTS_PATH);
} catch (err) {
  console.log('Subjects file not loaded');
}

function checkSubject(msg, spamIds) {
  const time = Date.now();
  const {uid} = msg;
  let {subject = ''} = msg;

  subject = subject.toLowerCase()
    .replace(/\d+/g, '')
    .replace(/\W+/g, ' ')

  if (!subject) return;

  const last = _subjects[subject];

  // If last message with this subject was seen < 1h ago, mark both messages
  // as spam
  if (last && last.uid != uid && time - last.time < SUBJECT_EXPIRY) {
    if (!msg._deny || !spamIds.has(last.uid)) console.log(`(duplicate subject)`, msg.subject);
    spamIds.add(last.uid);
    spamIds.add(uid);
  }
  _subjects[subject] = {time, uid};
}

async function writeSubjects(subjects) {
  // Purge stale entries
  const now = Date.now();
  for (const [k, {time}] of Object.entries(subjects)) {
    if (time < now - SUBJECT_EXPIRY) delete subjects[k];
  }

  await fs.writeFile(SUBJECTS_PATH, JSON.stringify(subjects, null, 2));
}

/**
 * Main entry point
 */
let imap;
async function main() {
  if (!imap) {
    try {
      imap = await util.connect();
      imap.on('error', err => {
        console.error('IMAP Error', err);
        try {
          if (imap) imap.end(imap);
        } finally {
          imap = null;
        }
      });
    } catch(err) {
      console.error(`Failed to connect: ${colors.red(err.message)}`);
      return;
    }

    /*
    // List mailboxes
    const boxes = await imap.getBoxesAsync();
    function logBoxes(boxes, prefix = '') {
      if (!boxes) return;
      for (const [name, box] of Object.entries(boxes)) {
        const boxPath = `${prefix ? `${prefix}${box.delimiter}` : ''}${name}`;
        console.log(`${chalk.bold(boxPath)} (${box.attribs})`);
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

  console.log('Loop start');
  // process.stdout.write(`... done (sleeping)`);
  try {
    await whitelist.init();
  } catch (err) {
    console.error('Failed to initialize whitelist', err);
  }

  if (!whitelist.addresses) {
    throw Error('Whitelist unexpectedly uninitialized');
  }

  // Open INBOX (read-write)
  const box = await imap.openBoxAsync('INBOX', false);

  let ids;
  const lastUid = uidNext || 0;
  if (uidNext) {
    // Get messages since last
    ids = await imap.searchAsync(['UNSEEN', ['UID', `${uidNext}:*`]]);
  } else {
    // First time through, get messages for the past week
    const days = process.env.DAYS || 7;
    const since = new Date(Date.now() - days * 864e5);
    ids = await imap.searchAsync(['UNSEEN', ['SINCE', since.toDateString()]]);
  }
  uidNext = box.uidnext;

  // console.log(`Checking messages [${ids}]`);
  if (ids.length > 0) {
    let loggedTime;

    // For each message ...
    const spamIds = new Set();
    const filteredIds = await util.fetchAndFilter(imap, ids, (msg, i) => {
      // Fetch will return the last message, even if it's uid is less than the
      // range requested (wtf?!?), so we throw those away here.
      if (msg.uid < lastUid) return;

      // Pull together useful message state for filters
      msg._ = {
        from: msg.from.value[0].address.toLowerCase(),
        fromName: msg.from.value[0].name.toLowerCase(),
        emails: util.getRecipients(msg),
        subject: msg.subject ? msg.subject.replace(/^(?:re:\s*|fwd:\s*)+/i, '') : ''
      };

      msg.allow = status => msg._allow = status;
      msg.deny = status => msg._deny = status;

      // Apply each filter
      FILTERS.forEach(filter => {
        if (!filter || msg._allow || msg._deny) return;
        filter(msg);
      });

      if (process.env.DEBUG) {
        console.log(`DEBUG ${msg._allow || msg._deny}: (${msg._.from})${msg._.subject ? ` "${msg.subject}"` : ''}`);
      }

      // Check for messages w/ duplicate subjects
      if (!msg._allow) checkSubject(msg, spamIds);

      if (msg._deny) {
        if (!loggedTime) console.log(new Date().toLocaleString());
        loggedTime = true;
        console.log(`${msg._deny}: (${msg._.from})${msg._.subject ? ` "${msg.subject}"` : ''}`);

        return msg.uid;
      }

      return null;
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

  console.log('Loop end');
}

process.on('uncaughtException', err => {
  console.error('UNCAUGHT', err);
  process.exit();
});

process.on('unhandledRejection', err => {
  console.error('UNHANDLED', err);
  process.exit();
});

const loop = async () => {
  try {
    await main();
  } catch (err) {
    console.error(err);
  } finally {
    setTimeout(loop, process.env.interval || config.interval || 1e3);
  }
}

loop();
