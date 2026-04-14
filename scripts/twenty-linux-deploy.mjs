import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const CONFIG_PATH = path.join(os.homedir(), '.twenty', 'config.json');
const OUTPUT_DIR = path.join(process.cwd(), '.twenty', 'output');
const ROLE_PERMISSION_NAMESPACE = 'b403ec59-4d80-4f22-85e6-717a192dc9cb';

const toPosixPath = (value) => value.replaceAll('\\', '/');

const uuidToBytes = (value) => {
  const normalized = value.replaceAll('-', '');

  return Uint8Array.from(
    normalized.match(/.{1,2}/g).map((chunk) => Number.parseInt(chunk, 16)),
  );
};

const createDeterministicUuid = (namespace, value) => {
  const namespaceBytes = uuidToBytes(namespace);
  const valueBytes = new TextEncoder().encode(value);
  const hash = createHash('sha1')
    .update(namespaceBytes)
    .update(valueBytes)
    .digest();
  const bytes = Uint8Array.from(hash.subarray(0, 16));

  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');

  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

export const createMetadataHeaders = ({ apiKey, body }) => ({
  ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
  ...(typeof body === 'string' ? { 'Content-Type': 'application/json' } : {}),
  Accept: '*/*',
});

export const normalizeManifestPaths = (manifest) => ({
  ...manifest,
  roles: (manifest.roles ?? []).map((role) => ({
    ...role,
    permissionFlags: (role.permissionFlags ?? []).map((permissionFlag) =>
      typeof permissionFlag === 'string'
        ? {
            universalIdentifier: createDeterministicUuid(
              ROLE_PERMISSION_NAMESPACE,
              `${role.universalIdentifier}:${permissionFlag}`,
            ),
            flag: permissionFlag,
          }
        : permissionFlag,
    ),
  })),
  logicFunctions: (manifest.logicFunctions ?? []).map((logicFunction) => ({
    ...logicFunction,
    sourceHandlerPath: toPosixPath(logicFunction.sourceHandlerPath),
    builtHandlerPath: toPosixPath(logicFunction.builtHandlerPath),
  })),
  frontComponents: (manifest.frontComponents ?? []).map((frontComponent) => ({
    ...frontComponent,
    sourceComponentPath: toPosixPath(frontComponent.sourceComponentPath),
    builtComponentPath: toPosixPath(frontComponent.builtComponentPath),
  })),
  publicAssets: (manifest.publicAssets ?? []).map((publicAsset) => ({
    ...publicAsset,
    filePath: toPosixPath(publicAsset.filePath),
  })),
});

const formatValidationBucket = (bucketName, bucketErrors) => {
  const bucketLines = bucketErrors.flatMap((entry) => {
    const entity =
      entry.flatEntityMinimalInformation?.name ??
      entry.flatEntityMinimalInformation?.universalIdentifier ??
      'unknown';
    const messages = (entry.errors ?? []).map(
      (error) => `    - ${error.code ?? 'UNKNOWN'}: ${error.message}`,
    );

    return [`  ${bucketName}: ${entity}`, ...messages];
  });

  return bucketLines.join('\n');
};

export const formatGraphqlErrors = (errors) =>
  errors
    .map((error) => {
      const lines = [error.message ?? 'Unknown GraphQL error'];

      if (error.extensions?.code) {
        lines.push(`code: ${error.extensions.code}`);
      }

      if (error.extensions?.summary) {
        lines.push(
          `summary: ${JSON.stringify(error.extensions.summary)}`,
        );
      }

      if (error.extensions?.errors) {
        const buckets = Object.entries(error.extensions.errors).flatMap(
          ([bucketName, bucketErrors]) =>
            Array.isArray(bucketErrors) && bucketErrors.length > 0
              ? [formatValidationBucket(bucketName, bucketErrors)]
              : [],
        );

        if (buckets.length > 0) {
          lines.push('details:');
          lines.push(...buckets);
        }
      }

      return lines.join('\n');
    })
    .join('\n\n');

const parseArgs = (argv) => {
  const args = {
    install: false,
    remote: undefined,
    apiUrl: undefined,
    apiKey: undefined,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === '--install') {
      args.install = true;
      continue;
    }

    if (token === '--remote' && argv[index + 1]) {
      args.remote = argv[index + 1];
      index += 1;
      continue;
    }

    if (token === '--api-url' && argv[index + 1]) {
      args.apiUrl = argv[index + 1];
      index += 1;
      continue;
    }

    if (token === '--api-key' && argv[index + 1]) {
      args.apiKey = argv[index + 1];
      index += 1;
    }
  }

  return args;
};

