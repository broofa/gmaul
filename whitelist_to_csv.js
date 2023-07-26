// Usage: node whitelist_to_csv.js > whitelist.csv

import data from './config/_whitelist.json' assert { type: 'json' };
const rows = Object.entries(data.addresses);

rows.sort((a, b) => {
  a = a[1].inboxBytes;
  b = b[1].inboxBytes;
  return a > b ? -1 : a < b ? 1 : 0;
})

const keys = ['email', ...Object.keys(rows[0][1])];
console.log(keys.join(', '));

for (const [email, stats] of rows) {
  const values = [email, ...Object.values(stats)];
  console.log(values.join(', '));
}