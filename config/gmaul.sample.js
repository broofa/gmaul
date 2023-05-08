export default {
  // Email server login (currently only tested for GMail)
  server: {
    // e.g. "yourname@gmail.com"
    user: 'your address here',

    // e.g. app password frmo https://support.google.com/accounts/answer/185833?hl=en
    password: 'your password',
    host: 'imap.gmail.com',
    port: 993,
    tls: true,
    tlsOptions: {
      servername: 'imap.gmail.com',
    },
  },

  // (Unused) Interval at which to poll server for new mail
  interval: 60000,

  // Email addresses you use
  emails: ['myname@mydomainbroofa.com', 'myname@gmail.com'],

  // Names you commonly go by (i.e. names that you expect people to associate with your emails, above)
  names: ['John', 'Johnathan'],

  // Languages you expect to receive emails in.  E.g. ['en', 'fr'].
  // May be any of the codes supported by https://github.com/stopwords-iso/stopwords-iso
  languages: ['en'],

  // Terms to whitelist (in sender or subject)
  whitelist: ['broofa.com', 'github.com', 'reply.craigslist'],

  // Terms to blacklist (in sender or subject).  May include regexes, e.g. "\\bfree\\b"
  blacklist: [
    'advancial',
    'application.*care|care.*application',
    '^broofa$',
    'campaign',
    'collision repair',
    'dennis lyons',
    'edmobile',
    'fintech',
    'guest post',
    'market',
    'mask',
    'milanus',
    'opportunit',
    '\\bppe\\b',
    '\\bpric',
    'propmodo',
    'pharma',
    '\\bsanitiz',
    'seo',
    'sharepointonline',
    'uptasker',
  ],

  // Folder to put spam emails into
  trash: 'gmaul',
};
