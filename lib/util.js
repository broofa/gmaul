const Imap = require('imap');
const simpleParser = require('mailparser2').simpleParser2;
const asyncProxy = require('@broofa/asyncproxy');
const config = require('../config/gmaul');

function parseMessage(msg) {
  return new Promise((resolve, reject) => {
    let raw;
    let attributes;

    msg.on('error', err => reject(err));

    msg.on('body', (stream, info) => {
      const chunks = [];

      stream.once('error', err => console.error(err));
      stream.on('data', chunk => chunks.push(chunk));
      stream.once('end', () => {
        raw = Buffer.concat(chunks).toString('utf8');
      });
    });

    msg.on('attributes', atts => {
      attributes = atts;
    });

    msg.on('end', async () => {
      const parsed = await simpleParser(raw);
      parsed.uid = attributes.uid;
      resolve(parsed);
    });
  });
}

exports.getBoxes = function() {
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
};

exports.connect = function(err, cb) {
  return new Promise((resolve, reject) => {
    const imap = new Imap(config.server);

    imap.once('ready', () => resolve(asyncProxy(imap)));
    imap.once('error', err => reject(err));
    imap.connect();
  });
};

exports.search = function(imap, criteria) {
  return new Promise((resolve, reject) => {
    imap.search(criteria, function(err, uids) {
      (err ? reject(err) : resolve(uids));
    });
  });
};

exports.fetchAndFilter = function(imap, source, detector) {
  return new Promise((resolve, reject) => {
    if (Array.isArray(source) && source.length <= 0) return [];

    const fetch = imap.fetch(source, {bodies: 'HEADER'});
    const pending = [];
    const msgs = [];
    let i = 0;
    fetch.on('message', function(msg, seqNo) {
      pending.push(new Promise(async resolve => {
        const parsed = await parseMessage(msg, 'utf8');
        if (detector(parsed, i++)) msgs.push(parsed);
        resolve();
      }));
    });

    fetch.on('end', async function() {
      await Promise.all(pending); // Wait for all messages to finish parsing
      resolve(msgs);
    });
  });
};

exports.getRecipients = function(msg) {
  let emails = [];
  if (msg.to && msg.to.value) emails.push(...(msg.to.value || msg.to));
  if (msg.cc && msg.cc.value) emails.push(...(msg.cc.value || msg.cc));
  if (msg.bcc && msg.bcc.value) emails.push(...(msg.bcc.value || msg.bcc));
  return emails
    .map(e => e.address && e.address.toLowerCase())
    .filter(e => e);
}

exports.parseEmail = function(emails) {
  const arr = [];

  if (!emails) {
    // do nothing
  } else if (Array.isArray(emails)) {
    emails.forEach(r => arr.push(...exports.parseEmail(r)));
  } else {
    // Strip out quoted strings (in display names), as this just confuses the
    // regex
    emails = emails.replace(/"[^"]*"/g, '');

    // Split and add
    emails.split(/, */).forEach(email => {
      // Extract email from "<...>" brackets
      if (/<([^>]+)>/.test(email)) email = RegExp.$1;

      // Sanity check that we have an email
      if (/@/.test(email)) {
        arr.push(email.trim().toLowerCase());
      } else {
        console.error('Malformed email:', email);
      }
    });
  }

  return arr;
};
