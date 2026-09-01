import { Test } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { PERMISSION_KEY, PUBLIC_KEY } from '../src/platform/authorization/index.js';

/**
 * The meta-test (roadmap task 1.4.5, docs/12 §5, docs/16 §5).
 *
 * It enumerates the Nest route table and fails if any route declares neither
 * `@Public()` nor `@RequirePermission()`. That is what protects against the
 * endpoint added under time pressure six months from now — a reviewer can
 * miss a missing decorator, and this cannot.
 *
 * It has already earned itself: the global `AuthGuard` was introduced without
 * marking the health probes public, so both returned `401` to Kubernetes. The
 * failure mode was the right one — undeclared means locked, not exposed — but
 * nothing told us until a probe timed out. Now something does.
 */
describe('every route declares its access', () => {
  let app: INestApplication;
  let reflector: Reflector;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    reflector = app.get(Reflector);
  }, 30_000);

  afterAll(async () => {
    await app?.close();
  });

  /**
   * Walks the container rather than the HTTP adapter's route table, because
   * the adapter exposes paths as strings and the decorators live on the
   * handler — the metadata is only reachable from the controller class.
   */
  function collectRoutes(): Array<{ label: string; isPublic: boolean; permission?: string }> {
    const routes: Array<{ label: string; isPublic: boolean; permission?: string }> = [];
    const container = (app as unknown as { container: NestContainer }).container;

    for (const module of container.getModules().values()) {
      for (const wrapper of module.controllers.values()) {
        const controller = wrapper.metatype;
        if (typeof controller !== 'function') continue;

        const prototype = controller.prototype as Record<string, unknown>;

        for (const property of Object.getOwnPropertyNames(prototype)) {
          if (property === 'constructor') continue;

          const handler = prototype[property];
          if (typeof handler !== 'function') continue;

          // `path` metadata is what Nest sets for a route handler; a plain
          // helper method on a controller has none and is skipped.
          const routePath: unknown = Reflect.getMetadata('path', handler);
          if (routePath === undefined) continue;

          const isPublic =
            reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [handler as never, controller]) ===
            true;
          const permission = reflector.getAllAndOverride<string>(PERMISSION_KEY, [
            handler as never,
            controller,
          ]);

          routes.push({
            label: `${controller.name}.${property}`,
            isPublic,
            ...(permission === undefined ? {} : { permission }),
          });
        }
      }
    }

    return routes;
  }

  it('finds routes at all — a green run over an empty list proves nothing', () => {
    expect(collectRoutes().length).toBeGreaterThan(0);
  });

  it('declares @Public() or @RequirePermission() on every route', () => {
    const undeclared = collectRoutes()
      .filter((route) => !route.isPublic && route.permission === undefined)
      .map((route) => route.label);

    /**
     * Session-scoped routes are the deliberate exception: `GET /auth/session`
     * and `POST /auth/logout` need a session but no *permission*, because they
     * act on the caller's own session rather than on organisation data. They
     * are listed by name so adding another one is a decision rather than an
     * oversight.
     */
    const sessionOnly = [
      'AuthController.session',
      'AuthController.logout',
      // Step-up cannot require a permission: it is how a caller proves
      // themselves again, and gating it behind one borrowed from elsewhere
      // would teach the next reader that permissions here are decorative.
      'AuthController.stepUp',
    ];
    const unexplained = undeclared.filter((label) => !sessionOnly.includes(label));

    expect(
      unexplained,
      `Routes with no access declaration: ${unexplained.join(', ')}. Add @Public() or @RequirePermission().`,
    ).toEqual([]);
  });

  it('marks only the routes that should be reachable without a session', () => {
    const publicRoutes = collectRoutes()
      .filter((route) => route.isPublic)
      .map((route) => route.label)
      .sort();

    // An exact list, not a subset check. Making a route public is the single
    // highest-consequence one-line change in this codebase, so it should
    // require editing this test and explaining why in the diff.
    expect(publicRoutes).toEqual([
      'AuthController.login',
      'AuthController.register',
      'HealthController.live',
      'HealthController.ready',
      // The invitation token *is* the authorisation: it determines which
      // organisation is being joined, so there is no session to scope by.
      // Both answer an identical 404 for a token that is unknown, spent,
      // revoked, or expired, because distinguishing those tells somebody
      // guessing at tokens which guesses were close.
      'InvitationAcceptanceController.accept',
      'InvitationAcceptanceController.preview',
    ]);
  });
});

/** Minimal shape of the Nest container this test reaches into. */
interface NestContainer {
  getModules(): Map<
    string,
    { controllers: Map<unknown, { metatype: (new (...args: never[]) => object) | undefined }> }
  >;
}
