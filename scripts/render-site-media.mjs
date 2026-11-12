// Renders the website's media (WEB-01, D-184) from the HTML screens in docs/design/site into
// site/assets/media, with Playwright's Chromium: the hero window and the four feature pictures as
// 2x PNGs, and the three videos of "One window" (calls, inbox, notes) as WebM (VP9) and MP4
// (H.264), each with a poster (its first frame) and a still (one frame, for reduced motion).
//
// The site's CSP blocks iframes (frame-src 'none'), so the live screens of the design became files.
// The videos keep the screens' timing exactly: every frame is taken on a virtual clock (Playwright's
// fake timers, and every CSS and Web animation set to the same time), so a slow machine can't drop
// or stretch anything. The WebM is encoded by Playwright's own ffmpeg (VP9 only), the MP4 by the
// browser's WebCodecs H.264 encoder and muxed here; no other tools or dependencies.
//
// Usage: node scripts/render-site-media.mjs [hero] [features] [calls] [inbox] [notes]
// (all by default). FFMPEG=<path> overrides the ffmpeg search.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = fileURLToPath(new URL('..', import.meta.url));
const screens = 'docs/design/site';
const out = join(root, 'site', 'assets', 'media');
const FPS = 60;

const STILLS = {
  hero: [{ src: 'main.html', file: 'hero-window.png', width: 1920, height: 1080 }],
  features: ['shorthand', 'today', 'palette', 'sync'].map((name) => ({
    src: `feature.html#${name}`,
    file: `feature-${name}.png`,
    width: 640,
    height: 400,
  })),
};

/** `still`: the moment (ms) shown under reduced motion, a frame that tells the video's story. */
const VIDEOS = {
  calls: { width: 1440, height: 810, still: 11700 },
  inbox: { width: 1920, height: 1080, still: 9200 },
  notes: { width: 1920, height: 1080, still: 13900 },
};

const TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};

/** The repository over http on localhost: fonts load, and WebCodecs needs a secure context. */
const serve = () =>
  new Promise((resolve) => {
    const server = createServer((request, response) => {
      const path = normalize(
        join(root, decodeURIComponent(new URL(request.url, 'http://x').pathname)),
      );
      if (!path.startsWith(root) || !existsSync(path) || statSync(path).isDirectory()) {
        response.writeHead(404).end();
        return;
      }
      response.writeHead(200, {
        'content-type': TYPES[extname(path)] ?? 'application/octet-stream',
      });
      response.end(readFileSync(path));
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });

/** Playwright's ffmpeg (installed with its browsers), or FFMPEG. */
const findFfmpeg = () => {
  if (process.env.FFMPEG) return process.env.FFMPEG;
  const bases = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'ms-playwright'),
    join(homedir(), '.cache', 'ms-playwright'),
    join(homedir(), 'Library', 'Caches', 'ms-playwright'),
  ].filter(Boolean);
  for (const base of bases) {
    if (!existsSync(base)) continue;
    for (const dir of readdirSync(base)
      .filter((name) => name.startsWith('ffmpeg'))
      .sort()
      .reverse()) {
      for (const exe of ['ffmpeg-win64.exe', 'ffmpeg-linux', 'ffmpeg-mac']) {
        if (existsSync(join(base, dir, exe))) return join(base, dir, exe);
      }
    }
  }
  throw new Error('no ffmpeg: run `npx playwright install ffmpeg`, or set FFMPEG');
};

// ── MP4: a minimal muxer for one H.264 track (moov first, so it streams). ──────────────────────
const u32 = (n) => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n >>> 0);
  return b;
};
const u16 = (n) => {
  const b = Buffer.alloc(2);
  b.writeUInt16BE(n);
  return b;
};
const box = (type, ...parts) => {
  const body = Buffer.concat(parts);
  return Buffer.concat([u32(body.length + 8), Buffer.from(type, 'latin1'), body]);
};
const full = (type, version, flags, ...parts) =>
  box(type, Buffer.from([version, (flags >> 16) & 255, (flags >> 8) & 255, flags & 255]), ...parts);
