import stopwords from 'stopwords-iso' assert { type: 'json' };

interface SearchNode {
  language?: string;
  [key: string]: string | SearchNode | undefined;
}
class Searcher {
  #root: SearchNode = {};

  add(word: string, lang: string) {
    const chars = word.split('');
    let trace = this.#root;
    for (const char of chars) {
      if (!trace[char]) trace[char] = {};
      trace = trace[char] as SearchNode;
    }

    trace.language = trace.language ? trace.language + ',' + lang : lang;
  }

  search(word: string): string | undefined {
    let trace = this.#root;
    const chars = word.split('');
    for (const char of word.split('')) {
      if (!trace[char]) return;
      trace = trace[char] as SearchNode;
    }

    return trace.language ?? undefined;
  }

  detect(str: string) {
    for (const word of str.toLowerCase().split(/\s+/)) {
      const language = this.search(word);
      if (language) return { word, language };
    }
  }
}

export function init(exemptLanguages: string[] = []) {
  const searcher = new Searcher();

  exemptLanguages = exemptLanguages.map((lang) => lang.toLowerCase());

  // Build list of words to exempt (stopwords in the user's prefered languages)
  const exemptWords = new Set<string>();
  for (const lang of exemptLanguages) {
    const words: string[] = stopwords[lang];
    if (!words) throw new Error(`Unsupported language: ${lang}`);
    for (const word of words) {
      exemptWords.add(word);
    }
  }

  // Build search tree for stop words in other languages
  for (const [lang, words] of Object.entries(stopwords)) {
    if (exemptLanguages.includes(lang)) continue;
    for (const word of words) {
      // There's a lot of noise in the stopwords lists where short words are
      // concerned, so we ignore them
      if (word.length < 3) continue;

      if (exemptWords.has(word)) continue;
      searcher.add(word, lang);
    }
  }

  return searcher;
}
