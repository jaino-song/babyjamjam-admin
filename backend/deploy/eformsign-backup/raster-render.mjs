import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { link, lstat, mkdtemp, open, readdir, realpath, rm } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';

const PIXELS_PER_POINT = 300 / 72;
const PIXEL_EPSILON = 1e-6;
const MAX_PAGE_PIXELS = 100_000_000;
const MAX_TOTAL_PIXELS = 2_000_000_000;
const MAX_PAGES = 500;
const MAX_PDF_BYTES = 512 * 1024 ** 2;
const MAX_JSON_BYTES = 32 * 1024 ** 2;
const MAX_DIAGNOSTIC_BYTES = 64 * 1024;
const MAX_SCRATCH_BYTES = 2 * MAX_PDF_BYTES + 6 * MAX_PAGE_PIXELS;
const TOOL_TIMEOUT_MS = 60_000;

class RasterError extends Error {
    constructor(code) {
        super(code);
        this.code = code;
    }
}

function requireRaster(condition, code) {
    if (!condition) throw new RasterError(code);
}

function runTool(bin, args, {
    scratch, failure, timeout = TOOL_TIMEOUT_MS, collect = false,
    stdoutLimit = MAX_DIAGNOSTIC_BYTES, overflow = 'RASTER_LIMIT', watchRender = false,
}) {
    return new Promise((done, reject) => {
        const child = spawn(bin.includes('/') ? resolve(bin) : bin, args, {
            cwd: scratch,
            env: { PATH: process.env.PATH, TMPDIR: scratch },
            detached: true,
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        const chunks = [];
        let stdoutBytes = 0;
        let stderrBytes = 0;
        let stopping;
        let closed = false;
        let inspecting = false;

        function stop(code) {
            if (stopping || closed) return;
            stopping = code;
            if (!child.pid) return;
            try {
                process.kill(-child.pid, 'SIGKILL');
            } catch (error) {
                if (error.code !== 'ESRCH') child.kill('SIGKILL');
            }
        }

        const timer = setTimeout(() => stop('RASTER_TIMEOUT'), timeout);
        const watcher = watchRender ? setInterval(async () => {
            if (inspecting || stopping) return;
            inspecting = true;
            try {
                let scratchBytes = 0;
                for (const name of await readdir(scratch)) {
                    const entry = await lstat(join(scratch, name)).catch((error) => {
                        if (error.code !== 'ENOENT') throw error;
                    });
                    if (!entry) continue; // Ghostscript may remove a spill file between calls.
                    scratchBytes += entry.size;
                    if (scratchBytes > MAX_SCRATCH_BYTES ||
                        (name === 'rendered.pdf' && entry.size > MAX_PDF_BYTES)) {
                        stop('RASTER_LIMIT');
                        break;
                    }
                }
            } catch {
                stop('RASTER_IO_ERROR');
            } finally {
                inspecting = false;
            }
        }, 25) : undefined;

        child.stdout.on('data', (chunk) => {
            stdoutBytes += chunk.length;
            if (stdoutBytes > stdoutLimit) stop(overflow);
            else if (collect && !stopping) chunks.push(chunk);
        });
        child.stderr.on('data', (chunk) => {
            stderrBytes += chunk.length;
            if (stderrBytes > MAX_DIAGNOSTIC_BYTES) stop('RASTER_LIMIT');
        });
        child.once('error', () => stop(failure));
        child.once('close', (code) => {
            closed = true;
            clearTimeout(timer);
            clearInterval(watcher);
            if (stopping || code !== 0) reject(new RasterError(stopping ?? failure));
            else done({ stdout: collect ? Buffer.concat(chunks, stdoutBytes) : undefined, stdoutBytes });
        });
    });
}

async function copyPdf(sourcePath, targetPath, invalid) {
    const source = await open(sourcePath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
        .catch(() => { throw new RasterError(invalid); });
    try {
        const before = await source.stat();
        requireRaster(before.isFile() && before.size > 0, invalid);
        requireRaster(before.size <= MAX_PDF_BYTES, 'RASTER_LIMIT');

        const target = await open(targetPath, 'wx', 0o600);
        try {
            // A concurrent append cannot extend this copy beyond the size checked above.
            const buffer = Buffer.allocUnsafe(Math.min(1024 ** 2, before.size));
            let offset = 0;
            while (offset < before.size) {
                const { bytesRead } = await source.read(buffer, 0, Math.min(buffer.length, before.size - offset), offset);
                requireRaster(bytesRead > 0, invalid);
                await target.writeFile(buffer.subarray(0, bytesRead));
                offset += bytesRead;
            }
            const after = await source.stat();
            const copied = await target.stat();
            requireRaster(copied.size === before.size && after.size === before.size &&
                before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs, invalid);
        } finally {
            await target.close();
        }
    } finally {
        await source.close();
    }
}

async function checkPdfEnvelope(path, failure) {
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
        const { size } = await file.stat();
        const header = Buffer.alloc(5);
        const trailer = Buffer.alloc(Math.min(size, 1024));
        const { bytesRead: headerBytes } = await file.read(header, 0, header.length, 0);
        const { bytesRead: trailerBytes } = await file.read(trailer, 0, trailer.length, size - trailer.length);
        requireRaster(headerBytes === header.length && trailerBytes === trailer.length && header.toString() === '%PDF-' &&
            /(?:^|[\r\n])%%EOF[\x00\t\n\f\r ]*$/.test(trailer.toString('latin1')), failure);
    } finally {
        await file.close();
    }
}

async function inspectPdf(bin, path, scratch, failure) {
    const { stdout } = await runTool(bin, [
        '--suppress-recovery', '--json=2', '--json-key=pages', '--json-key=qpdf',
        '--json-stream-data=none', path,
    ], { scratch, failure, collect: true, stdoutLimit: MAX_JSON_BYTES });
    try {
        const result = JSON.parse(stdout);
        requireRaster(result.version === 2 && Array.isArray(result.pages) && isDictionary(result.qpdf?.[1]), failure);
        return { pages: result.pages, objects: result.qpdf[1] };
    } catch {
        throw new RasterError(failure);
    }
}

function isReference(value) {
    return typeof value === 'string' && /^\d+ \d+ R$/.test(value);
}

function sourcePixelSizes({ pages, objects }) {
    const invalid = 'RASTER_INVALID_SOURCE';
    requireRaster(pages.length > 0, invalid);
    requireRaster(pages.length <= MAX_PAGES, 'RASTER_LIMIT');

    function dereference(value) {
        const seen = new Set();
        while (isReference(value)) {
            requireRaster(!seen.has(value), invalid);
            seen.add(value);
            const object = objects[`obj:${value}`];
            requireRaster(object && Object.hasOwn(object, 'value'), invalid);
            value = object.value;
        }
        return value;
    }

    function box(value) {
        const coordinates = dereference(value);
        requireRaster(Array.isArray(coordinates) && coordinates.length === 4, invalid);
        const [x1, y1, x2, y2] = coordinates.map(dereference);
        requireRaster([x1, y1, x2, y2].every(Number.isFinite), invalid);
        return [Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)];
    }

    let total = 0;
    return pages.map(({ object }) => {
        const page = dereference(object);
        requireRaster(page?.['/Type'] === '/Page', invalid);
        let media = page['/MediaBox'];
        let crop = page['/CropBox'];
        let rotate = page['/Rotate'];
        const seen = new Set();
        let parent = page['/Parent'];
        while (parent != null) {
            requireRaster(isReference(parent) && !seen.has(parent), invalid);
            seen.add(parent);
            const node = dereference(parent);
            requireRaster(node?.['/Type'] === '/Pages', invalid);
            media ??= node['/MediaBox'];
            crop ??= node['/CropBox'];
            rotate ??= node['/Rotate'];
            parent = node['/Parent'];
        }

        const [mx1, my1, mx2, my2] = box(media);
        const [cx1, cy1, cx2, cy2] = crop == null ? [mx1, my1, mx2, my2] : box(crop);
        const unit = dereference(page['/UserUnit']) ?? 1;
        const rotation = dereference(rotate) ?? 0;
        requireRaster(Number.isFinite(unit) && unit > 0 &&
            Number.isSafeInteger(rotation) && rotation % 90 === 0, invalid);

        const scale = unit * PIXELS_PER_POINT;
        let width = (Math.min(mx2, cx2) - Math.max(mx1, cx1)) * scale;
        let height = (Math.min(my2, cy2) - Math.max(my1, cy1)) * scale;
        requireRaster(width > 0 && height > 0, invalid);
        if (rotation % 180 !== 0) [width, height] = [height, width];

        // Reserve the larger rounding choice whenever it is within the allowed tolerance.
        const roundedWidth = Math.floor(width + 0.5 + PIXEL_EPSILON);
        const roundedHeight = Math.floor(height + 0.5 + PIXEL_EPSILON);
        const pixels = roundedWidth * roundedHeight;
        total += pixels;
        requireRaster(roundedWidth > 0 && roundedHeight > 0 && pixels <= MAX_PAGE_PIXELS &&
            total <= MAX_TOTAL_PIXELS, 'RASTER_LIMIT');
        return { width, height };
    });
}

function isDictionary(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOnlyKeys(value, allowed) {
    return isDictionary(value) && Object.keys(value).every((key) => allowed.includes(key));
}

async function verifyOutput(bin, path, scratch, sizes) {
    const failure = 'RASTER_INVALID_OUTPUT';
    const { pages, objects } = await inspectPdf(bin, path, scratch, failure);
    requireRaster(pages.length === sizes.length, failure);
    const used = new Set();

    function take(ref) {
        requireRaster(isReference(ref) && !used.has(ref), failure);
        used.add(ref);
        const object = objects[`obj:${ref}`];
        requireRaster(object, failure);
        return object;
    }

    function stream(ref, keys) {
        const dictionary = take(ref).stream?.dict;
        requireRaster(hasOnlyKeys(dictionary, ['/Length', '/Filter', ...keys]) &&
            dictionary['/Filter'] === '/FlateDecode', failure);
        const length = dictionary['/Length'];
        const bytes = isReference(length) ? take(length).value : length;
        requireRaster(Number.isSafeInteger(bytes) && bytes > 0 && bytes <= MAX_PDF_BYTES, failure);
        return dictionary;
    }

    function showStream(ref, options) {
        const [number, generation] = ref.split(' ');
        return runTool(bin, [
            '--suppress-recovery', `--show-object=${number},${generation}`, '--filtered-stream-data', path,
        ], { scratch, failure, overflow: failure, ...options });
    }

    // Allow only the objects and dictionaries emitted by the flat pdfimage24 document.
    const trailer = objects.trailer?.value;
    requireRaster(hasOnlyKeys(trailer, ['/Root', '/Size', '/ID', '/Info']), failure);
    if (trailer['/ID'] != null) {
        requireRaster(Array.isArray(trailer['/ID']) && trailer['/ID'].length === 2 &&
            trailer['/ID'].every((id) => typeof id === 'string' && /^b:[\da-f]{32}$/.test(id)), failure);
    }
    const catalog = take(trailer['/Root']).value;
    requireRaster(hasOnlyKeys(catalog, ['/Type', '/Pages', '/Info']) && catalog['/Type'] === '/Catalog', failure);
    const infoRef = catalog['/Info'] ?? trailer['/Info'];
    if (infoRef != null) {
        requireRaster(trailer['/Info'] == null || trailer['/Info'] === infoRef, failure);
        const info = take(infoRef).value;
        requireRaster(hasOnlyKeys(info, ['/CreationDate', '/Producer']) &&
            typeof info['/Producer'] === 'string' && /^u:GPL Ghostscript \d+\.\d+\.\d+$/.test(info['/Producer']) &&
            typeof info['/CreationDate'] === 'string' && /^u:D:[0-9+'Z-]+$/.test(info['/CreationDate']), failure);
    }

    const treeRef = catalog['/Pages'];
    const tree = take(treeRef).value;
    requireRaster(hasOnlyKeys(tree, ['/Type', '/Count', '/Kids']) && tree['/Type'] === '/Pages' &&
        Array.isArray(tree['/Kids']) && tree['/Kids'].length === sizes.length && tree['/Count'] === sizes.length, failure);

    for (const [index, { object }] of pages.entries()) {
        requireRaster(tree['/Kids'][index] === object, failure);
        const page = take(object).value;
        requireRaster(hasOnlyKeys(page, ['/Type', '/Parent', '/Resources', '/MediaBox', '/Contents']) &&
            page['/Type'] === '/Page' && page['/Parent'] === treeRef, failure);

        const resources = page['/Resources'];
        requireRaster(hasOnlyKeys(resources, ['/XObject']) && isDictionary(resources['/XObject']), failure);
        const images = Object.entries(resources['/XObject']);
        requireRaster(images.length === 1, failure);
        const [[name, imageRef]] = images;
        requireRaster(/^\/Im\d+$/.test(name), failure);

        const image = stream(imageRef, ['/Type', '/Subtype', '/ColorSpace', '/BitsPerComponent', '/Width', '/Height']);
        const width = image['/Width'];
        const height = image['/Height'];
        requireRaster((image['/Type'] == null || image['/Type'] === '/XObject') &&
            image['/Subtype'] === '/Image' && image['/ColorSpace'] === '/DeviceRGB' &&
            image['/BitsPerComponent'] === 8 && Number.isSafeInteger(width) && width > 0 &&
            Number.isSafeInteger(height) && height > 0 &&
            Math.abs(width - sizes[index].width) <= 0.5 + PIXEL_EPSILON &&
            Math.abs(height - sizes[index].height) <= 0.5 + PIXEL_EPSILON, failure);

        const media = page['/MediaBox'];
        requireRaster(Array.isArray(media) && media.length === 4 && media.every(Number.isFinite) &&
            media[0] === 0 && media[1] === 0 &&
            Math.abs(media[2] * PIXELS_PER_POINT - width) <= PIXEL_EPSILON &&
            Math.abs(media[3] * PIXELS_PER_POINT - height) <= PIXEL_EPSILON, failure);

        const contents = page['/Contents'];
        stream(contents, []);
        const { stdout } = await showStream(contents, { collect: true, stdoutLimit: 256 });
        const matrix = /^\s*(\d+(?:\.\d+)?)\s+0\s+0\s+(\d+(?:\.\d+)?)\s+0\s+0\s+cm\s+(\/Im\d+)\s+Do\s*$/
            .exec(stdout.toString('latin1'));
        requireRaster(matrix && matrix[3] === name && Number(matrix[1]) === media[2] &&
            Number(matrix[2]) === media[3], failure);

        const expectedBytes = width * height * 3;
        const { stdoutBytes } = await showStream(imageRef, { stdoutLimit: expectedBytes });
        requireRaster(stdoutBytes === expectedBytes, failure);
    }

    requireRaster(used.size === Object.keys(objects).length - 1, failure);
}

async function assertOutputAbsent(path) {
    try {
        await lstat(path);
    } catch (error) {
        if (error.code === 'ENOENT') return;
        throw error;
    }
    throw new RasterError('RASTER_OUTPUT_EXISTS');
}

async function publishExclusive(staging, outputPath) {
    try {
        await link(staging, outputPath);
    } catch (error) {
        if (error.code === 'EEXIST') throw new RasterError('RASTER_OUTPUT_EXISTS');
        throw error;
    }
}

export async function renderRasterPdf(options) {
    let scratch;
    let destinationScratch;
    try {
        const { sourcePath, outputPath, gsBin = 'gs', qpdfBin = 'qpdf' } = options ?? {};
        requireRaster([sourcePath, outputPath].every((path) => typeof path === 'string' &&
            isAbsolute(path) && !path.includes('\0')) &&
            [gsBin, qpdfBin].every((bin) => typeof bin === 'string' && bin && !bin.includes('\0')),
            'RASTER_INVALID_ARGUMENT');
        await assertOutputAbsent(outputPath);
        const outputDirectory = await realpath(dirname(outputPath));

        scratch = await mkdtemp('/tmp/bjj-raster-');
        const source = join(scratch, 'source.pdf');
        const rendered = join(scratch, 'rendered.pdf');
        await copyPdf(sourcePath, source, 'RASTER_INVALID_SOURCE');
        await checkPdfEnvelope(source, 'RASTER_INVALID_SOURCE');
        const sizes = sourcePixelSizes(await inspectPdf(qpdfBin, source, scratch, 'RASTER_INVALID_SOURCE'));
        await runTool(qpdfBin, ['--suppress-recovery', '--check', source], {
            scratch, failure: 'RASTER_INVALID_SOURCE',
        });
        await runTool(gsBin, [
            '-q', '-dSAFER', '-dBATCH', '-dNOPAUSE', '-dPDFSTOPONERROR', '-dUseCropBox',
            '-dPrinted=false', '-dShowAnnots=true', '-sDEVICE=pdfimage24', '-sCompression=Flate',
            '-r300', `-sOutputFile=${rendered}`, '-f', source,
        ], {
            scratch, failure: 'RASTER_RENDER_FAILED', watchRender: true,
            timeout: Math.min(600_000, 30_000 + 5_000 * sizes.length),
        });

        const result = await lstat(rendered).catch(() => { throw new RasterError('RASTER_INVALID_OUTPUT'); });
        requireRaster(result.isFile() && result.nlink === 1 && result.size > 0, 'RASTER_INVALID_OUTPUT');
        requireRaster(result.size <= MAX_PDF_BYTES, 'RASTER_LIMIT');
        await checkPdfEnvelope(rendered, 'RASTER_INVALID_OUTPUT');
        await verifyOutput(qpdfBin, rendered, scratch, sizes);

        // Build the final inode on the destination's filesystem. Only the parent
        // links it into the requested name, after validation and private copying.
        destinationScratch = await mkdtemp(join(outputDirectory, '.bjj-raster-'));
        const staging = join(destinationScratch, 'rendered.pdf');
        await copyPdf(rendered, staging, 'RASTER_INVALID_OUTPUT');
        await rm(scratch, { recursive: true, force: true });
        scratch = undefined;
        await publishExclusive(staging, outputPath);
    } catch (error) {
        throw error instanceof RasterError ? error : new RasterError('RASTER_IO_ERROR');
    } finally {
        // A cleanup error after a successful link cannot undo the publication.
        await Promise.allSettled([scratch, destinationScratch].filter(Boolean)
            .map((path) => rm(path, { recursive: true, force: true, maxRetries: 3 })));
    }
}
