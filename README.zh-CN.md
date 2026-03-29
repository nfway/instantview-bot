# InstantView Bot

[English](README.md)

这个 bot 用来在 Telegram 中生成 Instant View 链接。

当前这个版本已经改成`一个或多个用户使用版本`：

- 不需要 MongoDB
- 不需要 RabbitMQ
- 本地 JSON 缓存和状态文件保存在 `.conf/state.json`
- 使用单进程串行队列
- 支持单用户或多用户访问控制

## 功能

- [x] 提取 amp、clck、bit.ly 等跳转链接
- [x] 为任意完整链接生成 IV
- [x] 压缩正文内容
- [x] 支持长内容拆分
- [x] 在单进程内排队处理任务
- [x] 本地缓存 IV 结果
- [ ] 更好的图片解析
- [ ] 多链接处理

## 环境变量

必填：

- `TBTKN`：Telegram Bot Token
- `TGADMIN`：Telegram 管理员用户 ID
- `TGPHTOKEN_0`：Telegraph access token

访问控制：

- `ALLOWED_USER_IDS`：允许使用 bot 的多个 Telegram 用户 ID，英文逗号分隔
- `SINGLE_USER_ID`：旧版单用户变量，仅在 `ALLOWED_USER_IDS` 为空时作为回退

优先级：

- `ALLOWED_USER_IDS` > `SINGLE_USER_ID` > `TGADMIN`

可选：

- `DEV=1`：输出调试日志
- `BOT_USERNAME`：bot 用户名，不带 `@`
- `HELP_MESSAGE`：解析失败时附加提示
- `NO_PUPPET=1`：禁用 Puppeteer 兜底解析
- `NO_PARSE=1`：禁用解析流程
- `IV_MAKING_TIMEOUT=60`：IV 生成超时时间，单位秒
- `TGGROUP`：日志群组 ID
- `TGGROUPBUGS`：错误日志群组 ID

完整示例见：

- [.env.sample](.env.sample)

## 本地运行

```bash
cp .env.sample .env
npm install
npm start
```

## Docker Compose

```bash
cp .env.sample .env
docker compose up -d --build
```

查看日志：

```bash
docker compose logs -f
```

重启或更新：

```bash
docker compose restart
docker compose up -d --build
```

说明：

- `.conf` 会持久化 bot 配置、黑名单和缓存状态
- `.docs` 会持久化运行时生成的临时文档文件
- 容器内不再执行 `pm2 restart` 或 `git pull`，更新方式改为宿主机重新构建并启动 Compose
