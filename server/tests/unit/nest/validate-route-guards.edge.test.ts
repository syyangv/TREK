import { describe, expect, it } from 'vitest';
import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../src/nest/auth/jwt-auth.guard';
import { OptionalAuth, Public } from '../../../src/nest/auth/public.decorator';
import { collectRouteGuards } from '../../../src/nest/common/validate-route-guards';

class DeclaredGuard {}

@Controller('route-inventory-edge')
class EdgeController {
  @Get('plain')
  plainRoute() {
    return {};
  }

  @Public('public edge route')
  @Get('public')
  publicRoute() {
    return {};
  }

  @OptionalAuth('optional edge route')
  @Get('optional')
  optionalRoute() {
    return {};
  }

  @UseGuards(JwtAuthGuard)
  @Get('authenticated')
  authenticatedRoute() {
    return {};
  }

  @UseGuards(DeclaredGuard)
  @Get('anonymous')
  anonymousRoute() {
    return {};
  }

  helper() {
    return null;
  }
}

Object.defineProperty(EdgeController.prototype, 'helperValue', { value: 1 });

@UseGuards(DeclaredGuard)
@Controller('route-inventory-class-guard')
class ClassGuardController {
  @Get()
  route() {
    return {};
  }
}

function fakeApp(metatypes: unknown[]) {
  return {
    get: () => new Map([[
      {},
      { controllers: new Map(metatypes.map((metatype, index) => [index, { metatype }])) },
    ]]),
  };
}

describe('collectRouteGuards edge cases', () => {
  it('classifies public, optional, authenticating, and anonymous declarations', () => {
    const entries = collectRouteGuards(fakeApp([EdgeController]) as never);
    expect(entries).toEqual([
      { id: 'EdgeController.anonymousRoute', cover: 'declared-guards-anonymous' },
      { id: 'EdgeController.authenticatedRoute', cover: 'declared-guards' },
      { id: 'EdgeController.optionalRoute', cover: 'optional-auth' },
      { id: 'EdgeController.publicRoute', cover: 'public' },
    ]);
  });

  it('ignores malformed controller wrappers', () => {
    expect(collectRouteGuards(fakeApp([undefined, EdgeController]) as never)).toHaveLength(4);
  });

  it('recognizes guards declared on the controller class', () => {
    expect(collectRouteGuards(fakeApp([ClassGuardController]) as never)).toEqual([
      { id: 'ClassGuardController.route', cover: 'declared-guards-anonymous' },
    ]);
  });
});
