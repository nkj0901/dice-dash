// Vercel 빌드 단계: Supabase 클라이언트 번들을 복사하고, 환경변수로 public/config.js를 만든다.
// 로컬에서는 .env.local(vercel env pull로 받은 파일)도 읽는다.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const envFile = path.join(root, '.env.local');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"]*)"?\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
}

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key =
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key) {
  console.error('SUPABASE_URL 과 SUPABASE_PUBLISHABLE_KEY(또는 SUPABASE_ANON_KEY) 환경변수가 필요합니다.');
  process.exit(1);
}

const vendorDir = path.join(root, 'public', 'vendor');
fs.mkdirSync(vendorDir, { recursive: true });
fs.copyFileSync(
  require.resolve('@supabase/supabase-js/dist/umd/supabase.js'),
  path.join(vendorDir, 'supabase.js')
);

// 브라우저에 공개되는 값만 넣는다 (publishable/anon 키는 원래 공개용).
const config = { supabaseUrl: url, supabaseKey: key };
fs.writeFileSync(
  path.join(root, 'public', 'config.js'),
  `window.DICE_CONFIG = ${JSON.stringify(config)};\n`
);
console.log('public/config.js, public/vendor/supabase.js 생성 완료');
