#!/usr/bin/env node

import fs from 'node:fs/promises';

import { Config } from 'imap';
import { ParsedMail } from 'mailparser';
import path from 'node:path';

export type GMaulConfig = {
  emails: string[];
  names: string[];
  interval: number;
  server: Config;
  blacklist: string[];
  whitelist: string[];
  trash: string;
};

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

const __dirname = path.dirname(new URL(import.meta.url).pathname);
const CONFIG_DIR = 'config';
const CONFIG_FILE = 'gmaul.json';

export function getConfigPath(filename: string) {
  return path.join(__dirname, '..', CONFIG_DIR, filename);
}

export async function readFile<T>(filename: string): Promise<T> {
  const json = await fs.readFile(getConfigPath(filename), 'utf8');
  return JSON.parse(json);
}

export async function writeFile<T>(filename: string, obj: object) {
  await fs.writeFile(getConfigPath(filename), JSON.stringify(obj, null, 2));
}

export async function initConfig() {
  return readFile<GMaulConfig>(CONFIG_FILE);
}
