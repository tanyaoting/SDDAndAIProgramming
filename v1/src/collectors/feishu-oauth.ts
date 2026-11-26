import type { Clock } from '../types.js';
import { ERROR_CODES, SdrError } from '../errors.js';
import { HttpError, request } from '../http.js';

/**
 * 飞书用户身份 OAuth（FR-02 用户授权路径）。
 * 端点按官方文档 2026-08 版本实现：授权页 authen/v1/authorize，
 * 换/刷新 token 使用 v3（v2 已标记 deprecated），用户信息 authen/v1/user_info。
 */

export const FEISHU_AUTHORIZE_URL = 'https://accounts.feishu.cn/open-apis/authen/v1/authorize';
export const FEISHU_TOKEN_URL = 'https://accounts.feishu.cn/oauth/v3/token';
export const FEISHU_USER_INFO_URL = 'https://open.feishu.cn/open-apis/authen/v1/user_info';
/** offline_access 用于换取 refresh_token，需在开发者后台一并开通。 */
export const DEFAULT_FEISHU_SCOPE = 'task:task:read offline_access';

export interface FeishuApp {
  readonly appId: string;
  readonly appSecret: string;
}

export interface FeishuUserToken {
  readonly accessToken: string;
  readonly refreshToken: string;
  /** 绝对过期时刻（epoch 毫秒），避免在业务层构造 Date。 */
  readonly expiresAt: number;
  readonly refreshExpiresAt: number;
  readonly scope: string;
}

export interface FeishuUserInfo {
  readonly openId: string;
  readonly name: string;
}

export interface OAuthHttpOptions {
  readonly clock: Clock;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly timeoutMs?: number;
  readonly maxRetries?: number;
  readonly logger?: (line: string) => void;
}

interface TokenPayload {
  readonly code?: number;
  readonly msg?: string;
  readonly error?: string;
  readonly error_description?: string;
  readonly access_token?: string;
  readonly expires_in?: number;
  readonly refresh_token?: string;
  readonly refresh_token_expires_in?: number;
  readonly scope?: string;
}

interface UserInfoPayload {
  readonly code?: number;
  readonly msg?: string;
  readonly data?: { readonly open_id?: string; readonly name?: string };
}

function authFailed(detail: string, cause?: unknown): SdrError {
  return new SdrError(ERROR_CODES.FEISHU_AUTH_FAILED, `飞书用户授权失败：${detail}`, {
    source: 'feishu',
    ...(cause === undefined ? {} : { cause }),
  });
}

function httpOptions(options: OAuthHttpOptions, secrets: readonly string[]) {
  return {
    secrets,
    ...(options.sleep === undefined ? {} : { sleep: options.sleep }),
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    ...(options.maxRetries === undefined ? {} : { maxRetries: options.maxRetries }),
    ...(options.logger === undefined ? {} : { logger: options.logger }),
  };
}

function parseJson<T>(body: string): T {
  try {
    return JSON.parse(body) as T;
  } catch (error) {
    throw authFailed('响应不是合法 JSON', error);
  }
}

function detailOf(payload: { msg?: string; error?: string; error_description?: string }, status: number): string {
  const text = payload.error_description ?? payload.error ?? payload.msg;
  return text === undefined || text === '' ? `HTTP ${status}` : text;
}

export interface AuthorizeUrlParams {
  readonly appId: string;
  readonly redirectUri: string;
  readonly state: string;
  readonly scope?: string;
}

/** 构造授权页 URL（参数全部走 URLSearchParams 编码，避免手工拼接出错）。 */
export function buildAuthorizeUrl(params: AuthorizeUrlParams): string {
  const url = new URL(FEISHU_AUTHORIZE_URL);
  url.searchParams.set('client_id', params.appId);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', params.redirectUri);
  url.searchParams.set('scope', params.scope ?? DEFAULT_FEISHU_SCOPE);
  url.searchParams.set('state', params.state);
  url.searchParams.set('prompt', 'consent');
  // URLSearchParams 把空格编码为 '+'，部分授权页按字面量解析 scope，统一改用 %20。
  return url.toString().replace(/\+/g, '%20');
}

