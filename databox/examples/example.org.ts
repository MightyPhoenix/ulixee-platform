// NOTE: you must start your own Ulixee Miner to run this example.

import Databox, { Schema } from '@ulixee/databox-for-hero';
const { string } = Schema;

// configure input.url by running as node example.org.js --input.url="https://ulixee.org"

export default new Databox({
  defaults: {
    input: {
      url: 'https://example.org',
    },
  },
  async run(databox) {
    const { input, output, hero } = databox;

    await hero.goto(input.url);
    const title = await hero.document.title;

    output.title = title;
    output.body = await hero.document.body.textContent;
    console.log(`LOADED ${input.url}: ${title}`);
    await hero.close();
  },
  schema: {
    input: {
      url: string({ format: 'url' }),
    },
    output: {
      title: string(),
      body: string(),
    },
  },
});
