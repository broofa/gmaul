#!/usr/bin/env node

const StringLang = require('@broofa/stringlang');
const colors = require('colors');
const config = require('./config/gmaul');
const fs = require('fs');
const path = require('path');
const util = require('./lib/util');
const whitelist = require('./lib/whitelist');
const {URL} = require('url');

let uidNext;

// List of user addresses
const userAliases = [config.server.user, ...config.aliases];

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
    if (!msg._.subject) msg.deny('empty subject');
  },
  msg => {
    const ctype = msg.headers.get('content-type');
    const charset = ctype.params && ctype.params.charset;

    if (charset && charset.toLowerCase() != 'utf-8') msg.deny(`charset ${charset}`);
  },
  msg => {
    const name = msg._.fromName;
    if (name.length <= 1) return;

    const sl = new StringLang(name);
    const latinScore = (name.length - sl.basicLatin) / name.length;
    if (latinScore > .2) msg.deny('non-latin chars (sender)');
  },
  msg => {
    const sl = new StringLang(msg._.subject);
    const len = msg._.subject.length;
    const latinScore = (len - sl.basicLatin) / len;
    if (len > 1 && latinScore > .2) msg.deny('non-latin chars (subject)');
  },
  msg => {
    if (msg._.emails.length <= 0) msg.deny('empty recipients');
  },
  msg => {
    if (!msg._.emails.find(e => userAliases.includes(e))) msg.deny('not sent to user');
  },
  msg => {
    // Spam tends to come from "foo###@gmail.com"
    const suspect = msg._.emails.filter(e => /\d\d@gmail.com/.test(e));
    if (suspect.length >= 2) msg.deny('suspicious recipients');
  },
  msg => {
    if (/^(?:\w[\w-]+\w\.)+(?:com)$/i.test(msg._.subject)) msg.deny('subject is domain');
  },
  msg => {
    const user = msg.to.value.find(e => userAliases.includes(e.address));
    if (user && user.name &&
      !config.nameRegex.test(user.name)) msg.deny('user email but not user name');
  },
];

function line(str) {
  // Write a string on the current line, clearing to end of line
  process.stdout.write(`\r${str}\x1b[K`);
}

async function main() {
  let imap;
  try {
    imap = await util.connect();
  } catch(err) {
    console.error(`Failed to connect: ${colors.red(err.message)}`);
    return;
  }


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
  console.log('Mailboxes', names);
  */


  try {
    await whitelist.init();
  } catch (err) {
    console.error('Failed to initialize whitelist');
  }

  if (!whitelist.addresses) {
    line('Generating whitelist.  This may take a few minutes ...');
    await whitelist.generate();
    if (!whitelist.addresses) throw Error('Failed to create whitelist');
    line('Created whitelist');
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

  line(`Checking messages [${ids}]`);
  if (ids.length > 0) {
    // For each message ...
    const spam = await util.fetchAndFilter(imap, ids, (msg, i) => {
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
        if (!filter || msg._deny || msg._allow) return;
        filter(msg);
      });

      if (msg._deny) {
        console.log(`${colors.blue(msg._deny)}: (${msg._.from})${msg._.subject ? ` "${msg.subject}"` : ''}`);
        return true;
      }

      return false;
    });

    const spamIds = spam.map(msg => msg.uid);
    if (spamIds && spamIds.length > 0) {
      // Also mark as seen.  Do this before moving, as message uids change as a
      // result of the move, below?
      // await imap.addFlagsAsync(spamIds, '\\Seen');

      // Move out of Inbox
      await imap.moveAsync(spamIds, config.trash);
    }
  }

  await imap.closeBoxAsync(true);

  imap.end(imap);
}

process.on('uncaughtException', console.error);
process.on('unhandledRejection', console.error);

if (process.env.TIMER) {
  const loop = async () => {
    try {
      await main();
    } catch (err) {
      console.error(err);
    }

    process.stdout.write(`... done (sleeping)`);

    setTimeout(loop, parseInt(process.env.TIMER));
  }

  loop();
} else {
  main();
}
