# 本仓库 Git 管理说明（个人工作流备忘）

> 本文件属于 fork 自用说明，不参与官方仓库。官方永远不会有一个叫 `GIT-WORKFLOW.md` 的文件，因此同步官方时**永不冲突**。

## 一、仓库结构（已配置完成，勿重复操作）

| remote | 地址 | 用途 |
|---|---|---|
| `upstream` | https://github.com/deepseek-ai/deepseek-harness.git | 官方仓库，只拉不推 |
| `origin` | https://github.com/wake-me/deepseek-harness.git | 我的 fork（public），推送用 |

| 分支 | 角色 | 规矩 |
|---|---|---|
| `master` | 官方纯镜像，跟踪 `upstream/master` | **永远不放自己的提交**，只允许快进（`--ff-only`） |
| `local/main` | 我的工作分支（当前默认在这里干活），跟踪 `origin/local/main` | wiki、少量源码修改全部提交到这里 |

本地保护配置（都已就位，无需重做）：

- `lefthook-local.yml`：本地 git 钩子扩展层，挂了 **gitleaks 密钥扫描**（fork 上没有 GitHub secret scanning，靠它在提交时拦截 `sk-`、AWS key 等）。此文件已被 `.git/info/exclude` 排除，不会提交。
- `.git/info/exclude` 中 `.qoder/*` + `!.qoder/repowiki/`：只放行 repowiki 子树进 git，Qoder 的其他缓存/状态不污染 `git status`。
- 推送凭证走 macOS 钥匙串，`git push` 无需再登录。

## 二、每周同步官方（标准流程，五条命令）

不用 GitHub 网页的 "Sync fork" 按钮——它只更新 fork 的 master，管不到 `local/main`，等于还是要回本地操作。全部本地完成：

```sh
# ① 快进 master（永不冲突）
git checkout master
git fetch upstream
git merge --ff-only upstream/master
git push origin master

# ② 把官方更新合进工作分支
git checkout local/main
git merge master
git push origin local/main
```

频率建议每周一次。官方处于 0.1.0-rc 预览期、迭代猛，**小步勤跑，别攒大半年一起合**。

冲突处理：`git merge master` 报冲突时（只可能发生在自己改过的官方文件上），**以官方新版为底，把我的小改动手动重放上去**，然后 `git add` 完成合并。不要盲目 `-o ours`。

## 三、wiki（Qoder repowiki）提交流程

wiki 存放在 `.qoder/repowiki/`（直接提交该目录，不做复制）。Qoder 重新生成后：

```sh
# 清理生成文件的行尾空白（不清会被官方 pre-commit 的 whitespace 检查拦下）
find .qoder/repowiki -type f \( -name '*.md' -o -name '*.yaml' \) -exec perl -i -pe 's/\h+\n/\n/' {} +

git add .qoder/repowiki
git commit -m "wiki: 同步至官方 <commit短sha>"
git push
```

个人备忘类文档（如本文件）不要放进 `.qoder/repowiki/`——那是 Qoder 的生成区，重新生成会覆盖；放在仓库根目录或其他独立路径。

## 四、改源码的原则

1. **能用树外机制就不改源码**：配置覆盖用 `$DSH_HOME/cordis.patch.yml`（默认 `~/.dsh`），加 skill 用 `~/.dsh/skills` 或项目内 `.dsh/skills`、`.agents/skills`，加插件做成独立包。这些都在 git 仓库外或官方预留位置，与官方更新天然无冲突。
2. 必须改源码时：**优先新增文件，少改官方文件**；改动都提交到 `local/main`。
3. 大改动建议从 `local/main` 开临时分支（`git switch -c feat/xxx`），做完合回来，保持 `local/main` 随时可合并官方。

## 五、密钥安全约定

- dsh 的密钥永远只在两处：`~/.dsh/.credentials.yaml`（日常使用）和仓库根 `.env`（开发测试，已被官方 `.gitignore` 挡住）。**绝不把密钥值写进代码、文档、wiki、commit message**。
- 万一误提交：第一步立刻去平台**作废并轮换密钥**（比清历史更重要），第二步才用 `git filter-repo` 清历史。
- pre-commit 已挂 gitleaks 兜底；偶尔确认历史干净可跑 `gitleaks detect --source . -v`。

## 六、注意事项

- `git push` 慢是正常的：官方 pre-push 钩子跑全仓 typecheck（约 1 分钟）。赶时间可 `git push --no-verify` 跳过。
- GitHub fork 无法转 private（公开仓库的 fork 锁死可见性），已决定接受 public。
- 想给官方提 PR 时：临时再 fork 一个官方仓库，把 `local/main` 上的提交 `git cherry-pick` 过去，从那个 fork 发 PR；本仓库照常私用。