const printHelp = () => {
  console.log(`Usage: node scripts/twenty-linux-deploy.mjs [options]

Options:
  --remote <name>    Use a remote from ~/.twenty/config.json
  --api-url <url>    Target Twenty server URL
  --api-key <key>    Target Twenty API key
  --install          Install the uploaded app after upload
  --help             Show this help message
`);
};

const getActiveRemoteName = async (requestedRemote) => {
  if (requestedRemote) {
    return requestedRemote;
  }

  try {
    const rawConfig = JSON.parse(await readFile(CONFIG_PATH, 'utf8'));

    return rawConfig.defaultRemote ?? 'local';
  } catch {
    return 'local';
  }
};

const getRemoteConfig = async (requestedRemote) => {
  const remoteName = await getActiveRemoteName(requestedRemote);

  try {
    const rawConfig = JSON.parse(await readFile(CONFIG_PATH, 'utf8'));
    const remote = rawConfig.remotes?.[remoteName];

    if (!remote?.apiUrl) {
      throw new Error(`Remote "${remoteName}" not found in ${CONFIG_PATH}`);
    }

    return {
      remoteName,
      apiUrl: remote.apiUrl,
      apiKey:
        remote.apiKey ??
        remote.appAccessToken ??
        remote.twentyCLIAccessToken ??
        undefined,
    };
  } catch (error) {
    throw new Error(
      error instanceof Error
        ? error.message
        : `Failed to load remote config from ${CONFIG_PATH}`,
    );
  }
};

