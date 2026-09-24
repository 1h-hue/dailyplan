# 每日计划

两个人用的每日计划页面。静态 HTML，数据放在已有的 Supabase 项目 `sxsktgjbxcnxfwijjtxi` 里。一个人改完，另一个人不用刷新就能看到。

不需要自己的服务器。浏览器只使用 **anon public** key。不要把 **service_role** key 放进网页或 `config.js`。

## 1. 在 Supabase 里建表

1. 打开 [SQL Editor](https://supabase.com/dashboard/project/sxsktgjbxcnxfwijjtxi/sql/new)。
2. 把 `supabase/schema.sql` 的全部内容粘贴进去，运行。

这段 SQL 会创建 `public.plans`、行级安全策略、更新时间触发器，并把表加入 Realtime。

如果数据库以前已经初始化过，也请在更新代码后重新运行一次完整的 `supabase/schema.sql`。
脚本可以重复执行，并会补建留言板所需的 `public.messages`、睡眠记录所需的
`public.sleep_records`、留言已读进度所需的 `public.message_read_state` 表，以及对应的权限策略和实时同步配置。

留言提醒的已读时间存在 `message_read_state` 里，跟账号走，换手机/电脑登录会同步；不是存在浏览器本地。

## 2. 填写 anon key

1. 打开 [Project Settings → API](https://supabase.com/dashboard/project/sxsktgjbxcnxfwijjtxi/settings/api)。
2. 复制 **anon public** key（不是 service_role）。
3. 打开本目录的 `config.js`，粘贴到 `SUPABASE_ANON_KEY`。

`config.js` 已在 `.gitignore` 里。anon key 按设计可以出现在浏览器里，但不要提交；以后如果有人把 service_role 放进这个文件，提交就会泄漏数据库权限。模板在 `config.example.js`。

没填 key 时，页面会提示「请填写 anon key」，不会直接报错崩溃。

## 3. 创建两个登录账号

这个页面只有登录，没有注册。

1. 打开 Authentication → Providers，确认 Email 已启用。
2. 打开 Authentication → Sign In / Providers 设置，关闭允许公开注册（Allow new users to sign up），避免别人自己注册进来。
3. 打开 Authentication → Users → Add user，建两个邮箱用户。创建时勾选 **Auto Confirm User**，否则无法登录。

两个人各自用自己的邮箱和密码登录。

## 4. 打开页面

不要直接双击 `index.html`。浏览器会拦截 `file://` 下的 ES Module。

在本目录打开终端，任选一个：

```powershell
python -m http.server 8080
```

如果没有 Python：

```powershell
npx serve
```

然后用浏览器打开 `http://localhost:8080`（`npx serve` 以它打印的地址为准）。Windows 上若 `python` 无效，可用 `py -m http.server 8080`。

## 5. 用 Netlify 从 GitHub 自动发布

仓库已接 Netlify 时，`git push` 会自动部署。`config.js` 不在 Git 里，由构建脚本生成：

1. 打开站点 → **Environment variables**，新增：
   - Key：`SUPABASE_ANON_KEY`
   - Value：Supabase 的 **anon public** key
2. 打开 **Deploys** → **Trigger deploy** → **Deploy site**（或再 `git push` 一次）。

构建命令见 `netlify.toml`：`node scripts/generate-config.mjs`。没填环境变量时构建会失败，避免上线一个不能登录的空 key 页面。

## 怎么用

- **我的计划**：只显示自己这一天的条目。可以添加、勾选完成、共享、删除。
- **共享计划**：显示对方标成共享的条目。你只能勾选完成，不能改标题、取消共享或删除。
- **双人留言板**：按日期显示双方留言，可以回复对方，也可以从对方的共享任务点击“引用留言”。
- **睡眠记录**：在第二个标签页记录当天起床和睡觉时间；双方默认共享，并按昨天睡觉到今天起床自动计算睡眠时长。
- 换日期后，两边都会换成那一天的内容。
- 右上角显示「实时已连接」时，对方的修改会自动出现。

## 安全说明

- 自己的行可以查、增、改、删。
- 登录用户可以查看 `shared = true` 的行。
- 别人的共享行，页面只提交 `done`。数据库触发器会拒绝修改标题、日期、共享状态和所属用户。普通 RLS 做不到按列限制，所以用触发器补上。
