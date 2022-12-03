declare module '@broofa/stringlang' {
  export function unicodeBlockCount(str: string): Record<string, number>;
}

declare module '@broofa/asyncproxy' {
  export default function asyncProxy<T>(obj: T): T;
}

type ImapUID = number;

type GMaulAddress = {
  address: string;
  name?: string;
};
