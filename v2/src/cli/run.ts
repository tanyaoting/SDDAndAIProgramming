import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dayKey, dayWindow, systemClock } from '../clock.js';
import { loadConfig, loadKeywordRules, loadWorkBlocks } from '../config.js';
import { applyEnvFile } from '../env-file.js';
import { exitCode, SdrError } from '../errors.js';
import { collectFeishu } from '../collectors/feishu.js';
import { collectGithub } from '../collectors/github.js';
import { collectLocal } from '../collectors/local.js';
import { createHttpClient } from '../http.js';
import { createRepo } from '../store/repo.js';
import { openDatabase } from '../store/db.js';
import { flagBoolean, flagString, parseArgv } from './argv.js';
import { runCollect, type CollectOptions } from './collect.js';
import { runEdit, type EditOptions } from './edit.js';
import { runGenerate } from './generate.js';
import { runHistory } from './history.js';
import { runPush, type PushOptions } from './push.js';
import { createServeContext, startServeLoop } from './serve.js';
import { EXIT, type ExitCode } from './exit.js';

const configDir = join(dirname(fileURLToPath(import.meta.url)), '../../config');

function collectSources(argv: readonly string[]): Array<'github' | 'feishu' | 'local' | 'manual'> {
  const out: Array<'github' | 'feishu' | 'local' | 'manual'> = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--source') {
      const next = argv[i + 1];
      if (next !== undefined) out.push(next as 'github' | 'feishu' | 'local' | 'manual');
      i += 1;
    }
  }
  return out;
}

export async function runCli(argv: readonly string[]): Promise<ExitCode> {
  const parsed = parseArgv(argv);
  const command = parsed.command;
  if (command === undefined) {
    process.stderr.write('用法：sdr <collect|generate|edit|push|history|serve> [options]\n');
    return EXIT.USAGE;
  }

  const envPath = flagString(parsed.flags, 'env-file') ?? join(dirname(fileURLToPath(import.meta.url)), '../..', '.env');
  const env = applyEnvFile(envPath, { ...process.env });
  const notifyTo = env.SDR_NOTIFY_TO;

  let config;
  let db;
  let repo;
  const clock = systemClock;

  try {
    config = loadConfig(env);
    db = openDatabase(config.dbPath);
    repo = createRepo(db, clock);
  } catch (error) {
    if (error instanceof SdrError && error.code.startsWith('SDR-E3')) {
      return EXIT.CONFIG;
    }
    throw error;
  }

  const rules = loadKeywordRules(join(configDir, 'keywords.yaml'));
  const blocks = loadWorkBlocks(join(configDir, 'work-hours.yaml'));

  const date = flagString(parsed.flags, 'date') ?? dayKey(clock, clock.now());

  switch (command) {
    case 'collect': {
      const sourceList = collectSources(argv);
      const selected =
        sourceList.length > 0
          ? sourceList
          : (['github', 'feishu', 'local'] as const);
      const member = repo.listActiveMembers()[0];
      const memberId = member?.id ?? 1;
      const { since, until } = dayWindow(clock, date);
      const runId = `cli-collect-${date}`;
      const http = createHttpClient();
      const githubRepo = env.SDR_GITHUB_REPO ?? 'acme/sdr';
      const localRoot = env.SDR_LOCAL_ROOT ?? process.cwd();
      const tokenPath = env.SDR_FEISHU_TOKEN_PATH;

      let feishuToken = '';
      if (tokenPath) {
        const { readFileSync } = await import('node:fs');
        try {
          const raw = JSON.parse(readFileSync(tokenPath, 'utf8')) as { access_token?: string };
          feishuToken = raw.access_token ?? '';
        } catch {
          feishuToken = '';
        }
      }

      const manualText = flagString(parsed.flags, 'manual');
      const manualRef = flagString(parsed.flags, 'ref');
      const collectOpts: CollectOptions = {
        date,
        sources: [...selected],
        memberId,
        ...(manualText === undefined ? {} : { manualText }),
        ...(manualRef === undefined ? {} : { manualRef }),
      };

      return runCollect(
        { repo, clock, config, ...(notifyTo === undefined ? {} : { notifyTo }) },
        collectOpts,
        {
          github: () =>
            collectGithub({
              repo: githubRepo,
              since,
              until,
              token: config.github.token,
              clock,
              memberId,
              runId,
              http,
            }),
          feishu: () =>
            collectFeishu({
              since,
              until,
              token: feishuToken || config.feishu.appSecret,
              clock,
              memberId,
              runId,
              http,
            }),
          local: () =>
            collectLocal({ rootDir: localRoot, since, until, clock, memberId, runId }),
        },
      );
    }
    case 'generate': {
      const memberRaw = flagString(parsed.flags, 'member');
      return runGenerate(
        { repo, clock, rules, blocks },
        {
          date,
          ...(memberRaw === undefined ? {} : { memberId: Number(memberRaw) }),
          ...(flagBoolean(parsed.flags, 'force') ? { force: true } : {}),
        },
      );
    }
    case 'edit': {
      const memberRaw = flagString(parsed.flags, 'member');
      if (memberRaw === undefined) return EXIT.USAGE;
      const removeRaw = flagString(parsed.flags, 'remove-entry');
      const addText = flagString(parsed.flags, 'add-text');
      const addRef = flagString(parsed.flags, 'ref');
      const editOpts: EditOptions = {
        date,
        memberId: Number(memberRaw),
        ...(addText === undefined ? {} : { addText }),
        ...(addRef === undefined ? {} : { addRef }),
        ...(removeRaw === undefined ? {} : { removeEntry: Number(removeRaw) }),
        ...(flagBoolean(parsed.flags, 'accept-attribution')
          ? {
              acceptAttribution: true,
              ...(flagBoolean(parsed.flags, 'all') ? { acceptAll: true } : {}),
            }
          : {}),
      };
      return runEdit(repo, editOpts);
    }
    case 'push': {
      const cliTo = flagString(parsed.flags, 'to');
      const pushOpts: PushOptions = {
        date,
        ...(flagBoolean(parsed.flags, 'dry-run') ? { dryRun: true } : {}),
        ...(cliTo === undefined ? {} : { to: cliTo }),
      };
      return runPush(
        {
          repo,
          clock,
          config,
          ...(notifyTo === undefined ? {} : { notifyTo }),
        },
        pushOpts,
      );
    }
    case 'history': {
      const memberRaw = flagString(parsed.flags, 'member');
      const from = flagString(parsed.flags, 'from');
      const to = flagString(parsed.flags, 'to');
      const actorRaw = flagString(parsed.flags, 'actor') ?? memberRaw;
      if (memberRaw === undefined || from === undefined || to === undefined || actorRaw === undefined) {
        return EXIT.USAGE;
      }
      return runHistory(repo, {
        actor: Number(actorRaw),
        member: Number(memberRaw),
        from,
        to,
      });
    }
    case 'serve': {
      const handle = startServeLoop(
        createServeContext(repo, clock, config, notifyTo),
        { tickMs: 30_000 },
      );
      await new Promise<void>((resolve) => {
        process.on('SIGINT', () => {
          handle.stop();
          resolve();
        });
      });
      return EXIT.OK;
    }
    default:
      return EXIT.USAGE;
  }
}

export async function cliMain(argv: readonly string[]): Promise<void> {
  try {
    const code = await runCli(argv);
    process.exitCode = code;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = error instanceof SdrError ? exitCode(error) : EXIT.UNEXPECTED;
  }
}