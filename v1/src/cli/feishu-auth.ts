import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { buildAuthorizeUrl, exchangeCode, fetchUserInfo } from '../collectors/feishu-oauth.js';
import type { FeishuUserInfo, FeishuUserToken } from '../collectors/feishu-oauth.js';
import { ERROR_CODES, SdrError } from '../errors.js';
import { FeishuTokenStore, resolveTokenFilePath } from '../feishu-tokens.js';
import type { FeishuTokenRecord } from '../feishu-tokens.js';
import type { ParsedArgs } from './args.js';
import { UsageError, flagValue, requireMemberId } from './args.js';
import type { CliContext } from './context.js';

/**
 * `sdr feishu-auth --member <id> [--port 8787]`：本地起回调服务完成飞书用户授权，
 * 换取 user_access_token 并绑定 member.feishu_open_id。
 * 需在开发者后台「安全设置 → 重定向 URL」登记同一个回调地址。
 */

const DEFAULT_PORT = 8787;
const DEFAULT_TIMEOUT_MS = 300_000;

export interface FeishuAuthHooks {
  /** 测试注入：回调服务就绪后拿到真实地址，避免猜测端口。 */
  readonly onReady?: (info: {
    readonly authorizeUrl: string;
    readonly redirectUri: string;
    readonly port: number;
    readonly state: string;
  }) => void;
  readonly timeoutMs?: number;
}

interface RedirectTarget {
  readonly explicit: string | undefined;
  readonly port: number;
}

function resolveRedirect(env: Record<string, string | undefined>, portFlag: string | undefined): RedirectTarget {
  const configured = (env.SDR_FEISHU_REDIRECT_URI ?? '').trim();
  if (configured !== '') {
    let parsed: URL;
    try {
      parsed = new URL(configured);
    } catch {
      throw new UsageError(`SDR_FEISHU_REDIRECT_URI 非法：${configured}`);
    }
    const port = parsed.port === '' ? (parsed.protocol === 'https:' ? 443 : 80) : Number(parsed.port);
    return { explicit: configured, port };
  }
  const port = portFlag === undefined ? DEFAULT_PORT : Number(portFlag);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new UsageError(`端口非法：${portFlag ?? '(缺失)'}`);
  }
  return { explicit: undefined, port };
}

function page(title: string, detail: string): string {
  return [
    '<!doctype html><meta charset="utf-8">',
    `<title>${title}</title>`,
    '<body style="font-family:system-ui;padding:48px;line-height:1.6">',
    `<h1>${title}</h1><p>${detail}</p></body>`,
  ].join('');
}

function respond(response: ServerResponse, status: number, title: string, detail: string): void {
  response.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
  response.end(page(title, detail));
}

async function listen(server: Server, port: number): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve());
  });
  const address = server.address() as AddressInfo | string | null;
  return typeof address === 'object' && address !== null ? address.port : port;
}

interface CallbackDeps {
  readonly context: CliContext;
  readonly memberId: number;
  readonly state: string;
  readonly redirectUri: string;
  readonly callbackPath: string;
  readonly store: FeishuTokenStore;
}

interface BoundResult {
  readonly record: FeishuTokenRecord;
  readonly user: FeishuUserInfo;
  readonly token: FeishuUserToken;
}

