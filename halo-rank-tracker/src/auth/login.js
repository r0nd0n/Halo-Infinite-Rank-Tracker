#!/usr/bin/env node
/**
 * One-time interactive login helper.
 *
 * It produces a refresh token you can save as HALO_REFRESH_TOKEN in .env,
 * which lets the app renew Spartan/clearance tokens automatically.
 *
 * Requirements:
 *   - An Azure app registration with "Allow public client flows" enabled and
 *     redirect URI http://localhost. Set HALO_AZURE_CLIENT_ID (+ secret if your
 *     app has one) in .env before running.
 *
 * Usage:  npm run login
 */
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { config } from '../config.js';
import { buildAuthorizeUrl, exchangeCodeForTokens } from './oauth.js';

async function main() {
  if (!config.clientId) {
    console.error('Set HALO_AZURE_CLIENT_ID in .env first (see README.md).');
    process.exit(1);
  }

  const url = buildAuthorizeUrl({ clientId: config.clientId, redirectUri: config.redirectUri });
  console.log('\n1) Open this URL in your browser and sign in with your Xbox/Microsoft account:\n');
  console.log(url);
  console.log(
    '\n2) After signing in you will be redirected to a URL. Copy the full URL ' +
      '(it contains ?code=...), then paste it below.\n'
  );

  const rl = createInterface({ input: stdin, output: stdout });
  const pasted = (await rl.question('Paste the redirected URL (or just the code): ')).trim();
  rl.close();

  let code = pasted;
  try {
    const parsed = new URL(pasted);
    code = parsed.searchParams.get('code') || pasted;
  } catch {
    // Not a URL; assume the raw code was pasted.
  }

  const tokens = await exchangeCodeForTokens(code);
  console.log('\nSuccess. Add this line to your .env file:\n');
  console.log(`HALO_REFRESH_TOKEN=${tokens.refresh_token}\n`);
  console.log('The app will now refresh Spartan/clearance tokens automatically.');
}

main().catch((err) => {
  console.error('\nLogin failed:', err.message);
  process.exit(1);
});
