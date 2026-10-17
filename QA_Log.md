# QA Log

## 2026-10-15 — 在 Mac 还是 Linux 上构建镜像,最后只在 Linux 上跑有什么影响

**问题:** Mac和Linux构建有什么分别,以及对于最后只在Linux上跑有什么implications

**答案核心:**
- Mac 是 arm64,生产机 linuxbox 是 x86_64。Mac 上构建 `linux/amd64` 镜像要靠 QEMU 模拟,慢,且 better-sqlite3 的编译(Dockerfile 生产阶段 `build-essential`)最慢;Linux 上是原生构建。
- 镜像里的原生模块是在容器内按目标平台编译的,`.dockerignore` 排除了 `node_modules`,所以 Mac 主机上 x86_64/arm64 错配的 `node_modules` 不会混进镜像。
- 只在 Linux 跑意味着只需要 amd64;Actions 原本发布多架构镜像,本地只推 amd64 会与之不同,也没有 provenance/SBOM。
- 在 Mac 上用模拟跑冒烟,验证的是模拟环境,不完全等于生产的原生 x86;更可靠的是推送后在 linuxbox 上拉取同一 digest 再检查。
- 病假功能依赖容器内挂载的 Obsidian vault(`OBSIDIAN_VAULT_PATH`);linuxbox 上有 `/home/mie/obsidian`,但内容是否最新未核实。

**相关引用:** `Dockerfile`(第 29、41、54–60 行)、`.dockerignore`、`scripts/trek_deploy_agent.py`(`IMAGE_RE`)、linuxbox 上的 `docker-compose.linux-bind.yml`