const MATRIX = Buffer.concat([0x10000, 0, 0, 0, 0x10000, 0, 0, 0, 0x40000000].map(u32));

const muxMp4 = ({ width, height, avcC, samples, keys }) => {
  const scale = FPS * 100;
  const delta = 100;
  const duration = samples.length * delta;
  const movieMs = Math.round((samples.length * 1000) / FPS);
  const moov = (offset) =>
    box(
      'moov',
      full(
        'mvhd',
        0,
        0,
        u32(0),
        u32(0),
        u32(1000),
        u32(movieMs),
        u32(0x10000),
        u16(0x100),
        Buffer.alloc(10),
        MATRIX,
        Buffer.alloc(24),
        u32(2),
      ),
      box(
        'trak',
        full(
          'tkhd',
          0,
          3,
          u32(0),
          u32(0),
          u32(1),
          u32(0),
          u32(movieMs),
          Buffer.alloc(8),
          u16(0),
          u16(0),
          u16(0),
          u16(0),
          MATRIX,
          u32(width << 16),
          u32(height << 16),
        ),
        box(
          'mdia',
          full('mdhd', 0, 0, u32(0), u32(0), u32(scale), u32(duration), u16(0x55c4), u16(0)),
          full(
            'hdlr',
            0,
            0,
            u32(0),
            Buffer.from('vide', 'latin1'),
            Buffer.alloc(12),
            Buffer.from('VideoHandler\0', 'latin1'),
          ),
          box(
            'minf',
            full('vmhd', 0, 1, Buffer.alloc(8)),
            box('dinf', full('dref', 0, 0, u32(1), full('url ', 0, 1))),
            box(
              'stbl',
              full(
                'stsd',
                0,
                0,
                u32(1),
                box(
                  'avc1',
                  Buffer.alloc(6),
                  u16(1),
                  Buffer.alloc(16),
                  u16(width),
                  u16(height),
                  u32(0x480000),
                  u32(0x480000),
                  u32(0),
                  u16(1),
                  Buffer.alloc(32),
                  u16(0x18),
                  u16(0xffff),
                  // The colours are in the stream's own VUI, as the encoder wrote them.
                  box('avcC', avcC),
                ),
              ),
              full('stts', 0, 0, u32(1), u32(samples.length), u32(delta)),
              full('stss', 0, 0, u32(keys.length), ...keys.map((index) => u32(index + 1))),
              full('stsc', 0, 0, u32(1), u32(1), u32(samples.length), u32(1)),
              full('stsz', 0, 0, u32(0), u32(samples.length), ...samples.map((s) => u32(s.length))),
              full('stco', 0, 0, u32(1), u32(offset)),
            ),
          ),
        ),
      ),
    );
  const ftyp = box(
    'ftyp',
    Buffer.from('isom', 'latin1'),
    u32(512),
    Buffer.from('isomiso2avc1mp41', 'latin1'),
  );
  const head = ftyp.length + moov(0).length + 8;
  const data = Buffer.concat(samples);
  return Buffer.concat([
    ftyp,
    moov(head),
    u32(data.length + 8),
    Buffer.from('mdat', 'latin1'),
    data,
  ]);
};

// ── The browser side. ───────────────────────────────────────────────────────────────────────────
/** Puts every CSS and Web animation at the virtual clock's time (paused; finished when done). */
const SYNC_ANIMATIONS = () => {
  const now = performance.now();
  for (const animation of document.getAnimations()) {
    if (animation.__done) continue;
    if (animation.__t0 === undefined) {
      animation.__t0 = now;
      animation.pause();
    }
    const end = animation.effect?.getComputedTiming().endTime ?? Infinity;
    const at = now - animation.__t0;
    if (Number.isFinite(end) && at >= end) {
      animation.__done = true;
      animation.finish();
    } else animation.currentTime = at;
  }
};

