export class GmaulLogger {
  #ticked = false;

  tick(char = '.') {
    process.stdout.write(char);
    this.#ticked = true;
  }

  untick() {
    if (this.#ticked) process.stdout.write('\n');
    this.#ticked = false;
  }

  log(...args: any[]) {
    this.untick();
    console.log(...args);
  }

  error(...args: any[]) {
    this.untick();
    console.error(...args);
  }
}

export const logger = new GmaulLogger();
