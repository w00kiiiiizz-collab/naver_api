import crypto from 'crypto';

export function generateSignature(timestamp: string, method: string, uri: string, secretKey: string) {
  const message = `${timestamp}.${method}.${uri}`;
  return crypto.createHmac('sha256', secretKey).update(message).digest('base64');
}

export async function makeNaverRequest(
  uri: string, 
  method: string, 
  customerId: string, 
  queryParams?: string,
  customKeys?: { apiKey: string; secretKey: string }
) {
  const apiKey = customKeys?.apiKey || process.env.NAVER_API_KEY!;
  const secretKey = customKeys?.secretKey || process.env.NAVER_SECRET_KEY!;
  const baseUrl = 'https://api.searchad.naver.com';

  const timestamp = Date.now().toString();
  // Signature is usually generated using the uri path without query params
  const signature = generateSignature(timestamp, method, uri, secretKey);

  const headers = {
    'Content-Type': 'application/json; charset=UTF-8',
    'X-Timestamp': timestamp,
    'X-API-KEY': apiKey,
    'X-Customer': customerId,
    'X-Signature': signature
  };

  const fullUrl = queryParams ? `${baseUrl}${uri}?${queryParams}` : `${baseUrl}${uri}`;

  const response = await fetch(fullUrl, { method, headers });
  const text = await response.text();

  if (!response.ok) {
    console.error(`Naver API Error [${response.status}] for ${uri}:`, text);
    throw new Error(`Naver API Error: ${response.status}`);
  }

  return JSON.parse(text);
}