/** The H.264 encoder page: frames (JPEG, base64) in, AVCC samples out. */
const ENCODER = {
  start({ width, height, fps }) {
    window.__enc = { samples: [], keys: [], avcC: null, error: null };
    const state = window.__enc;
    state.encoder = new VideoEncoder({
      output: (chunk, meta) => {
        if (meta?.decoderConfig?.description && !state.avcC)
          state.avcC = new Uint8Array(meta.decoderConfig.description);
        if (chunk.type === 'key') state.keys.push(state.samples.length);
        const bytes = new Uint8Array(chunk.byteLength);
        chunk.copyTo(bytes);
        state.samples.push(bytes);
      },
      error: (error) => (state.error = String(error)),
    });
    state.encoder.configure({
      codec: 'avc1.64002a',
      width,
      height,
      framerate: fps,
      bitrate: 8e6,
      bitrateMode: 'variable',
      avc: { format: 'avc' },
      latencyMode: 'quality',
    });
  },
  async frame({ jpeg, index, fps }) {
    const state = window.__enc;
    const bytes = Uint8Array.from(atob(jpeg), (c) => c.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/jpeg' }));
    const frame = new VideoFrame(bitmap, {
      timestamp: Math.round((index * 1e6) / fps),
      duration: Math.round(1e6 / fps),
    });
    state.encoder.encode(frame, { keyFrame: index % (fps * 2) === 0 });
    frame.close();
    bitmap.close();
    while (state.encoder.encodeQueueSize > 4) await new Promise((r) => setTimeout(r, 5));
    if (state.error) throw new Error(state.error);
  },
  async finish() {
    const state = window.__enc;
    await state.encoder.flush();
    const b64 = (bytes) => {
      let s = '';
      for (let i = 0; i < bytes.length; i += 0x8000)
        s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return btoa(s);
    };
    return { avcC: b64(state.avcC), samples: state.samples.map(b64), keys: state.keys };
  },
};

// ── Rendering. ──────────────────────────────────────────────────────────────────────────────────
const wanted = process.argv.slice(2);
const want = (name) => wanted.length === 0 || wanted.includes(name);
mkdirSync(out, { recursive: true });

const server = await serve();
const base = `http://127.0.0.1:${server.address().port}/${screens}/`;
const browser = await chromium.launch();

const ready = (page) =>
  page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(
      [...document.images].map((img) =>
        img.complete ? null : new Promise((r) => (img.onload = img.onerror = r)),
      ),
    );
  });

