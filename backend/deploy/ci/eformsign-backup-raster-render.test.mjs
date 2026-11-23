import assert from 'node:assert/strict';
import { execFile, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { link, lstat, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, truncate, writeFile } from 'node:fs/promises';
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
        const documentArgs = args.filter((arg) => arg.startsWith('/') || arg.startsWith('-sOutputFile='));
        if (${JSON.stringify(name)} === 'record-qpdf') {
            assert.deepEqual(documentArgs, [args.at(-1)]);
            assert.ok([source, rendered].includes(args.at(-1)));
        } else {
            assert.deepEqual(documentArgs, ['-sOutputFile=' + rendered, source]);
            for (const flag of ['-dSAFER', '-dPrinted=false', '-dShowAnnots=true', '-r300']) {
                assert.ok(args.includes(flag));
            }
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
        width = 100, height = 100, media = [24, 24], draw = true, bytes,
        colorSpace = '/DeviceRGB', bitsPerComponent = 8, asciiHexImage = false, linkAnnotation = false,
        imageEntries = '', contentLengthHint = false, resourceEntries = '',
    }) => {
        const pixels = Buffer.alloc(bytes ?? width * height * 3, 255);
        const filter = asciiHexImage ? '/ASCIIHexDecode' : '/FlateDecode';
        const encodedPixels = asciiHexImage ? `${pixels.toString('hex')}>` : deflateSync(pixels);
        const image = pdf.add(pdfStream(`/Subtype /Image /ColorSpace ${colorSpace} /BitsPerComponent ${bitsPerComponent}
            /Width ${width} /Height ${height} /Filter ${filter} ${imageEntries}`, encodedPixels));
        const [pageWidth, pageHeight] = media;
        const painting = draw ? `${pageWidth} 0 0 ${pageHeight} 0 0 cm\n/Im1 Do` : '0 0 m 24 24 l S';
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
