/**
 * The S3 signing code against Amazon's own worked examples ("Signature
 * Version 4: examples" in the S3 API reference). If one of these goes red,
 * nothing this archive stores in S3 would be accepted by the provider.
 */
import { describe, expect, it } from 'vitest';
import { EMPTY_SHA256, presignUrl, signHeaders, uriEncode } from '../../src/files/sigv4.ts';

const C = {
  accessKey: 'AKIAIOSFODNN7EXAMPLE',
  secretKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  region: 'us-east-1',
};
const NOW = new Date('2013-05-24T00:00:00Z');
const HOST = 'examplebucket.s3.amazonaws.com';
const signatureOf = (h: Record<string, string>) =>
  /Signature=([a-f0-9]{64})$/.exec(h.authorization ?? '')?.[1];

describe('Signature Version 4', () => {
  it('signs a GET with a range header as the documentation does', () => {
    const h = signHeaders(C, {
      method: 'GET',
      path: '/test.txt',
      host: HOST,
      headers: { Range: 'bytes=0-9' },
      payloadHash: EMPTY_SHA256,
      now: NOW,
    });
    expect(signatureOf(h)).toBe('f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41');
    expect(h.authorization).toContain('SignedHeaders=host;range;x-amz-content-sha256;x-amz-date,');
  });

  it('signs a PUT with an encoded key and extra headers as the documentation does', () => {
    const h = signHeaders(C, {
      method: 'PUT',
      path: `/${uriEncode('test$file.text', true)}`,
      host: HOST,
      headers: {
        Date: 'Fri, 24 May 2013 00:00:00 GMT',
        'x-amz-storage-class': 'REDUCED_REDUNDANCY',
      },
      payloadHash: '44ce7dd67c959e0d3524ffac1771dfbba87d2b6b4b4e99e42034a8b803f8b072',
      now: NOW,
    });
    expect(signatureOf(h)).toBe('98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd');
  });

  it('presigns a URL as the documentation does', () => {
    const url = presignUrl(C, {
      method: 'GET',
      protocol: 'https:',
      host: HOST,
      path: '/test.txt',
      expires: 86400,
      now: NOW,
    });
    expect(url).toMatch(
      /X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404$/,
    );
  });

  it('keeps slashes in a path and encodes them in a query', () => {
    expect(uriEncode('a/b c', true)).toBe('a/b%20c');
    expect(uriEncode('a/b', false)).toBe('a%2Fb');
  });
});
