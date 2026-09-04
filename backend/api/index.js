/**
 * The serverless entrypoint.
 *
 * ## Why this file is JavaScript, and why it only imports from `dist/`
 *
 * Vercel compiles a function's own source with esbuild, and esbuild does not
 * emit `design:paramtypes` metadata. NestJS resolves every constructor
 * dependency from exactly that metadata, so a TypeScript entrypoint compiled
 * by the platform produces an application where nothing can be injected — and
 * the failure reads as a missing provider rather than as a missing compiler
 * feature.
 *
 * So the application is compiled by `tsc` during the build, with
 * `emitDecoratorMetadata` on, and this file is a plain-JavaScript shim over the
 * result. It contains no logic worth type-checking.
 *
 * ## Why the app is cached across invocations
 *
 * Building it costs a Nest container, a Prisma client, and a database
 * connection. A warm invocation that rebuilt all three would spend more time
 * starting than answering. The promise is cached rather than the app, so
 * concurrent cold requests wait on one bootstrap instead of racing to build
 * several.
 *
 * ## What this deployment cannot do
 *
 * A serverless instance is frozen once the response is sent. `InlineQueueAdapter`
 * enqueues work with a fire-and-forget promise that runs *after* the response,
 * so background jobs — notifications, budget alerts, retries — are dropped
 * here, leaving their rows `RESERVED`. On a long-lived process (`main.ts`) they
 * run. That is a property of the platform, not a bug in the queue, and it is
 * why `docs/17` names a persistent process as the deployment target.
 */

require('reflect-metadata');

let appPromise;

async function getExpressApp() {
  if (appPromise === undefined) {
    appPromise = (async () => {
      const { createApp } = require('../dist/create-app.js');

      const app = await createApp();

      // `init` rather than `listen`: the platform owns the socket. Nest still
      // has to run its lifecycle hooks, and `getHttpAdapter` returns nothing
      // usable until it has.
      await app.init();

      return app.getHttpAdapter().getInstance();
    })();

    // A failed bootstrap must not be cached, or one bad cold start poisons the
    // instance for its whole life and every later request fails identically
    // with a stale error.
    appPromise.catch(() => {
      appPromise = undefined;
    });
  }

  return appPromise;
}

module.exports = async function handler(request, response) {
  const express = await getExpressApp();

  return express(request, response);
};
