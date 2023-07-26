/* eslint-disable no-unused-vars */
import { GMaulParsedMail } from 'cli.js';
import { default as Imap, ImapMessage, ImapMessageAttributes } from 'imap';
import {
  AddressObject,
  EmailAddress,
  ParsedMail,
  simpleParser,
} from 'mailparser';
import { logger } from './logger.js';

export function isAddressObject(obj: object): obj is AddressObject {
  return 'value' in obj;
}

export function isEmailAddress(obj: object): obj is EmailAddress {
  return 'address' in obj;
}

export function isAllCaps(v?: string) {
  return v && v.length > 5 && v === v.toUpperCase();
}

export function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && 'code' in err;
}

// Get all emails from AddressObject
export function getAddresses(
  obj:
    | AddressObject
    | AddressObject[]
    | EmailAddress
    | EmailAddress[]
    | undefined,
  emails?: GMaulAddress[]
) {
  if (!emails) emails = [];

  if (!obj) {
    // do nothing
  } else if (Array.isArray(obj)) {
    for (const o of obj) {
      getAddresses(o, emails);
    }
  } else if (isAddressObject(obj)) {
    getAddresses(obj.value, emails);
  } else if (isEmailAddress(obj) && obj.address) {
    const { group, name, address } = obj;
    if (group) getAddresses(group, emails);
    if (name || address) emails.push({ address, name });
  }

  return emails;
}

export function getAddress(
  obj: AddressObject | EmailAddress | EmailAddress[] | undefined
) {
  const addresses = getAddresses(obj);
  return addresses.length ? addresses[0] : undefined;
}

function parseMessage(msg: ImapMessage) {
  return new Promise<GMaulParsedMail>((resolve, reject) => {
    let raw: string;
    let attributes: ImapMessageAttributes;

    msg.on('error', (err: Error) => reject(err));

    msg.on('body', (stream) => {
      const chunks: Buffer[] = [];

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
      const parsed = (await simpleParser(raw)) as GMaulParsedMail;
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

// export function search(imap : Imap, criteria) {
//   return new Promise((resolve, reject) => {
//     imap.search(criteria, function (err, uids) {
//       err ? reject(err) : resolve(uids);
//     });
//   });
// }

type DetectorFunction = (msg: GMaulParsedMail, i: number) => boolean;

export function fetchAndFilter(
  imap: Imap,
  source: string | string[], // See MessageSource in Imap type defs
  detector: DetectorFunction
) {
  return new Promise<ImapUID[]>((resolve, reject) => {
    if (Array.isArray(source) && source.length <= 0) {
      resolve([]);
      return;
    }

    const fetch = imap.fetch(source, { bodies: 'HEADER', size: true });
    const pending: Promise<unknown>[] = [];
    const msgUIDs: ImapUID[] = [];
    let i = 0;
    fetch.on('message', function (msg, seqNo) {
      pending.push(
        parseMessage(msg).then((parsed) => {
          if (detector(parsed, i++)) msgUIDs.push(parsed.uid);
        })
      );
    });

    fetch.on('end', async function () {
      await Promise.all(pending); // Wait for all messages to finish parsing
      resolve(msgUIDs);
    });
  });
}

export function getRecipients(msg: ParsedMail) {
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
