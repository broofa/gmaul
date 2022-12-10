#!/usr/bin/env node

import { GMaulConfig, GMaulMessage, readFile, writeFile } from './config.js';
import { logger } from './logger.js';

type SubjectInfo = {
  time: number;
  uid: ImapUID;
};

const SUBJECTS_FILE = '_subjects.json';
const SUBJECT_EXPIRY = 3600e3;

let config: GMaulConfig;
let subjects: Record<string, SubjectInfo>;

export async function initSubjects(config: GMaulConfig) {
  config = config;
  subjects = await readFile<Record<string, SubjectInfo>>(SUBJECTS_FILE);
}

export async function writeSubjects() {
  // Purge stale entries
  const now = Date.now();
  for (const [k, { time }] of Object.entries(subjects)) {
    if (time < now - SUBJECT_EXPIRY) delete subjects[k];
  }

  await writeFile(SUBJECTS_FILE, subjects);
}

/**
 * Mark messages with duplicate subjects as spam
 */
export function checkSubject(msg: GMaulMessage, spamIds: Set<ImapUID>) {
  const time = Date.now();
  const { uid } = msg;
  let { subject = '' } = msg;

  subject = subject.toLowerCase().replace(/\d+/g, '').replace(/\W+/g, ' ');

  if (!subject) return;

  const last = subjects[subject];

  // If last message with this subject was seen < 1h ago, mark both messages
  // as spam
  if (last && last.uid != uid && time - last.time < SUBJECT_EXPIRY) {
    if (!msg._deny || !spamIds.has(last.uid))
      logger.log('(duplicate subject)', msg.subject);
    spamIds.add(last.uid);
    spamIds.add(uid);
  }
  subjects[subject] = { time, uid };
}
