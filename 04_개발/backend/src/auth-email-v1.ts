export type AuthEmailKind = 'verify-email' | 'reset-password';

export interface AuthEmailEnv {
  AUTH_EMAIL_RELAY_URL?: string;
  AUTH_EMAIL_RELAY_TOKEN?: string;
  AUTH_EMAIL_FROM?: string;
}

export interface AuthEmailMessage {
  kind: AuthEmailKind;
  to: string;
  userName?: string | null;
  actionUrl: string;
}

function requireSecret(value: string | undefined, name: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`${name} is required for Danjion auth email delivery`);
  return normalized;
}

function secureRelayUrl(value: string): string {
  const parsed = new URL(value);
  const local = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
  if (parsed.protocol !== 'https:' && !(local && parsed.protocol === 'http:')) {
    throw new Error('AUTH_EMAIL_RELAY_URL must use HTTPS outside local development');
  }
  parsed.hash = '';
  return parsed.toString();
}

function safeText(value: string | null | undefined): string {
  return String(value || '').replace(/[\r\n]+/g, ' ').trim();
}

function htmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function template(message: AuthEmailMessage) {
  const name = safeText(message.userName) || '단지온 이용자';
  const actionUrl = new URL(message.actionUrl).toString();

  if (message.kind === 'verify-email') {
    const subject = '[단지온] 이메일 주소를 확인해 주세요';
    const text = `${name}님, 단지온 계정의 이메일 주소를 확인하려면 다음 링크를 열어 주세요.\n\n${actionUrl}\n\n이 요청을 하지 않았다면 이 메일을 무시해 주세요.`;
    const html = `<p>${htmlEscape(name)}님,</p><p>단지온 계정의 이메일 주소를 확인하려면 아래 링크를 열어 주세요.</p><p><a href="${htmlEscape(actionUrl)}">이메일 확인하기</a></p><p>이 요청을 하지 않았다면 이 메일을 무시해 주세요.</p>`;
    return { subject, text, html };
  }

  const subject = '[단지온] 비밀번호 재설정 안내';
  const text = `${name}님, 단지온 비밀번호를 다시 설정하려면 다음 링크를 열어 주세요.\n\n${actionUrl}\n\n본인이 요청하지 않았다면 비밀번호는 변경되지 않습니다.`;
  const html = `<p>${htmlEscape(name)}님,</p><p>단지온 비밀번호를 다시 설정하려면 아래 링크를 열어 주세요.</p><p><a href="${htmlEscape(actionUrl)}">비밀번호 다시 설정하기</a></p><p>본인이 요청하지 않았다면 비밀번호는 변경되지 않습니다.</p>`;
  return { subject, text, html };
}

/**
 * Provider-neutral server-to-server relay contract.
 *
 * The relay endpoint may later be backed by Resend, SES, Postmark, a PADIEM
 * common mail service, or another transactional provider without changing
 * Better Auth or the browser client. Provider credentials never enter Vite.
 */
export async function sendDanjionAuthEmail(env: AuthEmailEnv, message: AuthEmailMessage): Promise<void> {
  const relayUrl = secureRelayUrl(requireSecret(env.AUTH_EMAIL_RELAY_URL, 'AUTH_EMAIL_RELAY_URL'));
  const relayToken = requireSecret(env.AUTH_EMAIL_RELAY_TOKEN, 'AUTH_EMAIL_RELAY_TOKEN');
  const from = requireSecret(env.AUTH_EMAIL_FROM, 'AUTH_EMAIL_FROM');
  const rendered = template(message);

  const response = await fetch(relayUrl, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${relayToken}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      kind: message.kind,
      from,
      to: message.to.trim(),
      subject: rendered.subject,
      text: rendered.text,
      html: rendered.html
    })
  });

  if (!response.ok) {
    throw new Error(`Danjion auth email relay failed (${response.status})`);
  }
}
