const cookieName = 'tmd_teacher';
const encoder = new TextEncoder();
const hex = bytes => Array.from(new Uint8Array(bytes), n => n.toString(16).padStart(2, '0')).join('');
async function signature(secret, value) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, encoder.encode(value)));
}
function equal(a, b) {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}
async function isTeacher(secret, cookie = '') {
  if (!secret) return false;
  const token = cookie.split(';').map(s => s.trim()).find(s => s.startsWith(cookieName + '='))?.slice(cookieName.length + 1);
  if (!token || token.length > 200) return false;
  const [expires, nonce, signed] = token.split('.');
  if (!expires || !nonce || !signed || Number(expires) <= Date.now()) return false;
  return equal(signed, await signature(secret, `${expires}.${nonce}`));
}
async function login(secret, password, secure = true) {
  if (!secret || typeof password !== 'string' || password.length > 200) return null;
  const hash = async value => hex(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
  if (!equal(await hash(secret), await hash(password))) return null;
  const value = `${Date.now() + 8 * 60 * 60 * 1000}.${crypto.randomUUID()}`;
  return `${cookieName}=${value}.${await signature(secret, value)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${secure ? '; Secure' : ''}`;
}
function logout(secure = true) {
  return `${cookieName}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure ? '; Secure' : ''}`;
}
module.exports = { isTeacher, login, logout };
