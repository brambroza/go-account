import { tokenFromHash } from 'src/auth/hash-token';

// token ในลิงก์อีเมลอยู่หลัง # — รับเฉพาะ base64url 43 ตัว (32 bytes) อย่างอื่นคืน ''
describe('tokenFromHash', () => {
  const token = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_AbCdE';

  it('reads a well-formed token from the fragment', () => {
    expect(token).toHaveLength(43);
    expect(tokenFromHash(`#token=${token}`)).toBe(token);
    expect(tokenFromHash(`token=${token}`)).toBe(token);
    expect(tokenFromHash(`#a=1&token=${token}`)).toBe(token);
  });

  it('rejects missing, short, long or non-base64url tokens', () => {
    expect(tokenFromHash('')).toBe('');
    expect(tokenFromHash('#')).toBe('');
    expect(tokenFromHash('#token=abc')).toBe('');
    expect(tokenFromHash(`#token=${token}x`)).toBe('');
    expect(tokenFromHash(`#token=${token.slice(0, 42)}+`)).toBe('');
    expect(tokenFromHash('#token=<script>alert(1)</script>xxxxxxxxxxxxxxxx')).toBe('');
  });
});