const runOrThrow = (command, args, options = {}) => {
  const result = spawnSync(command, args, {
    shell: process.platform === 'win32',
    stdio: 'inherit',
    ...options,
  });

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}`);
  }
};

const getYarnCommand = () => (process.platform === 'win32' ? 'yarn.cmd' : 'yarn');

const runShellOrThrow = (command, options = {}) => {
  const shell = process.env.SHELL || (process.platform === 'win32' ? 'cmd.exe' : '/bin/zsh');
  const args =
    process.platform === 'win32'
      ? ['/d', '/s', '/c', command]
      : ['-lc', command];
  const result = spawnSync(shell, args, {
    stdio: 'inherit',
    ...options,
  });

  if (result.status !== 0) {
    throw new Error(`${command} failed with exit code ${result.status}`);
  }
};

const createFixedTarball = async () => {
  runShellOrThrow(`${getYarnCommand()} twenty build --tarball`);

  const manifestPath = path.join(OUTPUT_DIR, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const normalizedManifest = normalizeManifestPaths(manifest);
  const outputEntries = spawnSync(
    process.platform === 'win32' ? 'cmd' : 'find',
    process.platform === 'win32'
      ? ['/c', `dir /b "${OUTPUT_DIR}\\*.tgz"`]
      : [OUTPUT_DIR, '-maxdepth', '1', '-name', '*.tgz'],
    {
      shell: process.platform === 'win32',
      encoding: 'utf8',
    },
  );

  if (outputEntries.status !== 0) {
    throw new Error('Failed to locate generated Twenty tarball');
  }

  const tarballCandidates = outputEntries.stdout
    .split('\n')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) =>
      path.isAbsolute(entry) ? entry : path.join(OUTPUT_DIR, path.basename(entry)),
    )
    .filter((entry) => entry.endsWith('.tgz'));

  const fixedTarballPath =
    tarballCandidates.find((entry) => !entry.endsWith('-linux.tgz')) ??
    tarballCandidates[0];

  if (!fixedTarballPath) {
    throw new Error('Twenty build succeeded but no tarball was generated');
  }

  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'twenty-linux-deploy-'));

  try {
    runOrThrow('tar', ['-xzf', fixedTarballPath, '-C', tempDir]);
    await writeFile(
      path.join(tempDir, 'package', 'manifest.json'),
      JSON.stringify(normalizedManifest, null, 2),
    );

    const normalizedTarballPath = fixedTarballPath.replace(/\.tgz$/, '-linux.tgz');
    runOrThrow('tar', ['-czf', normalizedTarballPath, '-C', tempDir, 'package']);

    return {
      fixedTarballPath: normalizedTarballPath,
      normalizedManifest,
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
};

const postMetadata = async ({ apiUrl, apiKey, body }) => {
  const response = await fetch(`${apiUrl.replace(/\/$/, '')}/metadata`, {
    method: 'POST',
    headers: createMetadataHeaders({ apiKey, body }),
    body,
  });

  const responseText = await response.text();
  const payload = responseText.length > 0 ? JSON.parse(responseText) : null;

  if (!response.ok || payload?.errors) {
    const formattedErrors =
      payload?.errors && payload.errors.length > 0
        ? formatGraphqlErrors(payload.errors)
        : null;

    throw new Error(
      formattedErrors ??
        `Metadata request failed with status ${response.status}`,
    );
  }

  return payload?.data ?? null;
};

const uploadTarball = async ({ apiUrl, apiKey, tarballPath }) => {
  const tarballBuffer = await readFile(tarballPath);
  const formData = new FormData();

  formData.append(
    'operations',
    JSON.stringify({
      query: `
        mutation UploadAppTarball($file: Upload!, $universalIdentifier: String) {
          uploadAppTarball(file: $file, universalIdentifier: $universalIdentifier) {
            id
            universalIdentifier
            name
          }
        }
      `,
      variables: {
        file: null,
        universalIdentifier: null,
      },
    }),
  );
  formData.append('map', JSON.stringify({ 0: ['variables.file'] }));
  formData.append(
    '0',
    new Blob([new Uint8Array(tarballBuffer)], { type: 'application/gzip' }),
    path.basename(tarballPath),
  );

  const data = await postMetadata({
    apiUrl,
    apiKey,
    body: formData,
  });

  return data.uploadAppTarball;
};

const installTarballApp = async ({ apiUrl, apiKey, universalIdentifier }) => {
  const data = await postMetadata({
    apiUrl,
    apiKey,
    body: JSON.stringify({
      query: `
        mutation InstallMarketplaceApp($universalIdentifier: String!) {
          installMarketplaceApp(universalIdentifier: $universalIdentifier)
        }
      `,
      variables: {
        universalIdentifier,
      },
    }),
  });

  return data?.installMarketplaceApp ?? true;
};

const main = async () => {
  if (process.argv.includes('--help')) {
    printHelp();

    return;
  }

  const args = parseArgs(process.argv.slice(2));
  const remoteConfig =
    args.apiUrl && args.apiKey
      ? {
          remoteName: 'direct',
          apiUrl: args.apiUrl,
          apiKey: args.apiKey,
        }
      : await getRemoteConfig(args.remote);

  if (!remoteConfig.apiKey) {
    throw new Error(
      `Remote "${remoteConfig.remoteName}" does not have an API key. Re-run "yarn twenty remote add" with --api-key or pass --api-url/--api-key directly.`,
    );
  }

  const { fixedTarballPath, normalizedManifest } = await createFixedTarball();

  console.log(`Using remote: ${remoteConfig.remoteName}`);
  console.log(`Uploading fixed tarball: ${fixedTarballPath}`);

  const uploadResult = await uploadTarball({
    apiUrl: remoteConfig.apiUrl,
    apiKey: remoteConfig.apiKey,
    tarballPath: fixedTarballPath,
  });

  console.log(
    `Uploaded application ${uploadResult.name} (${uploadResult.universalIdentifier})`,
  );

  if (args.install) {
    console.log('Installing uploaded application...');

    await installTarballApp({
      apiUrl: remoteConfig.apiUrl,
      apiKey: remoteConfig.apiKey,
      universalIdentifier: normalizedManifest.application.universalIdentifier,
    });

    console.log('Install completed successfully');
  }
};

const isCliEntry =
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isCliEntry) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
