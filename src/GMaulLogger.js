export class GmaulLogger {
  #ticked = false;

  tick(char = '.') {
    process.stdout.write(char);
    this.#ticked = true;
  }
  s;

  untick() {
    if (this.#ticked) process.stdout.write('\n');
    this.#ticked = false;
  }

  log(...args) {
    this.untick();
    console.log(...args);
  }

  error(...args) {
    this.untick();
    console.error(...args);
  }
}

export default new GmaulLogger();
