import { unicodeBlockCount } from '@broofa/stringlang';
import { GMaulConfig } from 'config.js';
import { GMaulMessage } from './cli.js';
import { init as stopwordsInit } from './stopwords.js';
import { getAddress, isAllCaps } from './util.js';
import Whitelist from './whitelist.js';

export type FilterFunction = (msg: GMaulMessage) => void;

function buildFilter(terms: (string | RegExp)[]) {
  return function (str: string) {
    const lowerString = str.toLowerCase();
    for (const term of terms) {
      if (term instanceof RegExp) {
        if (term.test(str)) return term;
      } else if (lowerString.includes(term)) {
        return term;
      }
    }
    return false;
  };
}

export async function initFilters(config: GMaulConfig, whitelist: Whitelist) {
  const stopwords = await stopwordsInit(config);
  const whitelistFilter = buildFilter(config.whitelist);
  const blacklistFilter = buildFilter(config.blacklist);

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

    //
    // ALLOW filters (go before DENY)
    //

    (msg) => {
      if (!whitelistFilter) return;

      let match;
      if ((match = whitelistFilter(msg._.from)))
        msg.allow(`whitelisted: "${match}" (sender email)`);
      if ((match = whitelistFilter(msg._.fromName)))
        msg.allow(`whitelisted: "${match}" (sender name)`);
      if ((match = whitelistFilter(msg._.subject)))
        msg.allow(`whitelisted: "${match}" (subject)`);
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

    //
    // DENY filters
    //

    (msg) => {
      if (!blacklistFilter) return;

      let match;
      if ((match = blacklistFilter(msg._.from)))
        msg.deny(`spammy term: "${match}" (sender)`);
      if ((match = blacklistFilter(msg._.fromName)))
        msg.deny(`spammy term: "${match}" (sender)`);
      if ((match = blacklistFilter(msg._.subject)))
        msg.deny(`spammy term: "${match}" (subject)`);
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
      // @ts-ignore HeaderValue type is complicated
      const charset: string = ctype?.params?.charset?.toLowerCase();
      if (charset && charset != 'utf-8') msg.deny(`charset ${charset}`);
    },
    (msg) => {
      const { fromName: name } = msg._;
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
      // Spam comes from "foo##@gmail.com" address
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
    (msg) => {
      const senderStop = stopwords.detect(msg._.fromName);
      if (senderStop)
        msg.deny(
          `${senderStop.language.toUpperCase()} stopword: "${
            senderStop.word
          }" (sender)`
        );

      const subjectStop = stopwords.detect(msg._.subject);
      if (subjectStop)
        msg.deny(
          `${subjectStop.language.toUpperCase()} stopword: "${
            subjectStop.word
          }" (subject)`
        );
    },
  ];
  return FILTERS;
}
