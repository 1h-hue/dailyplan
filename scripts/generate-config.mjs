import { writeFileSync } from "node:fs";

const supabaseUrl =
  process.env.SUPABASE_URL ||
  "https://sxsktgjbxcnxfwijjtxi.supabase.co";
const anonKey = process.env.SUPABASE_ANON_KEY || "";

if (!anonKey.trim()) {
  console.error(
    "缺少环境变量 SUPABASE_ANON_KEY。请在 Netlify → Environment variables 中添加 anon public key。"
  );
  process.exit(1);
}

const contents = `window.DAILYPLAN_CONFIG = {
  SUPABASE_URL: ${JSON.stringify(supabaseUrl)},
  SUPABASE_ANON_KEY: ${JSON.stringify(anonKey.trim())},
};
`;

writeFileSync("config.js", contents);
console.log("已生成 config.js");
