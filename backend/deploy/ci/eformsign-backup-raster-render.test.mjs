import assert from 'node:assert/strict';
import { execFile, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { link, lstat, mkdir, mkdtemp, open, readFile, readdir, rename, rm, stat, symlink, truncate, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { deflateSync } from 'node:zlib';
import { renderRasterPdf } from '../eformsign-backup/raster-render.mjs';

const exec = promisify(execFile);
const realSetTimeout = setTimeout;
const gsHelp = spawnSync('gs', ['-h'], { encoding: 'utf8' });
const qpdfVersion = spawnSync('qpdf', ['--version']);
const skip = gsHelp.status !== 0 || !/\bpdfimage24\b/.test(gsHelp.stdout) || qpdfVersion.status !== 0
    ? 'requires Ghostscript with pdfimage24 and qpdf' : false;

function rasterTest(name, fn) {
    return test(name, { skip }, fn);
}

function serializePdf(objects, info, trailerEntries = '') {
    const parts = [Buffer.from('%PDF-1.7\n')];
    const offsets = ['0000000000 65535 f \n'];
    let offset = parts[0].length;
    for (const [index, object] of objects.entries()) {
        offsets.push(`${String(offset).padStart(10, '0')} 00000 n \n`);
        const entry = [Buffer.from(`${index + 1} 0 obj\n`), Buffer.from(object), Buffer.from('\nendobj\n')];
        offset += entry.reduce((length, part) => length + part.length, 0);
        parts.push(...entry);
    }
    const trailer = `<< /Size ${offsets.length} /Root 1 0 R${info ? ` /Info ${info}` : ''} ${trailerEntries} >>`;
    parts.push(Buffer.from(`xref\n0 ${offsets.length}\n${offsets.join('')}trailer\n${trailer}\nstartxref\n${offset}\n%%EOF\n`));
    return Buffer.concat(parts);
}

function pdfObjects() {
    const objects = [];
    return {
        add(object = '') {
            objects.push(object);
            return `${objects.length} 0 R`;
        },
        set(ref, object) {
            objects[Number.parseInt(ref, 10) - 1] = object;
        },
        output(info, trailerEntries) {
            return serializePdf(objects, info, trailerEntries);
        },
    };
}

function pdfStream(dictionary, data) {
    const bytes = Buffer.from(data);
    return Buffer.concat([
        Buffer.from(`<< /Length ${bytes.length} ${dictionary} >>\nstream\n`), bytes, Buffer.from('\nendstream'),
    ]);
}

function simpleSource(boxes, paint = '1 0 0') {
    const pdf = pdfObjects();
    const catalog = pdf.add();
    const tree = pdf.add();
    const vector = pdf.add(pdfStream('', `${paint} rg 0 0 12 24 re f`));
    const kids = boxes.map((box) => pdf.add(
        `<< /Type /Page /Parent ${tree} /MediaBox [${box}] /Resources << >> /Contents ${vector} >>`,
    ));
    pdf.set(catalog, `<< /Type /Catalog /Pages ${tree} >>`);
    pdf.set(tree, `<< /Type /Pages /Count ${kids.length} /Kids [${kids.join(' ')}] >>`);
    return pdf.output();
}

function fidelitySource() {
    const pdf = pdfObjects();
    const catalog = pdf.add();
    const tree = pdf.add();
    const branch = pdf.add();
    const pages = Array.from({ length: 5 }, () => pdf.add());
    const [quarterTurn, oppositeTurn, landscape, portrait, blank] = pages;
    const widget = pdf.add();
    const ink = pdf.add();
    const hidden = pdf.add();
    const forms = pdf.add(`<< /Fields [${widget}] /NeedAppearances false >>`);
    const attachment = pdf.add(pdfStream('/Type /EmbeddedFile', 'synthetic attachment'));
    const fileSpec = pdf.add(`<< /Type /Filespec /F (example.txt) /EF << /F ${attachment} >> >>`);
    const info = pdf.add('<< /Title (Synthetic original title) /Author (Synthetic original author) >>');

    // The simple Type 3 font draws 한글 and maps both glyphs to their actual Unicode text.
    const han = pdf.add(pdfStream('', '20 0 0 0 18 20 d1 1 15 8 2 re 3 11 4 2 re 12 6 2 13 re 14 12 4 2 re 3 2 12 2 re f'));
    const geul = pdf.add(pdfStream('', '20 0 0 0 18 20 d1 2 18 13 2 re 13 12 2 8 re 1 9 17 2 re 2 5 12 2 re 2 1 14 2 re f'));
    const toUnicode = pdf.add(pdfStream('', [
        '/CIDInit /ProcSet findresource begin', '12 dict begin', 'begincmap',
        '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def',
        '/CMapName /SyntheticHangul def', '/CMapType 2 def',
        '1 begincodespacerange <00> <FF> endcodespacerange',
        '2 beginbfchar <41> <D55C> <42> <AE00> endbfchar',
        'endcmap CMapName currentdict /CMap defineresource pop end end',
    ].join('\n')));
    const font = pdf.add(
        `<< /Type /Font /Subtype /Type3 /FontBBox [0 0 18 20] /FontMatrix [.05 0 0 .05 0 0]
        /CharProcs << /Han ${han} /Geul ${geul} >> /Encoding << /Differences [65 /Han /Geul] >>
        /FirstChar 65 /LastChar 66 /Widths [20 20] /Resources << >> /ToUnicode ${toUnicode} >>`,
    );
    const widgetAppearance = pdf.add(pdfStream(
        '/Type /XObject /Subtype /Form /BBox [0 0 36 16] /Resources << >>',
        '0 1 0 rg 0 0 36 16 re f 0 0 0 rg 2 3 3 7 re f',
    ));
    const inkAppearance = pdf.add(pdfStream(
        '/Type /XObject /Subtype /Form /BBox [0 0 48 22] /Resources << >>',
        '0 0 1 RG 4 w 4 5 m 15 18 l 27 7 l 44 14 l S',
    ));
    const hiddenAppearance = pdf.add(pdfStream(
        '/Type /XObject /Subtype /Form /BBox [0 0 25 20] /Resources << >>',
        '1 0 1 rg 0 0 25 20 re f',
    ));

    pdf.set(catalog, `<< /Type /Catalog /Pages ${tree} /AcroForm ${forms}
        /OpenAction << /S /Named /N /NextPage >>
        /Names << /EmbeddedFiles << /Names [(example.txt) ${fileSpec}] >> >> >>`);
    pdf.set(tree, `<< /Type /Pages /Count 5 /Kids [${branch} ${pages.slice(1).join(' ')}]
        /MediaBox [0 0 200 150] /CropBox [20 10 164 106] /Rotate 90 /Resources << >> >>`);
    pdf.set(branch, `<< /Type /Pages /Parent ${tree} /Count 1 /Kids [${quarterTurn}] >>`);

    const firstMarks = pdf.add(pdfStream('', [
        '1 0 0 rg 24 14 8 8 re f', '0 1 0 rg 151 18 8 8 re f', '0 0 1 rg 28 92 8 8 re f',
        '1 0 1 rg 3 3 12 6 re f', // Outside the inherited CropBox.
    ].join('\n')));
    pdf.set(quarterTurn, `<< /Type /Page /Parent ${branch} /UserUnit 1.25 /Contents ${firstMarks} >>`);

    const secondMarks = pdf.add(pdfStream('', [
        '0 1 1 rg 11 31 8 8 re f', '1 1 0 rg 100 36 8 8 re f', '1 0 0 rg 11 159 8 8 re f',
    ].join('\n')));
    pdf.set(oppositeTurn, `<< /Type /Page /Parent ${tree} /MediaBox [5 10 115 175]
        /CropBox [-5 25 135 195] /Rotate -90 /Contents ${secondMarks} >>`);

    const landscapeMarks = pdf.add(pdfStream('', [
        '1 0 0 rg 5 78 10 10 re f', '0 1 1 rg 590 8 12 12 re f',
        '0 0 0 rg BT /Hangul 20 Tf 100 52 Td (AB) Tj ET',
    ].join('\n')));
    pdf.set(landscape, `<< /Type /Page /Parent ${tree} /MediaBox [0 0 612.12 96] /CropBox [0 0 612.12 96]
        /Rotate 0 /Resources << /Font << /Hangul ${font} >> >> /Contents ${landscapeMarks}
        /Annots [${widget} ${ink} ${hidden}] >>`);
    pdf.set(widget, `<< /Type /Annot /Subtype /Widget /FT /Tx /T (Synthetic widget) /V (Green)
        /Rect [150 12 186 28] /P ${landscape} /F 0 /AP << /N ${widgetAppearance} >> >>`);
    pdf.set(ink, `<< /Type /Annot /Subtype /Ink /Rect [210 12 258 34] /P ${landscape} /F 0
        /InkList [[214 17 225 30 237 19 254 26]] /C [0 0 1] /AP << /N ${inkAppearance} >> >>`);
    pdf.set(hidden, `<< /Type /Annot /Subtype /Square /Rect [290 12 315 32] /P ${landscape} /F 2
        /AP << /N ${hiddenAppearance} >> >>`);

    const portraitMarks = pdf.add(pdfStream('', [
        '1 0 1 rg 6 11 10 10 re f', '0 0 1 rg 568 22 10 10 re f', '0 1 0 rg 7 813 10 10 re f',
    ].join('\n')));
    pdf.set(portrait, `<< /Type /Page /Parent ${tree} /MediaBox [0 0 595.28 841.89] /CropBox [0 0 595.28 841.89]
        /Rotate 180 /Contents ${portraitMarks} >>`);
    pdf.set(blank, `<< /Type /Page /Parent ${tree} >>`);
    return pdf.output(info);
}

async function temp(t) {
    const dir = await mkdtemp('/tmp/bjj-raster-test-');
    t.after(() => rm(dir, { force: true, recursive: true }));
    return dir;
}

async function shim(dir, name, body) {
    const path = join(dir, name);
    await writeFile(path, `#!/usr/bin/env node\n${body}\n`, { mode: 0o700 });
    return path;
}

async function recordingTool(dir, name, log, body) {
    return shim(dir, name, `
        import assert from 'node:assert/strict';
        import { appendFileSync, statSync, writeFileSync, truncateSync } from 'node:fs';
        import { spawnSync } from 'node:child_process';
        import { join } from 'node:path';
        const args = process.argv.slice(2);
        const scratch = process.env.TMPDIR;
        assert.match(scratch, /^\\/tmp\\/bjj-raster-[a-zA-Z0-9]+$/);
        assert.equal(process.cwd(), scratch);
        assert.equal(statSync(scratch).mode & 0o777, 0o700);
        assert.equal(process.env.GS_OPTIONS, undefined);
        const source = join(scratch, 'source.pdf');
        const rendered = join(scratch, 'rendered.pdf');
        const normalized = join(scratch, 'normalized.pdf');
        const patch = join(scratch, 'patch.json');
        const update = '--update-from-json=' + patch;
        const documentArgs = args.filter((arg) => arg.startsWith('/') || arg.startsWith('-sOutputFile='));
        if (${JSON.stringify(name)} === 'record-qpdf') {
            assert.equal(args[0], '--suppress-recovery');
            if (args.includes(update)) {
                assert.deepEqual(args, ['--suppress-recovery', update, rendered, normalized]);
                assert.equal(statSync(patch).mode & 0o777, 0o600);
            } else {
                const document = args.at(-1);
                assert.deepEqual(documentArgs, [document]);
                assert.ok([source, rendered, normalized].includes(document));
                if (args[1] === '--check') {
                    assert.deepEqual(args, ['--suppress-recovery', '--check', source]);
                } else if (args[1] === '--json=2') {
                    assert.deepEqual(args, ['--suppress-recovery', '--json=2', '--json-key=pages',
                        '--json-key=qpdf', '--json-stream-data=none', document]);
                } else {
                    assert.match(args[1], /^--show-object=\\d+,\\d+$/);
                    assert.deepEqual(args, ['--suppress-recovery', args[1], '--filtered-stream-data', document]);
                    assert.notEqual(document, source);
                }
            }
        } else {
            assert.deepEqual(documentArgs, ['-sOutputFile=' + rendered, source]);
            assert.deepEqual(args, [
                '-q', '-dSAFER', '-dBATCH', '-dNOPAUSE', '-dPDFSTOPONERROR', '-dUseCropBox',
                '-dPrinted=false', '-dShowAnnots=true', '-sDEVICE=pdfimage24', '-sCompression=Flate',
                '-r300', '-sOutputFile=' + rendered, '-f', source,
            ]);
        }
        if (args.includes(source)) assert.equal(statSync(source).mode & 0o777, 0o600);
        appendFileSync(${JSON.stringify(log)}, JSON.stringify({ scratch, pid: process.pid, args }) + '\\n');
        ${body}
    `);
}

async function toolLog(path) {
    return (await readFile(path, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
}

async function assertClean(dir, log, expectedFiles) {
    for (const { scratch } of await toolLog(log)) {
        await assert.rejects(lstat(scratch), { code: 'ENOENT' });
    }
    assert.deepEqual((await readdir(dir)).sort(), [...expectedFiles].sort());
}

async function pdfJson(path) {
    const { stdout } = await exec('qpdf', ['--json=2', '--json-stream-data=none', path], {
        maxBuffer: 32 * 1024 ** 2,
    });
    return JSON.parse(stdout);
}

async function readImage(path, image) {
    const [object, generation] = image.object.split(' ');
    const { stdout } = await exec('qpdf', [
        `--show-object=${object},${generation}`, '--filtered-stream-data', path,
    ], { encoding: 'buffer', maxBuffer: 32 * 1024 ** 2 });
    assert.equal(stdout.length, 3 * image.width * image.height);
    return stdout;
}

async function readPpm(path) {
    const data = await readFile(path);
    const header = /^P6\n(?:#[^\n]*\n)*(\d+)\s+(\d+)\s+255\n/.exec(data.subarray(0, 512).toString('latin1'));
    assert.ok(header, 'expected raw RGB PPM');
    const [, width, height] = header;
    return { width: Number(width), height: Number(height), pixels: data.subarray(header[0].length) };
}

function checkPixel(pixels, width, x, y, color, description) {
    const offset = 3 * (y * width + x);
    assert.deepEqual([...pixels.subarray(offset, offset + 3)], color, description);
}

const red = [255, 0, 0];
const green = [0, 255, 0];
const blue = [0, 0, 255];
const cyan = [0, 255, 255];
const yellow = [255, 255, 0];
const magenta = [255, 0, 255];
const white = [255, 255, 255];
const black = [0, 0, 0];

rasterTest('real tools preserve visible 300-DPI pixels through private ASCII-only paths', async (t) => {
    const dir = await temp(t);
    const caller = join(dir, '.비공개 % 아카이브');
    await mkdir(caller, { mode: 0o700 });
    const sourcePath = join(caller, '서명 % 원본.tmp');
    const outputPath = join(caller, '계약 % 결과.tmp');
    const reference = join(dir, 'reference.pdf');
    const output = join(dir, 'results.pdf');
    const gsLog = join(dir, 'gs.log');
    const qpdfLog = join(dir, 'qpdf.log');
    const source = fidelitySource();
    await writeFile(sourcePath, source);
    await writeFile(reference, source);
    const original = await stat(sourcePath);
    const gsBin = await recordingTool(dir, 'record-gs', gsLog, "process.exit(spawnSync('gs', args, { stdio: 'inherit' }).status ?? 1)");
    const qpdfBin = await recordingTool(dir, 'record-qpdf', qpdfLog, "process.exit(spawnSync('qpdf', args, { stdio: 'inherit' }).status ?? 1)");

    const savedTmp = process.env.TMPDIR;
    const savedOptions = process.env.GS_OPTIONS;
    process.env.TMPDIR = join(dir, 'missing temp parent');
    process.env.GS_OPTIONS = '-g3x3';
    try {
        assert.equal(await renderRasterPdf({ sourcePath, outputPath, gsBin, qpdfBin }), undefined);
    } finally {
        if (savedTmp === undefined) delete process.env.TMPDIR;
        else process.env.TMPDIR = savedTmp;
        if (savedOptions === undefined) delete process.env.GS_OPTIONS;
        else process.env.GS_OPTIONS = savedOptions;
    }

    const hash = (data) => createHash('sha256').update(data).digest('hex');
    assert.equal(hash(await readFile(sourcePath)), hash(source));
    assert.equal((await stat(sourcePath)).mtimeMs, original.mtimeMs);
    assert.equal((await stat(outputPath)).mode & 0o777, 0o600);
    assert.deepEqual((await readdir(caller)).sort(), ['계약 % 결과.tmp', '서명 % 원본.tmp'].sort());
    for (const { scratch } of [...await toolLog(gsLog), ...await toolLog(qpdfLog)]) {
        await assert.rejects(lstat(scratch), { code: 'ENOENT' });
    }

    await writeFile(output, await readFile(outputPath));
    const { stdout: validation } = await exec('qpdf', ['--check', output]);
    assert.match(validation, /No syntax or stream encoding errors found/);
    const { pages, qpdf, acroform, attachments, encrypt } = await pdfJson(output);
    assert.equal(pages.length, 5);
    assert.equal(acroform.hasacroform, false);
    assert.deepEqual(attachments, {});
    assert.equal(encrypt.encrypted, false);
    assert.doesNotMatch(JSON.stringify(qpdf[1]), /"\/(?:Font|Annots|AcroForm|EmbeddedFiles|OpenAction|Widget|Sig|Metadata|Names|AA|JS|Title|Author)"/);
    const originalPdf = await pdfJson(reference);
    assert.equal(originalPdf.acroform.hasacroform, true);
    assert.equal(Object.keys(originalPdf.attachments).length, 1);

    await exec('gs', [
        '-q', '-dSAFER', '-dBATCH', '-dNOPAUSE', '-dPDFSTOPONERROR', '-dUseCropBox',
        '-dPrinted=false', '-dShowAnnots=true', '-sDEVICE=ppmraw', '-r300',
        `-sOutputFile=${join(dir, 'pixels-%d.ppm')}`, '-f', reference,
    ]);

    // Each position below was calculated from its source coordinates, crop
    // origin, rotation, and 300 DPI, independently of both Ghostscript devices.
    const expected = [
        { size: [500, 750], samples: [
            [42, 42, red, '90° near top left'], [63, 703, green, '90° near bottom left'],
            [448, 63, blue, '90° near top right'], [480, 720, white, '90° empty corner'],
        ] },
        { size: [625, 110 * 300 / 72], samples: [
            [583, 417, cyan, '270° near bottom right'], [563, 46, yellow, '270° near top right'],
            [50, 417, red, '270° near bottom left'], [30, 30, white, '270° empty corner'],
        ] },
        { size: [2550.5, 400], samples: [
            [42, 58, red, 'landscape top left'], [2483, 342, cyan, 'landscape bottom right'],
            [438, 116, black, '한 glyph'], [533, 104, black, '글 glyph'],
            [700, 315, green, 'visible non-Print AcroForm widget'], [636, 328, black, 'widget detail'],
            [938, 275, blue, 'signature ink bend'], [988, 321, blue, 'signature ink next bend'],
            [1260, 310, white, 'Hidden annotation appearance is absent'],
        ] },
        { size: [595.28 * 300 / 72, 841.89 * 300 / 72], samples: [
            [2435, 67, magenta, '180° A4 near top right'], [93, 113, blue, '180° A4 near top left'],
            [2430, 3408, green, '180° A4 near bottom right'], [25, 3450, white, '180° A4 empty corner'],
        ] },
        { size: [400, 600], samples: [] },
    ];

    const dimensions = [];
    for (const [index, page] of pages.entries()) {
        assert.equal(page.images.length, 1);
        assert.equal(page.contents.length, 1);
        const [image] = page.images;
        const dictionary = qpdf[1][`obj:${page.object}`].value;
        assert.equal(image.bitspercomponent, 8);
        assert.equal(image.colorspace, '/DeviceRGB');
        assert.deepEqual(image.filter, ['/FlateDecode']);
        const { size, samples } = expected[index];
        assert.ok(Math.abs(image.width - size[0]) <= 0.500001, `page ${index + 1} width`);
        assert.ok(Math.abs(image.height - size[1]) <= 0.500001, `page ${index + 1} height`);
        assert.deepEqual(dictionary['/MediaBox'], [0, 0, image.width * 24 / 100, image.height * 24 / 100]);
        const pixels = await readImage(output, image);
        for (const [x, y, rgb, description] of samples) checkPixel(pixels, image.width, x, y, rgb, description);
        if (index === 4) assert.ok(pixels.every((channel) => channel === 255), 'blank page is entirely white');

        const direct = await readPpm(join(dir, `pixels-${index + 1}.ppm`));
        assert.deepEqual([direct.width, direct.height], [image.width, image.height]);
        assert.equal(pixels.compare(direct.pixels), 0, `page ${index + 1} matches the direct screen raster`);
        dimensions.push(`${image.width}×${image.height}`);
    }
    t.diagnostic(`300 DPI: ${dimensions.join(', ')}. Verified rotated corner colors, Hangul, non-Print widget, ink, hidden control and white blank.`);
});

rasterTest('atomic publication preserves existing files, hardlinks and symlinks and picks one concurrent winner', async (t) => {
    const dir = await temp(t);
    const a = join(dir, 'red.pdf');
    const b = join(dir, 'blue.pdf');
    const outputPath = join(dir, 'winner.pdf');
    const existing = join(dir, 'existing.pdf');
    const linked = join(dir, 'linked.pdf');
    const symlinkPath = join(dir, 'symlink.out');
    const dangling = join(dir, 'dangling.out');
    const sourceLink = join(dir, 'source-link.pdf');
    await writeFile(a, simpleSource(['0 0 24 24']));
    await writeFile(b, simpleSource(['0 0 24 24'], '0 0 1'));
    await writeFile(existing, 'sentinel');
    await link(existing, linked);
    await symlink(existing, symlinkPath);
    await symlink(join(dir, 'missing'), dangling);
    await symlink(a, sourceLink);

    for (const target of [existing, linked, symlinkPath, dangling]) {
        await assert.rejects(renderRasterPdf({ sourcePath: a, outputPath: target }), { code: 'RASTER_OUTPUT_EXISTS' });
    }
    assert.equal(await readFile(existing, 'utf8'), 'sentinel');
    assert.ok((await lstat(symlinkPath)).isSymbolicLink());
    assert.ok((await lstat(dangling)).isSymbolicLink());
    await assert.rejects(renderRasterPdf({ sourcePath: sourceLink, outputPath }), { code: 'RASTER_INVALID_SOURCE' });

    const race = await Promise.allSettled([a, b].map((sourcePath) => renderRasterPdf({ sourcePath, outputPath })));
    const winner = race.findIndex(({ status }) => status === 'fulfilled');
    assert.ok(winner === 0 || winner === 1);
    assert.equal(race[1 - winner].reason?.code, 'RASTER_OUTPUT_EXISTS');
    const { pages } = await pdfJson(outputPath);
    const [image] = pages[0].images;
    checkPixel(await readImage(outputPath, image), image.width, 20, 50, winner === 0 ? red : blue, 'winning input');
    assert.ok(!(await readdir(dir)).some((name) => name.startsWith('.bjj-raster-')));
});

rasterTest('publishes the validated result to a destination on a separate filesystem', async (t) => {
    const dir = await temp(t);
    const destination = await mkdtemp('/dev/shm/bjj-raster-test-').catch(() => null);
    if (destination === null) return t.skip('/dev/shm is unavailable');
    t.after(() => rm(destination, { force: true, recursive: true }));
    if ((await stat(dir)).dev === (await stat(destination)).dev) return t.skip('no separate scratch filesystem');

    const sourcePath = join(dir, 'source.pdf');
    const outputPath = join(destination, 'result.tmp');
    await writeFile(sourcePath, simpleSource(['0 0 24 24']));
    await renderRasterPdf({ sourcePath, outputPath });
    assert.deepEqual(await readdir(destination), ['result.tmp']);
    const result = join(dir, 'result.pdf');
    await writeFile(result, await readFile(outputPath));
    const { pages } = await pdfJson(result);
    const [image] = pages[0].images;
    checkPixel(await readImage(result, image), image.width, 20, 50, red, 'cross-filesystem publication');
});

async function ownedFixture(t, flags = 'wx+') {
    const dir = await temp(t);
    const stage = join(dir, 'stage');
    const sourcePath = join(dir, 'synthetic-original.pdf');
    const outputPath = join(stage, 'journal-target.pdf');
    const original = simpleSource(['0 0 24 24']);
    await mkdir(stage, { mode: 0o700 });
    await writeFile(sourcePath, original, { mode: 0o600 });
    const source = await lstat(sourcePath, { bigint: true });
    const outputHandle = await open(outputPath, flags, 0o600);
    t.after(() => outputHandle.close());
    const owned = await outputHandle.stat({ bigint: true });
    return { dir, stage, sourcePath, outputPath, outputHandle, original, source, owned };
}

function inode({ dev, ino }) {
    return { dev, ino };
}

async function assertOwnedPath(path, owned) {
    const entry = await lstat(path, { bigint: true });
    assert.ok(entry.isFile());
    assert.deepEqual(inode(entry), inode(owned));
    assert.equal(entry.nlink, 1n);
    assert.equal(entry.mode, owned.mode);
    assert.equal(entry.uid, owned.uid);
    return entry;
}

async function assertOriginal({ sourcePath, source, original }) {
    const entry = await assertOwnedPath(sourcePath, source);
    assert.equal(entry.mtimeNs, source.mtimeNs);
    assert.equal(entry.ctimeNs, source.ctimeNs);
    assert.deepEqual(await readFile(sourcePath), original);
}

async function assertSimpleRaster(path) {
    const { stdout } = await exec('qpdf', ['--check', path]);
    assert.match(stdout, /No syntax or stream encoding errors found/);
    const { pages } = await pdfJson(path);
    assert.equal(pages.length, 1);
    assert.equal(pages[0].images.length, 1);
    const [image] = pages[0].images;
    assert.deepEqual([image.width, image.height, image.bitspercomponent, image.colorspace], [100, 100, 8, '/DeviceRGB']);
    const pixels = await readImage(path, image);
    checkPixel(pixels, image.width, 20, 50, red, 'painted side');
    checkPixel(pixels, image.width, 80, 50, white, 'unpainted side');
}

async function renderAndCheckOwned(t, fixture, options = {}) {
    const { stage, sourcePath, outputPath, outputHandle, owned } = fixture;
    const write = outputHandle.write.bind(outputHandle);
    const sync = outputHandle.sync.bind(outputHandle);
    const events = [];
    let end = 0;
    t.mock.method(outputHandle, 'write', async (buffer, offset, length, position) => {
        assert.equal(position, end, 'writes are positional and contiguous');
        const result = await write(buffer, offset, Math.min(length, 113), position);
        end += result.bytesWritten;
        events.push('write');
        return result;
    });
    t.mock.method(outputHandle, 'sync', async () => {
        assert.equal((await outputHandle.stat()).size, end);
        await sync();
        events.push('sync');
    });

    assert.equal(await renderRasterPdf({ sourcePath, outputPath, outputHandle, ...options }), undefined);
    assert.ok(events.length > 2, 'fixture exercises short writes');
    assert.ok(events.slice(0, -1).every((event) => event === 'write'));
    assert.equal(events.at(-1), 'sync');
    assert.equal((await outputHandle.stat()).size, end, 'caller still owns the open handle');
    await outputHandle.close();
    const entry = await assertOwnedPath(outputPath, owned);
    assert.equal(entry.mode & 0o7777n, 0o600n);
    assert.equal(entry.size, BigInt(end));
    assert.deepEqual(await readdir(stage), ['journal-target.pdf']);
    await assertSimpleRaster(outputPath);
    await assertOriginal(fixture);
}

rasterTest('caller-owned write-only descriptor receives a complete raster on the same inode', async (t) => {
    const fixture = await ownedFixture(t, 'wx');
    const log = join(fixture.dir, 'gs.log');
    const gsBin = await recordingTool(fixture.dir, 'record-gs', log, `
        import { readdirSync } from 'node:fs';
        assert.deepEqual(readdirSync(${JSON.stringify(fixture.stage)}), ['journal-target.pdf']);
        process.exit(spawnSync('gs', args, { stdio: 'inherit' }).status ?? 1);
    `);
    await renderAndCheckOwned(t, fixture, { gsBin });
    await assertClean(fixture.dir, log, ['synthetic-original.pdf', 'stage', 'gs.log', 'record-gs']);
});

rasterTest('descriptor preflight rejects unsafe handles and paths before invoking either tool', async (t) => {
    const fixture = await ownedFixture(t);
    const { dir, stage, sourcePath, outputPath, outputHandle } = fixture;
    const marker = join(dir, 'tool-invoked');
    const tool = await shim(dir, 'unexpected-tool', `
        import { writeFileSync } from 'node:fs';
        writeFileSync(${JSON.stringify(marker)}, 'invoked');
    `);
    const symlinkPath = join(stage, 'symlink');
    const otherPath = join(stage, 'other.pdf');
    const linkedPath = join(stage, 'additional-link.pdf');
    const nonemptyPath = join(stage, 'nonempty.pdf');
    const widePath = join(stage, 'wide.pdf');
    const aliasPath = join(stage, 'source-alias.pdf');
    await symlink(outputPath, symlinkPath);
    await link(sourcePath, aliasPath);

    async function manage(path, flags, mode) {
        const handle = await open(path, flags, mode);
        t.after(() => handle.close());
        return handle;
    }

    const other = await manage(otherPath, 'wx+', 0o600);
    const readOnly = await manage(outputPath, 'r');
    const append = await manage(outputPath, 'a+');
    const nonempty = await manage(nonemptyPath, 'wx+', 0o600);
    await nonempty.writeFile('keep these bytes');
    const wide = await manage(widePath, 'wx+', 0o600);
    await wide.chmod(0o640);
    const alias = await manage(aliasPath, 'r+');
    const directory = await manage(stage, 'r');
    const closed = await open(outputPath, 'r+');
    await closed.close();

    const invalid = 'RASTER_INVALID_ARGUMENT';
    const exists = 'RASTER_OUTPUT_EXISTS';
    const noWrite = t.mock.method(outputHandle, 'write', () => assert.fail('unexpected write'));
    const noSync = t.mock.method(outputHandle, 'sync', () => assert.fail('unexpected sync'));
    const lookalike = { fd: outputHandle.fd, stat: outputHandle.stat.bind(outputHandle), write: outputHandle.write };

    async function reject(handle, path, code) {
        await assert.rejects(renderRasterPdf({
            sourcePath, outputPath: path, outputHandle: handle, gsBin: tool, qpdfBin: tool,
        }), { code, message: code });
        await assert.rejects(lstat(marker), { code: 'ENOENT' });
    }

    async function metadata(path) {
        const { dev, ino, uid, mode, nlink, size, mtimeNs, ctimeNs } = await lstat(path, { bigint: true });
        return { dev, ino, uid, mode, nlink, size, mtimeNs, ctimeNs };
    }

    const paths = [outputPath, sourcePath, otherPath, symlinkPath, aliasPath, nonemptyPath, widePath];
    const before = await Promise.all(paths.map(metadata));
    const entries = (await readdir(stage)).sort();
    for (const [handle, path, code] of [
        [undefined, outputPath, exists], [null, outputPath, invalid], [outputHandle.fd, outputPath, invalid],
        [lookalike, outputPath, invalid], [closed, outputPath, invalid], [readOnly, outputPath, invalid],
        [append, outputPath, invalid], [other, outputPath, invalid], [directory, stage, invalid],
        [outputHandle, stage, invalid],
        [outputHandle, symlinkPath, invalid], [outputHandle, join(stage, 'missing'), invalid],
        [outputHandle, 'relative.pdf', invalid], [outputHandle, outputPath + '\0suffix', invalid],
        [nonempty, nonemptyPath, exists], [wide, widePath, invalid],
        [alias, aliasPath, invalid], [alias, sourcePath, invalid],
    ]) await reject(handle, path, code);

    Object.defineProperty(other, 'fd', { configurable: true, value: outputHandle.fd });
    try {
        await reject(other, outputPath, invalid);
    } finally {
        delete other.fd;
    }
    const uid = process.geteuid();
    const owner = t.mock.method(process, 'geteuid', () => uid + 1);
    try {
        await reject(outputHandle, outputPath, invalid);
    } finally {
        owner.mock.restore();
    }
    assert.deepEqual(await Promise.all(paths.map(metadata)), before);
    assert.deepEqual((await readdir(stage)).sort(), entries);
    assert.deepEqual(await readFile(sourcePath), fixture.original);
    assert.deepEqual(await readFile(aliasPath), fixture.original);
    assert.equal(await readFile(nonemptyPath, 'utf8'), 'keep these bytes');
    assert.equal(noWrite.mock.callCount(), 0);
    assert.equal(noSync.mock.callCount(), 0);
    for (const handle of [outputHandle, readOnly, append, other, nonempty, wide, alias, directory]) {
        await handle.stat();
    }

    await link(outputPath, linkedPath);
    const linked = await metadata(outputPath);
    await reject(outputHandle, outputPath, exists);
    assert.deepEqual(await metadata(outputPath), linked);
    assert.deepEqual(await metadata(linkedPath), linked);
    assert.equal((await outputHandle.stat()).size, 0);
});

rasterTest('descriptor output stays empty until the entire source and raster pass validation', async (t) => {
    const fixture = await ownedFixture(t);
    const { dir, stage, sourcePath, outputPath, outputHandle, owned } = fixture;
    const write = t.mock.method(outputHandle, 'write', () => assert.fail('unexpected write'));
    const sync = t.mock.method(outputHandle, 'sync', () => assert.fail('unexpected sync'));
    const log = join(dir, 'gs.log');
    const gsBin = await recordingTool(dir, 'record-gs', log, "writeFileSync(rendered, '%PDF-incomplete')");
    const invalidSource = join(dir, 'truncated.pdf');
    await writeFile(invalidSource, fixture.original.subarray(0, -7));
    await assert.rejects(renderRasterPdf({ sourcePath: invalidSource, outputPath, outputHandle, gsBin }), {
        code: 'RASTER_INVALID_SOURCE', message: 'RASTER_INVALID_SOURCE',
    });
    await assert.rejects(lstat(log), { code: 'ENOENT' });
    await assert.rejects(renderRasterPdf({ sourcePath, outputPath, outputHandle, gsBin }), {
        code: 'RASTER_INVALID_OUTPUT', message: 'RASTER_INVALID_OUTPUT',
    });
    assert.equal((await assertOwnedPath(outputPath, owned)).size, 0n);
    assert.equal((await outputHandle.stat()).size, 0);
    assert.equal(write.mock.callCount(), 0);
    assert.equal(sync.mock.callCount(), 0);
    assert.deepEqual(await readdir(stage), ['journal-target.pdf']);
    await assertClean(dir, log, ['synthetic-original.pdf', 'stage', 'truncated.pdf', 'gs.log', 'record-gs']);
    await assertOriginal(fixture);
});

rasterTest('descriptor copy rejects a scratch raster changed after stream validation', async (t) => {
    const fixture = await ownedFixture(t);
    const { dir, stage, sourcePath, outputPath, outputHandle, owned } = fixture;
    const log = join(dir, 'qpdf.log');
    const changed = join(dir, 'scratch-changed');
    const qpdfBin = await recordingTool(dir, 'record-qpdf', log, `
        const result = spawnSync('qpdf', args);
        if (result.status !== 0) process.exit(result.status ?? 1);
        if (args.includes('--filtered-stream-data') && result.stdout.length === 30_000) {
            appendFileSync(rendered, ' ');
            writeFileSync(${JSON.stringify(changed)}, 'appended after reading RGB');
        }
        process.stdout.write(result.stdout);
    `);
    const write = t.mock.method(outputHandle, 'write', () => assert.fail('unexpected write'));
    const invalid = 'RASTER_INVALID_OUTPUT';
    await assert.rejects(renderRasterPdf({ sourcePath, outputPath, outputHandle, qpdfBin }), {
        code: invalid, message: invalid,
    });
    assert.equal(await readFile(changed, 'utf8'), 'appended after reading RGB');
    assert.equal(write.mock.callCount(), 0);
    assert.equal((await outputHandle.stat()).size, 0);
    assert.equal((await assertOwnedPath(outputPath, owned)).size, 0n);
    assert.deepEqual(await readdir(stage), ['journal-target.pdf']);
    await assertClean(dir, log, ['synthetic-original.pdf', 'stage', 'qpdf.log', 'record-qpdf', 'scratch-changed']);
    await assertOriginal(fixture);
});

for (const phase of ['before the first write', 'during the first write']) {
    rasterTest(`descriptor mode fails closed on pathname substitution ${phase}`, async (t) => {
        const fixture = await ownedFixture(t);
        const { dir, stage, sourcePath, outputPath, outputHandle, owned } = fixture;
        const moved = join(stage, 'moved.pdf');
        const replacement = 'replacement sentinel';
        const write = outputHandle.write.bind(outputHandle);
        let gsBin;
        if (phase === 'before the first write') {
            const log = join(dir, 'gs.log');
            gsBin = await recordingTool(dir, 'record-gs', log, `
                import { renameSync } from 'node:fs';
                const result = spawnSync('gs', args, { stdio: 'inherit' });
                if (result.status !== 0) process.exit(result.status ?? 1);
                renameSync(${JSON.stringify(outputPath)}, ${JSON.stringify(moved)});
                writeFileSync(${JSON.stringify(outputPath)}, ${JSON.stringify(replacement)}, { flag: 'wx', mode: 0o600 });
            `);
            t.mock.method(outputHandle, 'write', () => assert.fail('write after pre-write identity failure'));
        } else {
            t.mock.method(outputHandle, 'write', async (buffer, offset, length, position) => {
                if (position === 0) {
                    await rename(outputPath, moved);
                    await writeFile(outputPath, replacement, { flag: 'wx', mode: 0o600 });
                }
                return write(buffer, offset, length, position);
            });
        }

        const invalid = 'RASTER_INVALID_ARGUMENT';
        await assert.rejects(renderRasterPdf({ sourcePath, outputPath, outputHandle, gsBin }), {
            code: invalid, message: invalid,
        });
        assert.deepEqual(inode(await outputHandle.stat({ bigint: true })), inode(owned));
        assert.equal(await readFile(outputPath, 'utf8'), replacement);
        assert.deepEqual((await readdir(stage)).sort(), ['journal-target.pdf', 'moved.pdf']);
        const entry = await assertOwnedPath(moved, owned);
        if (phase === 'before the first write') {
            assert.equal(entry.size, 0n);
            await assertClean(dir, join(dir, 'gs.log'), ['synthetic-original.pdf', 'stage', 'gs.log', 'record-gs']);
        } else {
            await assertSimpleRaster(moved);
        }
        await assertOriginal(fixture);
    });
}

for (const milestone of ['first-write', 'after-sync']) {
    rasterTest(`SIGKILL at ${milestone} leaves one recoverable caller-owned inode`, async (t) => {
        const fixture = await ownedFixture(t);
        const { dir, stage, sourcePath, outputPath, outputHandle, owned } = fixture;
        const log = join(dir, 'gs.log');
        const evidence = join(dir, 'scratch-identity.json');
        const gsBin = await recordingTool(dir, 'record-gs', log, `
            const entry = statSync(scratch, { bigint: true });
            writeFileSync(${JSON.stringify(evidence)}, JSON.stringify({
                scratch, dev: String(entry.dev), ino: String(entry.ino),
            }), { flag: 'wx', mode: 0o600 });
            process.exit(spawnSync('gs', args, { stdio: 'inherit' }).status ?? 1);
        `);
        const child = join(dir, 'interrupt-render.mjs');
        const renderer = new URL('../eformsign-backup/raster-render.mjs', import.meta.url).href;
        await writeFile(child, `
            import assert from 'node:assert/strict';
            import { writeSync } from 'node:fs';
            import { open } from 'node:fs/promises';
            import { renderRasterPdf } from ${JSON.stringify(renderer)};

            const [milestone, sourcePath, outputPath, gsBin] = process.argv.slice(2);
            const outputHandle = await open(outputPath, 'r+');
            const write = outputHandle.write.bind(outputHandle);
            const sync = outputHandle.sync.bind(outputHandle);
            let end = 0;
            function interrupt() {
                writeSync(1, milestone + '\\n');
                process.kill(process.pid, 'SIGKILL');
            }
            outputHandle.write = async (buffer, offset, length, position) => {
                assert.equal(position, end);
                const result = await write(buffer, offset, milestone === 'first-write' ? Math.min(length, 17) : length, position);
                end += result.bytesWritten;
                if (milestone === 'first-write') {
                    assert.equal(end, 17);
                    interrupt();
                }
                return result;
            };
            outputHandle.sync = async () => {
                assert.ok(end > 0);
                assert.equal((await outputHandle.stat()).size, end);
                await sync();
                if (milestone === 'after-sync') interrupt();
            };
            await renderRasterPdf({ sourcePath, outputPath, outputHandle, gsBin });
            assert.fail('renderer returned without hitting the kill milestone');
        `, { mode: 0o600 });

        const interrupted = spawnSync(process.execPath, [child, milestone, sourcePath, outputPath, gsBin], {
            encoding: 'utf8', timeout: 30_000,
        });
        // This GS shim ran inside the child's scratch. Check its recorded identity
        // before reading or removing anything outside the test's own directory.
        const scratchIdentity = await readFile(evidence, 'utf8').then(JSON.parse, (error) => {
            if (error.code !== 'ENOENT') throw error;
            return undefined;
        });
        let scratch;
        if (scratchIdentity) {
            const { scratch: recorded, dev, ino } = scratchIdentity;
            assert.match(recorded, /^\/tmp\/bjj-raster-[a-zA-Z0-9]{6}$/);
            const entry = await lstat(recorded, { bigint: true });
            assert.ok(entry.isDirectory());
            assert.equal(entry.uid, BigInt(process.geteuid()));
            assert.equal(entry.mode & 0o7777n, 0o700n);
            assert.deepEqual(inode(entry), { dev: BigInt(dev), ino: BigInt(ino) });
            scratch = recorded;
        }
        try {
            assert.equal(interrupted.error, undefined);
            assert.equal(interrupted.status, null, interrupted.stderr);
            assert.equal(interrupted.signal, 'SIGKILL', interrupted.stderr);
            assert.equal(interrupted.stdout.trim(), milestone);
            const entry = await assertOwnedPath(outputPath, owned);
            const descriptor = await outputHandle.stat({ bigint: true });
            assert.deepEqual(inode(descriptor), inode(owned));
            assert.equal(descriptor.nlink, 1n);
            assert.equal(descriptor.size, entry.size);
            assert.deepEqual(await readdir(stage), ['journal-target.pdf']);
            const rendered = await readFile(join(scratch, 'rendered.pdf'));
            assert.ok(rendered.length > 17);
            const bytes = await readFile(outputPath);
            if (milestone === 'first-write') {
                assert.deepEqual(bytes, rendered.subarray(0, 17));
            } else {
                assert.deepEqual(bytes, rendered);
                await assertSimpleRaster(outputPath);
            }
            await assertOriginal(fixture);

            // Simulate journal recovery of the proven inode before retrying.
            await outputHandle.truncate(0);
            assert.equal((await assertOwnedPath(outputPath, owned)).size, 0n);
            await renderAndCheckOwned(t, fixture);
        } finally {
            if (scratch) await rm(scratch, { force: true, recursive: true });
        }
        await assertClean(dir, log, [
            'synthetic-original.pdf', 'stage', 'gs.log', 'record-gs', 'scratch-identity.json', 'interrupt-render.mjs',
        ]);
    });
}

rasterTest('malformed, truncated and password-required input stays unpublished', async (t) => {
    const dir = await temp(t);
    const outputPath = join(dir, 'unpublished.pdf');
    const sourcePath = join(dir, 'source.pdf');
    const locked = join(dir, 'locked.pdf');
    const valid = simpleSource(['0 0 24 24']);
    await writeFile(sourcePath, valid);
    await exec('qpdf', ['--encrypt', 'synthetic-reader', 'synthetic-owner', '256', '--', sourcePath, locked]);
    await assert.rejects(renderRasterPdf({ sourcePath: locked, outputPath }), { code: 'RASTER_INVALID_SOURCE' });

    for (const invalid of [
        Buffer.from('malformed'),
        valid.subarray(0, -7),
        Buffer.from(valid.toString().replace(/startxref\n\d+/, 'startxref\n1')),
    ]) {
        await writeFile(sourcePath, invalid);
        await assert.rejects(renderRasterPdf({ sourcePath, outputPath }), { code: 'RASTER_INVALID_SOURCE' });
    }
    await assert.rejects(lstat(outputPath), { code: 'ENOENT' });
});

function flatPdf(specifications, {
    openAction = false, unusedObject = false, trailerEntries = '', infoEntries = '', treeEntries = '',
} = {}) {
    const pdf = pdfObjects();
    const catalog = pdf.add();
    const tree = pdf.add();
    const kids = specifications.map(({
        width = 100, height = 100, media = [24, 24], draw = true, bytes, pixels, paint,
        colorSpace = '/DeviceRGB', bitsPerComponent = 8, asciiHexImage = false, linkAnnotation = false,
        imageEntries = '', contentLengthHint = false, resourceEntries = '',
    }) => {
        pixels ??= Buffer.alloc(bytes ?? width * height * 3, 255);
        const filter = asciiHexImage ? '/ASCIIHexDecode' : '/FlateDecode';
        const encodedPixels = asciiHexImage ? `${pixels.toString('hex')}>` : deflateSync(pixels);
        const image = pdf.add(pdfStream(`/Subtype /Image /ColorSpace ${colorSpace} /BitsPerComponent ${bitsPerComponent}
            /Width ${width} /Height ${height} /Filter ${filter} ${imageEntries}`, encodedPixels));
        const [pageWidth, pageHeight] = media;
        const painting = paint ?? (draw ? `${pageWidth} 0 0 ${pageHeight} 0 0 cm\n/Im1 Do` : '0 0 m 24 24 l S');
        const contentEntries = contentLengthHint ? ` /DL ${Buffer.byteLength(painting)}` : '';
        const contents = pdf.add(pdfStream(`/Filter /FlateDecode${contentEntries}`, deflateSync(painting)));
        const page = pdf.add();
        // A local destination needs no separate annotation object or executable action.
        const annots = linkAnnotation
            ? ` /Annots [<< /Type /Annot /Subtype /Link /Rect [0 0 12 12] /Dest [${page} /Fit] >>]` : '';
        pdf.set(page, `<< /Type /Page /Parent ${tree} /MediaBox [0 0 ${pageWidth} ${pageHeight}]
            /Resources << /XObject << /Im1 ${image} >> ${resourceEntries} >> /Contents ${contents}${annots} >>`);
        return page;
    });
    const action = openAction ? ` /OpenAction [${kids[0]} /Fit]` : '';
    pdf.set(catalog, `<< /Type /Catalog /Pages ${tree}${action} >>`);
    pdf.set(tree, `<< /Type /Pages /Count ${kids.length} /Kids [${kids.join(' ')}] ${treeEntries} >>`);
    if (unusedObject) pdf.add('<< /Fixture (Unreferenced object) >>');
    const info = pdf.add(`<< /Producer (GPL Ghostscript 10.06.0) /CreationDate (D:20261124000000Z) ${infoEntries} >>`);
    return pdf.output(info, trailerEntries);
}

rasterTest('validates image-only output before publication and cleans up rejected fixtures', async (t) => {
    const dir = await temp(t);
    const sourcePath = join(dir, 'source.pdf');
    const outputPath = join(dir, 'result.pdf');
    const mockPath = join(dir, 'mock.pdf');
    const log = join(dir, 'gs.log');
    await writeFile(sourcePath, simpleSource(['0 0 24 24', '0 0 24 24']));
    const gsBin = await recordingTool(dir, 'mock-gs', log, `
        import { copyFileSync } from 'node:fs';
        copyFileSync(${JSON.stringify(mockPath)}, rendered);
    `);
    const expectedFiles = ['source.pdf', 'mock.pdf', 'gs.log', 'mock-gs'];
    async function renderFixture(specs, options) {
        await writeFile(mockPath, flatPdf(specs, options));
        await exec('qpdf', ['--check', mockPath]);
        await renderRasterPdf({ sourcePath, outputPath, gsBin });
    }

    for (const [name, specs, options] of [
        ['image dimensions', [{ width: 101 }, {}]],
        ['MediaBox differs from raster size even when the paint matrix matches the box', [{ media: [25, 24] }, {}]],
        ['page count', [{}]],
        ['page paints vector without invoking its image', [{}, { draw: false }]],
        ['catalog has an OpenAction', [{}, {}], { openAction: true }],
        ['page has a Link annotation', [{ linkAnnotation: true }, {}]],
        ['unreferenced object', [{}, {}], { unusedObject: true }],
        ['image stream has a Decode array that inverts RGB', [{ imageEntries: '/Decode [1 0 1 0 1 0]' }, {}]],
        ['content stream has a decoded length hint', [{ contentLengthHint: true }, {}]],
        ['trailer has a custom entry', [{}, {}], { trailerEntries: '/Fixture (Synthetic trailer data)' }],
        ['Info has a Title entry', [{}, {}], { infoEntries: '/Title (Synthetic title)' }],
        ['page tree has an inherited Rotate entry', [{}, {}], { treeEntries: '/Rotate 0' }],
        ['Resources has a ProcSet entry', [{ resourceEntries: '/ProcSet [/PDF /ImageC]' }, {}]],
        ['image uses CalRGB', [{ colorSpace: '[/CalRGB << /WhitePoint [0.9505 1 1.089] >>]' }, {}]],
        // Keep the decoded byte count fixed so the bit-depth check has to reject it.
        ['image declares 4 bits per component', [{ bitsPerComponent: 4 }, {}]],
        ['image uses ASCIIHexDecode', [{ asciiHexImage: true }, {}]],
        ['short RGB stream', [{}, { bytes: 29_999 }]],
        ['oversized RGB stream', [{}, { bytes: 30_001 }]],
    ]) {
        await t.test(name, async () => {
            await assert.rejects(renderFixture(specs, options), {
                code: 'RASTER_INVALID_OUTPUT', message: 'RASTER_INVALID_OUTPUT',
            });
            await assertClean(dir, log, expectedFiles);
        });
    }

    await t.test('accepts and publishes the valid control unchanged', async () => {
        await renderFixture([{}, {}]);
        assert.deepEqual(await readFile(outputPath), await readFile(mockPath));
        await assertClean(dir, log, [...expectedFiles, 'result.pdf']);
    });
});

function noblePages() {
    const width = 833;
    const height = 417;
    const pixels = Buffer.alloc(width * height * 3, 255);
    const markers = [
        [31, 0, red], [0, 53, green], [width - 1, 101, blue],
        [277, height - 1, magenta], [width - 1, height - 1, cyan],
    ];
    for (const [x, y, color] of markers) {
        pixels.set(color, (y * width + x) * 3);
    }
    return {
        markers,
        truncated: { width, height, pixels, media: [199.92, 100.08], paint: '199 0 0 100 0 0 cm\n/Im1 Do' },
        source: { width, height, pixels, media: [200, 100] },
        exact: { pixels: Buffer.alloc(30_000, 42) },
    };
}

async function readPaint(path, page) {
    const [number, generation] = page.contents[0].split(' ');
    const { stdout } = await exec('qpdf', [
        `--show-object=${number},${generation}`, '--filtered-stream-data', path,
    ]);
    return stdout.trim().replace(/\s+/g, ' ');
}

async function nobleFixture(t) {
    const dir = await temp(t);
    const sourcePath = join(dir, 'source.pdf');
    const outputPath = join(dir, 'result.pdf');
    const mockPath = join(dir, 'noble.pdf');
    const gsLog = join(dir, 'gs.log');
    const qpdfLog = join(dir, 'qpdf.log');
    const pages = noblePages();
    const original = flatPdf([pages.source, pages.exact]);
    await writeFile(sourcePath, original);
    await writeFile(mockPath, flatPdf([pages.truncated, pages.exact]));
    const source = await lstat(sourcePath, { bigint: true });
    const gsBin = await recordingTool(dir, 'mock-gs', gsLog, `
        import { copyFileSync } from 'node:fs';
        copyFileSync(${JSON.stringify(mockPath)}, rendered);
    `);
    return { dir, sourcePath, outputPath, mockPath, gsLog, qpdfLog, gsBin, pages, source, original };
}

function rewrites(entries) {
    return entries.filter(({ args }) => args.some((arg) => arg.startsWith('--update-from-json=')));
}

rasterTest('normalizes a Noble 200x100-point raster alongside an exact page', async (t) => {
    const fixture = await nobleFixture(t);
    const { dir, sourcePath, outputPath, mockPath, gsLog, qpdfLog, gsBin, pages } = fixture;
    const patchCapture = join(dir, 'observed-patch.json');
    const qpdfBin = await recordingTool(dir, 'record-qpdf', qpdfLog, `
        import { copyFileSync } from 'node:fs';
        if (args.includes(update)) copyFileSync(patch, ${JSON.stringify(patchCapture)});
        process.exit(spawnSync('qpdf', args, { stdio: 'inherit' }).status ?? 1);
    `);
    const raw = await pdfJson(mockPath);
    assert.equal(await readPaint(mockPath, raw.pages[0]), '199 0 0 100 0 0 cm /Im1 Do');
    await renderRasterPdf({ sourcePath, outputPath, gsBin, qpdfBin });
    await exec('qpdf', ['--check', outputPath]);
    assert.equal(rewrites(await toolLog(qpdfLog)).length, 1);
    const repair = JSON.parse(await readFile(patchCapture, 'utf8'));
    assert.equal(repair.qpdf[0].jsonversion, 2);
    assert.deepEqual(Object.keys(repair.qpdf[1]), [`obj:${raw.pages[0].contents[0]}`]);
    const { pages: final, qpdf, acroform } = await pdfJson(outputPath);
    assert.equal(acroform.hasacroform, false);
    assert.doesNotMatch(JSON.stringify(qpdf[1]), /"\/(?:Font|Annots|AcroForm|Form|OpenAction)"/);
    assert.equal(final.length, 2);
    for (const [index, expected] of [[0, pages.truncated], [1, pages.exact]]) {
        const page = final[index];
        assert.equal(page.contents.length, 1);
        assert.equal(page.images.length, 1);
        const [image] = page.images;
        const [width, height] = expected.media ?? [24, 24];
        assert.deepEqual(qpdf[1][`obj:${page.object}`].value['/MediaBox'], [0, 0, width, height]);
        assert.equal(await readPaint(outputPath, page), `${width} 0 0 ${height} 0 0 cm /Im1 Do`);
        assert.deepEqual([image.width, image.height, image.colorspace, image.bitspercomponent, image.filter],
            [expected.width ?? 100, expected.height ?? 100, '/DeviceRGB', 8, ['/FlateDecode']]);
        const pixels = await readImage(outputPath, image);
        assert.deepEqual(pixels, await readImage(mockPath, raw.pages[index].images[0]));
        assert.deepEqual(pixels, expected.pixels);
        if (index === 0) {
            for (const [x, y, color] of pages.markers) {
                checkPixel(pixels, image.width, x, y, color, `edge at ${x},${y}`);
            }
        }
    }
    await assertOriginal(fixture);
    await assertClean(dir, gsLog, [
        'source.pdf', 'result.pdf', 'noble.pdf', 'gs.log', 'qpdf.log', 'mock-gs', 'record-qpdf', 'observed-patch.json',
    ]);
});

rasterTest('publishes a real Ghostscript derivative and bypasses rewriting when its matrix is exact', async (t) => {
    const dir = await temp(t);
    const sourcePath = join(dir, 'source.pdf');
    const outputPath = join(dir, 'result.pdf');
    const rawPath = join(dir, 'raw.pdf');
    const gsLog = join(dir, 'gs.log');
    const qpdfLog = join(dir, 'qpdf.log');
    await writeFile(sourcePath, flatPdf([noblePages().source]));
    const gsBin = await recordingTool(dir, 'record-gs', gsLog, `
        import { copyFileSync } from 'node:fs';
        const result = spawnSync('gs', args, { stdio: 'inherit' });
        if (result.status !== 0) process.exit(result.status ?? 1);
        copyFileSync(rendered, ${JSON.stringify(rawPath)});
    `);
    const qpdfBin = await recordingTool(dir, 'record-qpdf', qpdfLog,
        "process.exit(spawnSync('qpdf', args, { stdio: 'inherit' }).status ?? 1)");
    const outputHandle = await open(outputPath, 'wx+', 0o600);
    try {
        await renderRasterPdf({ sourcePath, outputPath, outputHandle, gsBin, qpdfBin });
    } finally {
        await outputHandle.close();
    }
    const { pages: [raw] } = await pdfJson(rawPath);
    const { pages: [final] } = await pdfJson(outputPath);
    const exact = '199.92 0 0 100.08 0 0 cm /Im1 Do';
    const paint = (await readPaint(rawPath, raw)).replace(/(\.\d*?[1-9])0+\b/g, '$1');
    assert.equal((await readPaint(outputPath, final)).replace(/(\.\d*?[1-9])0+\b/g, '$1'), exact);
    const calls = rewrites(await toolLog(qpdfLog));
    if (paint === exact) {
        assert.equal(calls.length, 0);
        assert.deepEqual(await readFile(outputPath), await readFile(rawPath));
    } else {
        assert.equal(paint, '199 0 0 100 0 0 cm /Im1 Do');
        assert.equal(calls.length, 1);
    }
    assert.deepEqual(await readImage(outputPath, final.images[0]), await readImage(rawPath, raw.images[0]));
});

rasterTest('does not rewrite malformed or near-miss raster candidates', async (t) => {
    const fixture = await nobleFixture(t);
    const { dir, sourcePath, outputPath, mockPath, gsBin, qpdfLog, pages } = fixture;
    const qpdfBin = await recordingTool(dir, 'record-qpdf', qpdfLog, `
        assert.ok(!args.includes(update), 'unexpected rewrite');
        process.exit(spawnSync('qpdf', args, { stdio: 'inherit' }).status ?? 1);
    `);
    const truncated = pages.truncated;
    for (const [name, changes, options] of [
        ['oversized', { paint: '200 0 0 100 0 0 cm /Im1 Do' }],
        ['undersized', { paint: '198 0 0 100 0 0 cm /Im1 Do' }],
        ['decimal floor token', { paint: '199.0 0 0 100 0 0 cm /Im1 Do' }],
        ['noncanonical integer', { paint: '0199 0 0 100 0 0 cm /Im1 Do' }],
        ['only one axis floored', { paint: '199 0 0 100.08 0 0 cm /Im1 Do' }],
        ['wrong image name', { paint: '199 0 0 100 0 0 cm /Im2 Do' }],
        ['shifted', { paint: '199 0 0 100 1 0 cm /Im1 Do' }],
        ['skewed', { paint: '199 1 0 100 0 0 cm /Im1 Do' }],
        ['duplicate paint', { paint: '199 0 0 100 0 0 cm /Im1 Do /Im1 Do' }],
        ['injected operator', { paint: 'q 199 0 0 100 0 0 cm /Im1 Do Q' }],
        ['non-PDF whitespace', { paint: '199\u000b0 0 100 0 0 cm /Im1 Do' }],
        ['wrong page box', { media: [199.96, 100.08] }],
        ['wrong raster dimensions', { width: 832 }],
        ['wrong raster color space', { colorSpace: '/DeviceGray' }],
        ['extra action', {}, { openAction: true }],
        ['orphan object', {}, { unusedObject: true }],
    ]) {
        await t.test(name, async () => {
            await writeFile(mockPath, flatPdf([{ ...truncated, ...changes }, pages.exact], options));
            await assert.rejects(renderRasterPdf({ sourcePath, outputPath, gsBin, qpdfBin }), {
                code: 'RASTER_INVALID_OUTPUT',
            });
            await assert.rejects(lstat(outputPath), { code: 'ENOENT' });
        });
    }
    assert.equal(rewrites(await toolLog(qpdfLog)).length, 0);
    await assertOriginal(fixture);
    await assertClean(dir, qpdfLog, ['source.pdf', 'noble.pdf', 'gs.log', 'qpdf.log', 'mock-gs', 'record-qpdf']);
});

rasterTest('binds the original raster snapshot through the precheck and rejects a stale rewrite path', async (t) => {
    const fixture = await nobleFixture(t);
    const { dir, sourcePath, outputPath, mockPath, gsBin, qpdfLog, pages } = fixture;
    for (const [name, action, exact] of [
        ['truncated raster changed after RGB read', "appendFileSync(rendered, ' ')"],
        ['exact raster changed after RGB read', "appendFileSync(rendered, ' ')", true],
        ['stale rewrite path', 'copyFileSync(rendered, normalized)'],
    ]) {
        await t.test(name, async () => {
            if (exact) await writeFile(mockPath, flatPdf([{ ...pages.truncated, paint: undefined }, pages.exact]));
            const marker = join(dir, 'precheck-changed');
            const qpdfBin = await recordingTool(dir, 'record-qpdf', qpdfLog, `
                import { copyFileSync } from 'node:fs';
                assert.ok(!args.includes(update), 'unexpected rewrite');
                const result = spawnSync('qpdf', args, { maxBuffer: 2 * 1024 ** 2 });
                if (result.status !== 0) process.exit(result.status ?? 1);
                if (args.at(-1) === rendered && args.includes('--filtered-stream-data') && result.stdout.length === 30_000) {
                    ${action};
                    writeFileSync(${JSON.stringify(marker)}, 'changed after RGB read');
                }
                process.stdout.write(result.stdout);
            `);
            await assert.rejects(renderRasterPdf({ sourcePath, outputPath, gsBin, qpdfBin }), {
                code: 'RASTER_INVALID_OUTPUT', message: 'RASTER_INVALID_OUTPUT',
            });
            assert.equal(await readFile(marker, 'utf8'), 'changed after RGB read');
            assert.equal(rewrites(await toolLog(qpdfLog)).length, 0);
            await assert.rejects(lstat(outputPath), { code: 'ENOENT' });
            await assertOriginal(fixture);
            await assertClean(dir, qpdfLog, [
                'source.pdf', 'noble.pdf', 'gs.log', 'qpdf.log', 'mock-gs', 'record-qpdf', 'precheck-changed',
            ]);
            await rm(marker);
            await rm(qpdfLog);
            await writeFile(mockPath, flatPdf([pages.truncated, pages.exact]));
        });
    }
});

for (const owned of [false, true]) {
    rasterTest(`rejects unsafe Noble rewrite results before ${owned ? 'descriptor copying' : 'exclusive publication'}`, async (t) => {
        const fixture = await nobleFixture(t);
        const { dir, sourcePath, outputPath, gsBin, qpdfLog, pages } = fixture;
        const alternate = join(dir, 'alternate.pdf');
        for (const [name, behavior, code] of [
            ['process failure', "process.stderr.write('PRIVATE SYNTHETIC DETAIL'); process.exit(7)"],
            ['missing derivative', 'process.exit(0)'],
            ['empty derivative', "writeFileSync(normalized, '')"],
            ['still truncated', 'copyFileSync(rendered, normalized)'],
            ['oversized derivative', "writeFileSync(normalized, ''); truncateSync(normalized, 512 * 1024 ** 2 + 1)", 'RASTER_LIMIT'],
            ['extra crop box', 'copyFileSync(alternate, normalized)'],
            ['different RGB', 'copyFileSync(alternate, normalized)'],
            ['late RGB mutation', ''],
        ]) {
            await t.test(name, async (sub) => {
                const qpdfBin = await recordingTool(dir, 'record-qpdf', qpdfLog, `
                    import { closeSync, copyFileSync, openSync, writeSync } from 'node:fs';
                    const alternate = ${JSON.stringify(alternate)};
                    if (args.includes(update) && ${Boolean(behavior)}) {
                        ${behavior}
                        process.exit(0);
                    }
                    const result = spawnSync('qpdf', args, { maxBuffer: 2 * 1024 ** 2 });
                    if (result.status !== 0) process.exit(result.status ?? 1);
                    if (args.at(-1) === normalized && args.includes('--filtered-stream-data') &&
                        result.stdout.length === 30_000 && ${name === 'late RGB mutation'}) {
                        const fd = openSync(normalized, 'r+');
                        try {
                            writeSync(fd, Buffer.from(' '), 0, 1, 0);
                        } finally {
                            closeSync(fd);
                        }
                        writeFileSync(alternate, 'mutated after the final RGB read');
                    }
                    process.stdout.write(result.stdout);
                `);
                if (name === 'extra crop box' || name === 'different RGB') {
                    const first = { ...pages.truncated, paint: undefined };
                    const second = name === 'different RGB' ? {} : pages.exact;
                    const treeEntries = name === 'extra crop box' ? '/CropBox [0 0 190 100]' : '';
                    await writeFile(alternate, flatPdf([first, second], { treeEntries }));
                }
                const outputHandle = owned ? await open(outputPath, 'wx+', 0o600) : undefined;
                const write = owned && sub.mock.method(outputHandle, 'write', () => assert.fail('unexpected write'));
                const expected = code ?? 'RASTER_INVALID_OUTPUT';
                try {
                    await assert.rejects(renderRasterPdf({ sourcePath, outputPath, outputHandle, gsBin, qpdfBin }), {
                        code: expected, message: expected,
                    });
                    if (owned) {
                        assert.equal(write.mock.callCount(), 0);
                        assert.equal((await outputHandle.stat()).size, 0);
                        assert.equal((await lstat(outputPath)).size, 0);
                    } else {
                        await assert.rejects(lstat(outputPath), { code: 'ENOENT' });
                    }
                } finally {
                    if (owned) {
                        await outputHandle.close();
                        await rm(outputPath);
                    }
                }
                if (name === 'late RGB mutation') {
                    assert.equal(await readFile(alternate, 'utf8'), 'mutated after the final RGB read');
                }
                assert.equal(rewrites(await toolLog(qpdfLog)).length, 1);
                await assertOriginal(fixture);
                const files = ['source.pdf', 'noble.pdf', 'gs.log', 'qpdf.log', 'mock-gs', 'record-qpdf'];
                if (['extra crop box', 'different RGB', 'late RGB mutation'].includes(name)) files.push('alternate.pdf');
                await assertClean(dir, qpdfLog, files);
                await rm(qpdfLog);
                await rm(alternate, { force: true });
            });
        }
    });
}

rasterTest('kills a hung qpdf rewrite at its deadline and removes its partial PDF', async (t) => {
    const fixture = await nobleFixture(t);
    const { dir, sourcePath, outputPath, gsBin, qpdfLog } = fixture;
    const qpdfBin = await recordingTool(dir, 'record-qpdf', qpdfLog, `
        if (args.includes(update)) {
            writeFileSync(normalized, '%PDF-incomplete');
            setInterval(() => {}, 1000);
        } else {
            process.exit(spawnSync('qpdf', args, { stdio: 'inherit' }).status ?? 1);
        }
    `);
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const rejects = assert.rejects(renderRasterPdf({ sourcePath, outputPath, gsBin, qpdfBin }), {
        code: 'RASTER_TIMEOUT', message: 'RASTER_TIMEOUT',
    });
    try {
        let update;
        let partial;
        const until = Date.now() + 5000;
        while (!partial) {
            await new Promise((ready) => realSetTimeout(ready, 10));
            const entries = await toolLog(qpdfLog).catch((error) => {
                if (error.code !== 'ENOENT') throw error;
                return [];
            });
            update = rewrites(entries)[0];
            if (update) {
                partial = await lstat(join(update.scratch, 'normalized.pdf')).catch((error) => {
                    if (error.code !== 'ENOENT') throw error;
                });
            }
            assert.ok(Date.now() < until, 'qpdf never wrote its partial raster');
        }
        t.mock.timers.tick(59_999);
        process.kill(update.pid, 0);
        t.mock.timers.tick(1);
        await rejects;
        assert.throws(() => process.kill(update.pid, 0), { code: 'ESRCH' });
        await assert.rejects(lstat(outputPath), { code: 'ENOENT' });
        await assertOriginal(fixture);
        await assertClean(dir, qpdfLog, ['source.pdf', 'noble.pdf', 'gs.log', 'qpdf.log', 'mock-gs', 'record-qpdf']);
    } finally {
        t.mock.timers.tick(600_000);
        await rejects;
    }
});

// At 300 DPI, these fixtures reach one capacity limit each while staying below the other two.
for (const [boundary, pageCount, box] of [
    ['500 pages', 500, '0 0 24 24'],
    ['100,000,000 pixels per page', 1, '0 0 2400 2400'],
    ['2,000,000,000 total pixels', 40, '0 0 2400 1200'],
]) {
    rasterTest(`source preflight allows exactly ${boundary}`, async (t) => {
        const dir = await temp(t);
        const sourcePath = join(dir, 'source.pdf');
        const outputPath = join(dir, 'unpublished.pdf');
        const marker = join(dir, 'gs-started');
        await writeFile(sourcePath, simpleSource(Array(pageCount).fill(box)));
        const gsBin = await shim(dir, 'failing-gs', `
            import { appendFileSync } from 'node:fs';
            appendFileSync(${JSON.stringify(marker)}, 'started\\n');
            process.exit(7);
        `);

        await assert.rejects(renderRasterPdf({ sourcePath, outputPath, gsBin }), {
            code: 'RASTER_RENDER_FAILED', message: 'RASTER_RENDER_FAILED',
        }, 'the source must pass preflight and reach the failing Ghostscript shim');
        assert.equal(await readFile(marker, 'utf8'), 'started\n', 'Ghostscript must run exactly once');
        await assert.rejects(lstat(outputPath), { code: 'ENOENT' });
    });
}

rasterTest('pixel, page-count and input file bounds reject before starting Ghostscript', async (t) => {
    const dir = await temp(t);
    const sourcePath = join(dir, 'source.pdf');
    const outputPath = join(dir, 'unpublished.pdf');
    const marker = join(dir, 'gs-started');
    const gsBin = await shim(dir, 'unexpected-gs', `
        import { writeFileSync } from 'node:fs';
        writeFileSync(${JSON.stringify(marker)}, '');
        process.exit(1);
    `);
    for (const boxes of [
        ['0 0 2500 2500'],
        Array(21).fill('0 0 2400 2400'),
        Array(501).fill('0 0 24 24'),
    ]) {
        await writeFile(sourcePath, simpleSource(boxes));
        await assert.rejects(renderRasterPdf({ sourcePath, outputPath, gsBin }), { code: 'RASTER_LIMIT' });
        await assert.rejects(lstat(marker), { code: 'ENOENT' });
    }
    await truncate(sourcePath, 512 * 1024 ** 2 + 1);
    await assert.rejects(renderRasterPdf({ sourcePath, outputPath, gsBin }), { code: 'RASTER_LIMIT' });
    assert.deepEqual((await readdir(dir)).sort(), ['source.pdf', 'unexpected-gs']);
});

rasterTest('process errors and output overruns are sanitized, killed and cleaned', async (t) => {
    const dir = await temp(t);
    const sourcePath = join(dir, 'source.pdf');
    const outputPath = join(dir, 'unpublished.pdf');
    const log = join(dir, 'gs.log');
    await writeFile(sourcePath, simpleSource(['0 0 24 24']));
    for (const [code, body] of [
        ['RASTER_RENDER_FAILED', "writeFileSync(rendered, '%PDF-partial'); process.stderr.write('SYNTHETIC_PRIVATE_DETAIL'); process.exitCode = 7"],
        ['RASTER_LIMIT', "writeFileSync(rendered, ''); truncateSync(rendered, 512 * 1024 ** 2 + 1); setInterval(() => {}, 1000)"],
        ['RASTER_LIMIT', 'setInterval(() => { process.stderr.write(Buffer.alloc(128 * 1024)); }, 10)'],
    ]) {
        const gsBin = await recordingTool(dir, 'fake-gs', log, body);
        await assert.rejects(renderRasterPdf({ sourcePath, outputPath, gsBin }), { code, message: code });
        const { pid } = (await toolLog(log)).at(-1);
        assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
        await assertClean(dir, log, ['source.pdf', 'gs.log', 'fake-gs']);
    }
});

rasterTest('qpdf JSON output above 32 MiB is rejected while the process is running', async (t) => {
    const dir = await temp(t);
    const sourcePath = join(dir, 'source.pdf');
    const outputPath = join(dir, 'unpublished.pdf');
    const log = join(dir, 'qpdf.log');
    await writeFile(sourcePath, simpleSource(['0 0 24 24']));
    const qpdfBin = await recordingTool(dir, 'record-qpdf', log, `
        const chunk = Buffer.alloc(1024 ** 2);
        const write = () => process.stdout.write(chunk, write);
        write();
    `);
    await assert.rejects(renderRasterPdf({ sourcePath, outputPath, qpdfBin }), { code: 'RASTER_LIMIT' });
    const { pid } = (await toolLog(log)).at(-1);
    assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
    await assertClean(dir, log, ['source.pdf', 'qpdf.log', 'record-qpdf']);
});

rasterTest('a hung renderer is killed at the calculated deadline and leaves no partials', async (t) => {
    const dir = await temp(t);
    const sourcePath = join(dir, 'source.pdf');
    const outputPath = join(dir, 'unpublished.pdf');
    const log = join(dir, 'gs.log');
    await writeFile(sourcePath, simpleSource(['0 0 24 24']));
    const gsBin = await recordingTool(dir, 'hung-gs', log, "writeFileSync(rendered, '%PDF-incomplete'); setInterval(() => {}, 1000)");
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const render = renderRasterPdf({ sourcePath, outputPath, gsBin });
    const rejects = assert.rejects(render, { code: 'RASTER_TIMEOUT', message: 'RASTER_TIMEOUT' });
    try {
        const until = Date.now() + 5000;
        while (true) {
            const started = await lstat(log).catch(() => null);
            if (started?.size > 0) break;
            assert.ok(Date.now() < until, 'renderer never reached its hang');
            await new Promise((ready) => realSetTimeout(ready, 10));
        }
        t.mock.timers.tick(34_999);
        const { pid } = (await toolLog(log)).at(-1);
        process.kill(pid, 0);
        t.mock.timers.tick(1);
        await rejects;
        assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
        await assertClean(dir, log, ['source.pdf', 'gs.log', 'hung-gs']);
    } finally {
        t.mock.timers.tick(600_000);
        await rejects;
    }
});
