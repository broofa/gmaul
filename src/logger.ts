import ora from 'ora';

const spinner = ora({spinner: 'dots', interval: 100});
export class GmaulLogger {
  untick() {
    if (spinner.text) process.stdout.write('\r');
  }

  spin(str?: string) {
    if (str) {
      spinner.text = str;
      spinner.start();
    } else {
      spinner.stop();
    }
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