function toUserToken(
  payload: TokenPayload,
  clock: Clock,
  requireRefresh: boolean,
): FeishuUserToken {
  const accessToken = payload.access_token ?? '';
  if (accessToken === '') throw authFailed('响应缺少 access_token');
  const refreshToken = payload.refresh_token ?? '';
  if (requireRefresh && refreshToken === '') {
    throw authFailed('响应缺少 refresh_token（请确认已开通 offline_access 且应用已发布）');
  }

  const nowMs = clock.now().getTime();
  const expiresIn = payload.expires_in ?? 7200;
  const refreshExpiresIn = payload.refresh_token_expires_in ?? 0;
  return {
    accessToken,
    refreshToken,
    expiresAt: nowMs + expiresIn * 1000,
    refreshExpiresAt: refreshToken === '' ? 0 : nowMs + refreshExpiresIn * 1000,
    scope: payload.scope ?? '',
  };
}

async function postToken(
  form: URLSearchParams,
  app: FeishuApp,
  options: OAuthHttpOptions,
  requireRefresh: boolean,
): Promise<FeishuUserToken> {
  let response;
  try {
    response = await request(FEISHU_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
      ...httpOptions(options, [app.appSecret, form.get('refresh_token') ?? '', form.get('code') ?? '']),
    });
  } catch (error) {
    if (error instanceof HttpError) {
      throw authFailed(`token 端点请求失败（${error.message}）`, error);
    }
    throw error;
  }

  const payload = parseJson<TokenPayload>(response.body);
  if (response.status !== 200 || payload.code !== 0) {
    throw authFailed(detailOf(payload, response.status));
  }
  return toUserToken(payload, options.clock, requireRefresh);
}

export interface ExchangeCodeParams extends OAuthHttpOptions {
  readonly app: FeishuApp;
  readonly code: string;
  readonly redirectUri: string;
}

/** 授权码换 user_access_token（授权码 5 分钟内有效且只能用一次）。 */
export function exchangeCode(params: ExchangeCodeParams): Promise<FeishuUserToken> {
  const form = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: params.app.appId,
    client_secret: params.app.appSecret,
    code: params.code,
    redirect_uri: params.redirectUri,
  });
  return postToken(form, params.app, params, false);
}

export interface RefreshTokenParams extends OAuthHttpOptions {
  readonly app: FeishuApp;
  readonly refreshToken: string;
}

/** 刷新 token：refresh_token 一次性使用，成功后旧值立即失效，必须回存新值。 */
export function refreshUserToken(params: RefreshTokenParams): Promise<FeishuUserToken> {
  const form = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: params.app.appId,
    client_secret: params.app.appSecret,
    refresh_token: params.refreshToken,
  });
  return postToken(form, params.app, params, true);
}

export interface FetchUserInfoParams extends OAuthHttpOptions {
  readonly accessToken: string;
}

/** 用 user_access_token 读取当前授权用户（open_id 用于绑定成员）。 */
export async function fetchUserInfo(params: FetchUserInfoParams): Promise<FeishuUserInfo> {
  let response;
  try {
    response = await request(FEISHU_USER_INFO_URL, {
      headers: {
        Authorization: `Bearer ${params.accessToken}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
      ...httpOptions(params, [params.accessToken]),
    });
  } catch (error) {
    if (error instanceof HttpError) {
      throw authFailed(`用户信息请求失败（${error.message}）`, error);
    }
    throw error;
  }

  const payload = parseJson<UserInfoPayload>(response.body);
  const openId = payload.data?.open_id ?? '';
  if (response.status !== 200 || payload.code !== 0 || openId === '') {
    throw authFailed(detailOf(payload, response.status));
  }
  return { openId, name: payload.data?.name ?? openId };
}
