const assert = require('node:assert/strict');
const { test } = require('node:test');
const { spawnSync } = require('node:child_process');
const { createServer } = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
require('ts-node/register/transpile-only');
const { getFFmpegBinary } = require('../src/utils/ffmpeg');

// Load only the audio preparation path without database or Discord login side effects.
const filename = path.resolve(__dirname, '../src/services/voicePlaybackService.ts');
const source = fs.readFileSync(filename, 'utf8') + '\nexport { resourceFromUrl };';
const compiled = require('typescript').transpileModule(source, {
    compilerOptions: { module: 1, target: 9, esModuleInterop: true },
}).outputText;
const isolated = new Module(filename, module);
isolated.filename = filename;
isolated.paths = Module._nodeModulePaths(path.dirname(filename));
const originalRequire = isolated.require.bind(isolated);
isolated.require = name => {
    if (name === '../utils/logger') return { logger: { warn() {}, info() {}, error() {} } };
    if (name === './blacklistService' || name === './auditLogService') return {};
    return originalRequire(name);
};
isolated._compile(compiled, filename);
const { resourceFromUrl } = isolated.exports;

test('invalid explicit FFmpeg path fails with a host configuration error', { concurrency: false }, () => {
    const result = spawnSync(process.execPath, ['-r', 'ts-node/register/transpile-only', '-e',
        "require('./src/utils/ffmpeg').getFFmpegBinary()"], {
        cwd: path.resolve(__dirname, '..'), encoding: 'utf8',
        env: { ...process.env, FFMPEG_PATH: path.join(__dirname, 'missing-ffmpeg') },
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /check FFMPEG_PATH/);
});

test('bundled or PATH FFmpeg decodes HTTP audio and rejects invalid audio', { concurrency: false }, async () => {
    const sample = spawnSync(getFFmpegBinary(), [
        '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.2',
        '-f', 'mp3', 'pipe:1',
    ]);
    assert.equal(sample.status, 0);
    const server = createServer((req, res) => {
        res.end(req.url === '/valid.mp3' ? sample.stdout : Buffer.from('not audio'));
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
        const prepared = await resourceFromUrl(`${base}/valid.mp3`, 'test');
        assert.ok(prepared.resource);
        assert.ok(prepared.transcoder);
        const transformers = prepared.resource.edges.map(edge => edge.transformer.constructor.name);
        assert.ok(!transformers.includes('Encoder'), `unexpected Opus encoder: ${transformers.join(', ')}`);
        prepared.resource.playStream.destroy();
        prepared.transcoder.kill();
        await assert.rejects(resourceFromUrl(`${base}/invalid.mp3`, 'invalid'), /produced no audio/);
    } finally {
        await new Promise(resolve => server.close(resolve));
    }
});
