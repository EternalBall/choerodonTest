import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import YAML from 'yaml';
import {
  ataRoot,
  confirmAtaVersion,
  listAtaVersions,
  loadAtaVersion,
  nextAtaVersion,
} from '../../src/compare/ataStore.js';
import type { FeatureArtifact } from '../../src/core/schema.js';

/** 最小合法 feature.yaml（构造方式参考 compileFlows.test.ts 的 baseArtifact） */
function minimalArtifact(): FeatureArtifact {
  return {
    feature: '字段配置',
    entry: { route: '/tarzan/problem-field-config' },
    pages: [
      { id: 'config', name: '字段配置', route: '/tarzan/problem-field-config', scope: 'in_feature' },
    ],
    operations: [
      {
        id: 'query',
        name: '查询',
        type: 'query',
        page_id: 'config',
        fields: ['fieldType'],
        api: '/v1/{tenantId}/tree/ui',
      },
    ],
    sources: [],
    confidence: 0.8,
  };
}

const sha = (buf: Buffer | string) => createHash('sha256').update(buf).digest('hex');

describe('ataStore', () => {
  let tmp: string;
  let artifactFile: string;
  let suiteFile: string;
  const featureDir = 'src/features/field';

  const confirm = (note?: string, dir = featureDir) =>
    confirmAtaVersion({
      projectRoot: path.join(tmp, 'proj'),
      featureDir: dir,
      slug: 'field-config',
      feature: '字段配置',
      artifactFile,
      suiteFile,
      note,
    });

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'ata-store-'));
    await fs.mkdir(path.join(tmp, 'proj'), { recursive: true });
    artifactFile = path.join(tmp, 'feature.yaml');
    suiteFile = path.join(tmp, 'suite.yaml');
    await fs.writeFile(artifactFile, YAML.stringify(minimalArtifact()), 'utf8');
    await fs.writeFile(suiteFile, YAML.stringify({
        suite: 's',
        cases: [{ id: 'c1', title: 't', steps: [{ name: 'n', action: 'goto', args: {} }] }],
      }), 'utf8');
  });

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('first confirm creates V1 with manifests and README', async () => {
    const res = await confirm('首次');
    const root = ataRoot(path.join(tmp, 'proj'), featureDir);
    assert.equal(res.version, 'V1');
    assert.equal(res.root, root);
    assert.deepEqual(await listAtaVersions(root), ['V1']);
    for (const f of ['feature.yaml', 'suite.yaml', 'manifest.yaml']) {
      await fs.access(path.join(root, 'V1', f));
    }
    await fs.access(path.join(root, 'README.md'));
    const rootManifest = YAML.parse(await fs.readFile(path.join(root, 'manifest.yaml'), 'utf8'));
    assert.equal(rootManifest.latest, 'V1');
    assert.equal(rootManifest.versions.V1.note, '首次');
    assert.ok(rootManifest.versions.V1.confirmed_at);
  });

  it('second confirm creates V2 and leaves V1 untouched', async () => {
    await confirm();
    const root = ataRoot(path.join(tmp, 'proj'), featureDir);
    const v1Before = await fs.readFile(path.join(root, 'V1', 'feature.yaml'));
    const v1ManifestBefore = await fs.readFile(path.join(root, 'V1', 'manifest.yaml'));

    await fs.writeFile(
      artifactFile,
      YAML.stringify({ ...minimalArtifact(), confidence: 0.5 }),
      'utf8',
    );
    const res = await confirm();
    assert.equal(res.version, 'V2');
    assert.deepEqual(await listAtaVersions(root), ['V1', 'V2']);
    assert.deepEqual(await fs.readFile(path.join(root, 'V1', 'feature.yaml')), v1Before);
    assert.deepEqual(await fs.readFile(path.join(root, 'V1', 'manifest.yaml')), v1ManifestBefore);
    const rootManifest = YAML.parse(await fs.readFile(path.join(root, 'manifest.yaml'), 'utf8'));
    assert.equal(rootManifest.latest, 'V2');
    assert.deepEqual(Object.keys(rootManifest.versions), ['V1', 'V2']);
  });

  it('listAtaVersions sorts numerically and ignores non-V dirs', async () => {
    const root = path.join(tmp, 'ata');
    for (const d of ['V10', 'V2', 'V1', 'v3', 'Vx', 'tmp']) {
      await fs.mkdir(path.join(root, d), { recursive: true });
    }
    await fs.writeFile(path.join(root, 'V5'), 'file', 'utf8');
    assert.deepEqual(await listAtaVersions(root), ['V1', 'V2', 'V10']);
    assert.equal(await nextAtaVersion(root), 'V11');
    assert.deepEqual(await listAtaVersions(path.join(tmp, 'missing')), []);
  });

  it('manifest records correct sha256 and counts', async () => {
    const res = await confirm();
    const m = YAML.parse(await fs.readFile(path.join(res.dir, 'manifest.yaml'), 'utf8'));
    assert.equal(m.version, 'V1');
    assert.equal(m.slug, 'field-config');
    assert.equal(m.operations, 1);
    assert.equal(m.field_facts, 0);
    assert.equal(m.meta_ops, 0);
    assert.equal(m.flows, 0);
    const byName = Object.fromEntries(
      m.files.map((f: { name: string; sha256: string }) => [f.name, f.sha256]),
    );
    assert.equal(byName['feature.yaml'], sha(await fs.readFile(artifactFile)));
    assert.equal(byName['suite.yaml'], sha(await fs.readFile(suiteFile)));
  });

  it('loadAtaVersion defaults to latest and accepts explicit version', async () => {
    await confirm();
    await fs.writeFile(
      artifactFile,
      YAML.stringify({ ...minimalArtifact(), confidence: 0.5 }),
      'utf8',
    );
    await confirm();
    const root = ataRoot(path.join(tmp, 'proj'), featureDir);
    const latest = await loadAtaVersion(root);
    assert.equal(latest.version, 'V2');
    assert.equal(latest.artifact.confidence, 0.5);
    assert.ok(latest.suite);
    const v1 = await loadAtaVersion(root, 'V1');
    assert.equal(v1.artifact.confidence, 0.8);
    await assert.rejects(() => loadAtaVersion(root, 'V9'));
  });

  it('relative and absolute featureDir resolve to the same root', async () => {
    const proj = path.join(tmp, 'proj');
    assert.equal(
      ataRoot(proj, featureDir),
      ataRoot(proj, path.join(proj, featureDir)),
    );
    const a = await confirm(undefined, featureDir);
    const b = await confirm(undefined, path.join(proj, featureDir));
    assert.equal(a.root, b.root);
    assert.deepEqual(await listAtaVersions(a.root), ['V1', 'V2']);
  });
});
