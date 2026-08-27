import { beforeEach, describe, expect, it, vi } from 'vitest';

const { purgeExpiredIdempotencyKeys, logInfo, logError } = vi.hoisted(() => ({
  purgeExpiredIdempotencyKeys: vi.fn(),
  logInfo: vi.fn(),
  logError: vi.fn(),
}));

vi.mock('../../../src/nest/common/idempotency-cleanup', () => ({ purgeExpiredIdempotencyKeys }));
vi.mock('../../../src/nest/audit/audit-log.logger', () => ({ logInfo, logError }));

import { IdempotencyCleanupJob } from '../../../src/nest/common/idempotency-cleanup.job';

function makeRegistrar(enabled: boolean) {
  return {
    isEnabled: vi.fn(() => enabled),
    register: vi.fn(),
  };
}

describe('IdempotencyCleanupJob', () => {
  beforeEach(() => {
    purgeExpiredIdempotencyKeys.mockReset();
    logInfo.mockReset();
    logError.mockReset();
  });

  it('does not register the cron callback when scheduling is disabled', () => {
    const registrar = makeRegistrar(false);
    new IdempotencyCleanupJob({} as never, registrar as never).onApplicationBootstrap();
    expect(registrar.register).not.toHaveBeenCalled();
  });

  it('registers the callback and logs removed keys', () => {
    const registrar = makeRegistrar(true);
    purgeExpiredIdempotencyKeys.mockReturnValue(3);
    const job = new IdempotencyCleanupJob({} as never, registrar as never);
    job.onApplicationBootstrap();

    expect(registrar.register).toHaveBeenCalledWith('idempotency-cleanup', '0 3 * * *', expect.any(Function));
    const callback = registrar.register.mock.calls[0][2] as () => void;
    callback();
    expect(logInfo).toHaveBeenCalledWith('Idempotency cleanup: removed 3 expired key(s)');
  });

  it('stays quiet when nothing expired and logs both error shapes', () => {
    const job = new IdempotencyCleanupJob({} as never, makeRegistrar(true) as never);
    purgeExpiredIdempotencyKeys.mockReturnValue(0);
    job.tick();
    expect(logInfo).not.toHaveBeenCalled();

    purgeExpiredIdempotencyKeys.mockImplementationOnce(() => { throw new Error('db down'); });
    job.tick();
    expect(logError).toHaveBeenCalledWith('Idempotency cleanup: db down');

    purgeExpiredIdempotencyKeys.mockImplementationOnce(() => { throw 'db string'; });
    job.tick();
    expect(logError).toHaveBeenCalledWith('Idempotency cleanup: db string');
  });
});