/** 处理回调：校验 state → 换 token → 取用户 → 校验绑定冲突 → 落盘。 */
async function handleCallback(
  request: IncomingMessage,
  response: ServerResponse,
  deps: CallbackDeps,
): Promise<BoundResult | undefined> {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  if (url.pathname !== deps.callbackPath) {
    respond(response, 404, '未找到', '该路径不是授权回调地址。');
    return undefined;
  }

  const fail = (message: string): SdrError => {
    respond(response, 400, '授权失败', message);
    return new SdrError(ERROR_CODES.FEISHU_AUTH_FAILED, `飞书用户授权失败：${message}`, {
      source: 'feishu',
    });
  };

  const errorParam = url.searchParams.get('error');
  if (errorParam !== null) throw fail(`授权页返回错误：${errorParam}`);
  if (url.searchParams.get('state') !== deps.state) throw fail('state 校验失败，请重新发起授权');
  const code = url.searchParams.get('code');
  if (code === null || code === '') throw fail('回调缺少授权码 code');

  const { context, memberId } = deps;
  const token = await exchangeCode({
    app: { appId: context.config.feishu.appId, appSecret: context.config.feishu.appSecret },
    code,
    redirectUri: deps.redirectUri,
    clock: context.clock,
    logger: context.stderr,
  });
  const user = await fetchUserInfo({
    accessToken: token.accessToken,
    clock: context.clock,
    logger: context.stderr,
  });

  const member = context.repo.members.findById(memberId);
  if (member === undefined) throw fail(`成员不存在：#${memberId}`);
  if (member.feishuOpenId !== undefined && member.feishuOpenId !== user.openId) {
    throw fail(`成员 #${memberId} 已绑定其他飞书账号（${member.feishuOpenId}），请先解绑`);
  }
  const bound = context.repo.members.findByFeishuOpenId(user.openId);
  if (bound !== undefined && bound.id !== memberId) {
    throw fail(`该飞书账号已绑定成员 #${bound.id}`);
  }

  const record: FeishuTokenRecord = {
    openId: user.openId,
    memberId,
    name: user.name,
    ...token,
  };
  deps.store.save(record);
  if (member.feishuOpenId !== user.openId) {
    context.repo.members.updateFeishuOpenId(memberId, user.openId);
  }

  respond(response, 200, '授权成功', '可以关闭本页返回终端。');
  return { record, user, token };
}

export async function runFeishuAuth(
  context: CliContext,
  args: ParsedArgs,
  hooks: FeishuAuthHooks = {},
): Promise<number> {
  const memberId = requireMemberId(flagValue(args, 'member'));
  if (context.repo.members.findById(memberId) === undefined) {
    throw new UsageError(`成员不存在：${memberId}（请先执行 sdr member add）`);
  }

  const target = resolveRedirect(context.env, flagValue(args, 'port'));
  const state = randomBytes(16).toString('hex');
  const store = new FeishuTokenStore(resolveTokenFilePath(context.env, context.cwd));
  const server = createServer();
  const actualPort = await listen(server, target.port).catch((error: unknown) => {
    throw new SdrError(
      ERROR_CODES.FEISHU_AUTH_FAILED,
      `本地回调端口 ${target.port} 无法监听：${error instanceof Error ? error.message : String(error)}`,
      { source: 'feishu', cause: error },
    );
  });

  const redirectUri = target.explicit ?? `http://localhost:${actualPort}/callback`;
  const authorizeUrl = buildAuthorizeUrl({
    appId: context.config.feishu.appId,
    redirectUri,
    state,
    ...(context.env.SDR_FEISHU_SCOPE === undefined || context.env.SDR_FEISHU_SCOPE.trim() === ''
      ? {}
      : { scope: context.env.SDR_FEISHU_SCOPE.trim() }),
  });
  const deps: CallbackDeps = {
    context,
    memberId,
    state,
    redirectUri,
    callbackPath: new URL(redirectUri).pathname,
    store,
  };

  const timeoutMs = hooks.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  try {
    const settled = new Promise<BoundResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(
          new SdrError(ERROR_CODES.FEISHU_AUTH_FAILED, `等待授权回调超时（${timeoutMs / 1000} 秒）`, {
            source: 'feishu',
          }),
        );
      }, timeoutMs);
      server.on('request', (request, response) => {
        handleCallback(request, response, deps).then(
          (result) => {
            if (result === undefined) return;
            clearTimeout(timer);
            resolve(result);
          },
          (error: unknown) => {
            clearTimeout(timer);
            reject(error);
          },
        );
      });
    });

    context.stdout('[feishu-auth] 请在浏览器打开以下链接完成飞书授权：');
    context.stdout(authorizeUrl);
    context.stdout(`[feishu-auth] 等待回调：${redirectUri}（回调地址需在开发者后台登记）`);
    hooks.onReady?.({ authorizeUrl, redirectUri, port: actualPort, state });

    const result = await settled;
    context.stdout(`[feishu-auth] 已绑定成员 #${memberId} ← ${result.user.name}（${result.user.openId}）`);
    context.stdout(`[feishu-auth] 权限范围：${result.token.scope === '' ? '(未返回)' : result.token.scope}`);
    context.stdout(`[feishu-auth] token 文件：${store.filePath}`);
    return 0;
  } finally {
    server.close();
  }
}
