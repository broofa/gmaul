import { unicodeBlockCount } from '@broofa/stringlang';
import { GMaulConfig } from 'config.js';
import { GMaulMessage } from './cli.js';
import { getAddress, isAllCaps } from './util.js';
import Whitelist from './whitelist.js';

export type FilterFunction = (msg: GMaulMessage) => void;

export function initFilters(config: GMaulConfig, whitelist: Whitelist) {
  const whitelistRegex =
    config.whitelist &&
    new RegExp(`\\b((?:${config.whitelist.join('|')})\\w*)`, 'i');

  const blacklistRegex =
    config.blacklist &&
    new RegExp(`\\b((?:${config.blacklist.join('|')})\\w*)`, 'i');

  function includesUserEmail(str: string) {
    str = str.toLowerCase();
    for (const email of config.emails) {
      if (str.includes(email)) return true;
    }
    return false;
  }

  function includesUserName(str: string) {
    str = str.toLowerCase();
    for (const name of config.names) {
      if (str.includes(name)) return true;
    }
    return false;
  }

  const FILTERS: FilterFunction[] = [
    // ORDER HERE IS IMPORTANT

    // ALLOW filters (go before DENY)
    (msg) => {
      if (!whitelistRegex) return;

      if (whitelistRegex.test(msg._.from))
        msg.allow(`whitelisted: "${RegExp.$1}" (sender email)`);
      if (whitelistRegex.test(msg._.fromName))
        msg.allow(`whitelisted: "${RegExp.$1}" (sender name)`);
      if (whitelistRegex.test(msg._.subject))
        msg.allow(`whitelisted: "${RegExp.$1}" (subject)`);
    },

    (msg) => {
      if (msg._.from && whitelist.lookup(msg._.from))
        msg.allow('sender in whitelist');
    },
    (msg) => {
      const knownRecipient = msg._.recipients.find((e: GMaulAddress) => {
        if (includesUserEmail(e.address)) return false;
        return whitelist.lookup(e.address);
      });

      // Allow emails sent to someone we've corresponded with
      if (knownRecipient) {
        msg.allow(`known recipient (${knownRecipient.address})`);
      }
    },

    // DENY filters
    (msg) => {
      if (!blacklistRegex) return;

      if (blacklistRegex.test(msg._.from))
        msg.deny(`spammy term: "${RegExp.$1}" (sender)`);
      if (blacklistRegex.test(msg._.fromName))
        msg.deny(`spammy term: "${RegExp.$1}" (sender)`);
      if (blacklistRegex.test(msg._.subject))
        msg.deny(`spammy term: "${RegExp.$1}" (subject)`);
    },
    (msg) => {
      if (msg._.from.split(/\s+/).length > 2)
        msg.deny('too many words in sender');
    },
    (msg) => {
      const { name, address } = getAddress(msg.from) ?? {};
      if (isAllCaps(name)) msg.deny(`All caps (name)`);
      if (isAllCaps(address)) msg.deny(`All caps (address)`);
    },
    (msg) => {
      if (msg._.from && /(\.com\.tw)$/.test(msg._.from))
        msg.deny(`from domain ${RegExp.$1}`);
    },
    (msg) => {
      if (!msg._.subject) msg.deny('empty subject');
    },
    (msg) => {
      const ctype = msg.headers.get('content-type');
      // @ts-ignore HeaderValue is complicated enough it's writing type-checking logic
      const charset: string = ctype?.params?.charset?.toLowerCase();
      if (charset && charset != 'utf-8') msg.deny(`charset ${charset}`);
    },
    (msg) => {
      const name = msg._.fromName;
      if (name.length <= 1) return;

      const sl = unicodeBlockCount(name);
      if (name.length - sl.basicLatin > 0) msg.deny('non-latin chars (name)');
    },
    (msg) => {
      const sl = unicodeBlockCount(msg._.subject);
      if (msg._.subject.length - sl['Basic Latin'] > 0)
        msg.deny('non-latin chars (subject)');
    },
    (msg) => {
      if (msg._.recipients.length <= 0) msg.deny('empty recipients');
    },
    (msg) => {
      if (!msg._.recipients.find((e) => includesUserEmail(e.address)))
        msg.deny('not sent to user');
    },
    (msg) => {
      // Spam comes from "foo###@gmail.com" address
      if (/\d\d@gmail.com/.test(msg._.from)) msg.deny('gmail## sender');
    },
    (msg) => {
      // Spam often includes "foo###@gmail.com" in other recipients
      const suspect = msg._.recipients.filter((e) =>
        /\d\d@gmail.com/.test(e.address)
      );
      if (suspect.length >= 2) msg.deny('gmail## recipients');
    },
    (msg) => {
      if (/^(?:\w[\w-]+\w\.)+(?:com)$/i.test(msg._.subject))
        msg.deny('subject is domain');
    },
    (msg) => {
      const user = msg._.recipients.find((e) => includesUserEmail(e.address));
      if (user?.name && !includesUserName(user.name))
        msg.deny('user email but not user name');
    },
  ];
  return FILTERS;
}