try {
  for (const group of ['hero', 'features']) {
    if (!want(group)) continue;
    for (const still of STILLS[group]) {
      const page = await browser.newPage({
        viewport: { width: still.width, height: still.height },
        deviceScaleFactor: 2,
      });
      await page.goto(base + still.src);
      await ready(page);
      await page.screenshot({ path: join(out, still.file), animations: 'disabled' });
      console.log(`rendered ${still.file}`);
      await page.close();
    }
  }

  for (const [name, video] of Object.entries(VIDEOS)) {
    if (!want(name)) continue;
    const source = readFileSync(join(root, screens, `${name}.html`), 'utf8');
    // flintPlayer(LEN, …) pads a pass to LEN ms; calls.html has no padding and ends with its script.
    const minimum = Number(/flintPlayer\((\d+)/.exec(source)?.[1] ?? 0);

    const context = await browser.newContext({
      viewport: { width: video.width, height: video.height },
    });
    // Installed, the clock still flows in real time; paused, it moves only with runFor below.
    await context.clock.install({ time: new Date('2026-03-10T10:00:00') });
    await context.clock.pauseAt(new Date('2026-03-10T10:00:01'));
    // As in the site's iframe: one pass, and 'flint-done' at its end (window.parent is [Replaceable]).
    await context.addInitScript(() => {
      window.parent = {
        postMessage: (message) => {
          if (message === 'flint-done') window.__flintDone = performance.now();
        },
      };
    });
    const page = await context.newPage();
    await page.goto(base + `${name}.html`);
    await ready(page);
    const t0 = await page.evaluate(() => performance.now());

    const encoderPage = await browser.newPage();
    await encoderPage.goto(base + 'main.html');
    await encoderPage.evaluate(ENCODER.start, {
      width: video.width,
      height: video.height,
      fps: FPS,
    });

    const webm = join(out, `${name}.webm`);
    const ffmpeg = spawn(
      findFfmpeg(),
      [
        '-y',
        '-loglevel',
        'error',
        '-f',
        'image2pipe',
        '-framerate',
        String(FPS),
        '-c:v',
        'mjpeg',
        '-i',
        'pipe:0',
        // 10-bit VP9 (profile 2), BT.601 matrix, sRGB transfer: the one combination that decodes in
        // Chromium to the page's own greys (#0D0E10 stays 13,14,16; 8-bit or BT.709 drift by 1-3 levels).
        '-vf',
        'scale=in_range=full:out_range=tv:in_color_matrix=bt601:out_color_matrix=bt601,format=yuv420p10le',
        '-color_range',
        'tv',
        '-colorspace',
        'smpte170m',
        '-color_primaries',
        'bt709',
        '-color_trc',
        'iec61966-2-1',
        '-c:v',
        'libvpx-vp9',
        '-crf',
        '26',
        '-b:v',
        '0',
        '-deadline',
        'good',
        '-cpu-used',
        '1',
        '-row-mt',
        '1',
        '-g',
        String(FPS * 2),
        '-an',
        webm,
      ],
      { stdio: ['pipe', 'inherit', 'inherit'] },
    );
    const encoded = new Promise((resolve, reject) => {
      ffmpeg.on('error', reject);
      ffmpeg.on('close', (code) =>
        code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`)),
      );
    });

    let index = 0;
    let elapsed = 0;
    for (;;) {
      await page.evaluate(SYNC_ANIMATIONS);
      const jpeg = await page.screenshot({ type: 'jpeg', quality: 100 });
      if (!ffmpeg.stdin.write(jpeg)) await new Promise((r) => ffmpeg.stdin.once('drain', r));
      await encoderPage.evaluate(ENCODER.frame, { jpeg: jpeg.toString('base64'), index, fps: FPS });
      if (index === 0)
        await page.screenshot({ path: join(out, `${name}-poster.jpg`), type: 'jpeg', quality: 88 });
      if (Math.abs(elapsed - video.still) < 1000 / FPS / 2)
        await page.screenshot({ path: join(out, `${name}-still.jpg`), type: 'jpeg', quality: 88 });

      const done = await page.evaluate(() => window.__flintDone);
      // The last frame is the one at the end of the pass (or of its padding).
      if (done !== undefined && elapsed >= Math.max(minimum, done - t0)) break;
      index += 1;
      const next = Math.round((index * 1000) / FPS);
      await page.clock.runFor(next - elapsed);
      elapsed = next;
      if (elapsed > 60000) throw new Error(`${name}: no 'flint-done' within a minute`);
    }
    ffmpeg.stdin.end();
    await encoded;

    const result = await encoderPage.evaluate(ENCODER.finish);
    const mp4 = muxMp4({
      width: video.width,
      height: video.height,
      avcC: Buffer.from(result.avcC, 'base64'),
      samples: result.samples.map((s) => Buffer.from(s, 'base64')),
      keys: result.keys,
    });
    writeFileSync(join(out, `${name}.mp4`), mp4);
    console.log(`rendered ${name}: ${index + 1} frames, ${((index + 1) / FPS).toFixed(3)} s`);
    await encoderPage.close();
    await context.close();
  }
} finally {
  await browser.close();
  server.close();
}
