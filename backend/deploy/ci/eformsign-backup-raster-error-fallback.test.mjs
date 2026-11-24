import assert from 'node:assert/strict';
import test from 'node:test';
import { MirrorError } from '../eformsign-backup/raster-mirror-io.mjs';
import { describeRasterArchiveError } from '../eformsign-backup/raster-mirror.mjs';

test('raster error description masks unlisted branded reasons despite public-looking fields', () => {
    const descriptor = {
        code: 'raster_archive_documents_failed',
        message: 'synthetic private diagnostic',
        report: { failedCount: 1, path: 'synthetic-private.pdf' },
    };
    const error = Object.assign(new MirrorError('fixture_unlisted_reason'), descriptor);

    assert.deepEqual(describeRasterArchiveError(error), { code: 'raster_archive_guard_failed' });
    assert.equal(describeRasterArchiveError(descriptor), null);
});
