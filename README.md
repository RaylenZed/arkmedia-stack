# ArkMedia Stack

基于 Debian 的极简媒体栈：

- OpenList（外部网盘聚合）
- Jellyfin（媒体库/播放）
- qBittorrent（下载）
- Watchtower（自动更新）
- Caddy + Cloudflare DNS-01（自动 HTTPS）
- rclone + systemd（把网盘挂载到宿主机目录）

目标场景：

- 不开 80/443/8080
- 单域名、不同端口访问不同服务
- 可后续扩展 Dify 等业务

---

## 1. 访问模型

统一域名示例：`pve.example.com`

默认访问地址：

- Jellyfin: `https://pve.example.com:8443`
- qBittorrent: `https://pve.example.com:2053`
- OpenList: `https://pve.example.com:2096`

说明：

- 支持你要求的“同一个域名，不同业务走不同端口”。
- 证书由 Caddy 通过 Cloudflare DNS API 自动签发和续期。

---

## 2. 项目文件

```text
.
├── .env.example
├── docker-compose.yml
├── Dockerfile.caddy
├── Caddyfile
├── README.md
└── systemd
    ├── rclone-openlist-root.service
    └── rclone-openlist-drive@.service
```

---

## 3. 系统要求

- Debian 12/13（其他 Linux 也可）
- Docker Engine + Docker Compose Plugin
- 公网可访问你的自定义端口（如 8443/2053/2096）
- Cloudflare 域名托管

命令约定：

- 本文默认你是普通用户，命令都按 `sudo` 写。
- `cd` 这类 shell 内建命令不加 `sudo`。
- 如果你本身是 `root`，可把 `sudo` 去掉。

---

## 4. 从零部署（可直接复制）

### 4.1 安装 Docker（官方脚本）

```bash
curl -fsSL https://get.docker.com -o install-docker.sh
sudo sh install-docker.sh
sudo systemctl enable --now docker
sudo docker --version
sudo docker compose version
```

### 4.2 安装 rclone / fuse3

```bash
sudo apt update
sudo apt install -y rclone fuse3 curl
sudo sed -i 's/^#user_allow_other/user_allow_other/' /etc/fuse.conf
```

### 4.3 部署目录和配置

```bash
sudo mkdir -p /srv/arkstack
sudo chown -R "$USER:$USER" /srv/arkstack
cd /srv/arkstack
# 把仓库文件放到当前目录（git clone 或上传）
cp .env.example .env
```

编辑 `.env`，至少填写：

- `BASE_DOMAIN=pve.example.com`
- `ACME_EMAIL=you@example.com`
- `CF_DNS_API_TOKEN=...`

### 4.4 一条命令创建目录

```bash
sudo mkdir -p /srv/docker/{caddy/data,caddy/config,openlist,jellyfin/config,jellyfin/cache,qbittorrent} /srv/media/{local,incoming} /srv/downloads /srv/cloud /var/cache/rclone
```

### 4.5 修正目录权限（很重要）

```bash
sudo chown -R 1000:1000 /srv/docker/openlist /srv/docker/qbittorrent
sudo chmod -R u+rwX,g+rwX /srv/docker/openlist /srv/docker/qbittorrent
```

> 如果你在 `.env` 里改了 `PUID/PGID`，这里对应改成同样的 UID/GID。

### 4.6 Cloudflare DNS

在 Cloudflare 添加 A 记录：

- `pve.example.com -> 你的 VPS IP`

建议：

- 先用灰云（DNS only）测试；
- 如需橙云代理，优先用 Cloudflare 支持的 HTTPS 端口（8443/2053/2096 等）。

### 4.7 启动

```bash
sudo docker compose up -d --build
sudo docker compose ps
```

---

## 5. 首次登录与初始化

### 5.1 OpenList

- 打开 `https://pve.example.com:2096`
- 按页面向导创建管理员账号
- 添加你的网盘（夸克/阿里盘/OneDrive 等）

### 5.2 Jellyfin

- 打开 `https://pve.example.com:8443`
- 按向导创建 Jellyfin 管理员
- 在媒体库里添加目录（示例）：
  - `/media/local/TV`
  - `/media/cloud/quark/TV`

### 5.3 qBittorrent

- 打开 `https://pve.example.com:2053`
- 默认用户 `admin`
- 初始临时密码查看：

```bash
sudo docker compose logs qbittorrent | rg "temporary password"
```

登录后立刻在 qBittorrent 设置里改管理员密码。

---

## 6. 网盘挂载（OpenList + rclone）

核心逻辑：

- OpenList 负责“接入网盘”
- rclone 负责“挂载到宿主机目录”

### 6.1 配置 rclone remote

```bash
sudo rclone config
```

建议参数：

- name: `openlist`
- type: `webdav`
- url: `http://127.0.0.1:25244/dav`
- vendor: `other`
- user/password: OpenList 里创建的 WebDAV 账号

验证：

```bash
sudo rclone lsd openlist:
```

### 6.2 单网盘挂载（根目录）

```bash
sudo cp systemd/rclone-openlist-root.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now rclone-openlist-root
sudo systemctl status rclone-openlist-root
```

### 6.3 多网盘挂载（推荐）

```bash
sudo mkdir -p /srv/cloud/{quark,alipan,onedrive}
sudo cp systemd/rclone-openlist-drive@.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now rclone-openlist-drive@quark
sudo systemctl enable --now rclone-openlist-drive@alipan
sudo systemctl enable --now rclone-openlist-drive@onedrive
```

检查：

```bash
sudo systemctl status rclone-openlist-drive@quark
sudo systemctl status rclone-openlist-drive@alipan
sudo systemctl status rclone-openlist-drive@onedrive
ls -lah /srv/cloud
```

---

## 7. 新增 SSD 并接入 Jellyfin（附加教程）

### 7.1 查看新盘

```bash
sudo lsblk -f
```

### 7.2 格式化（仅新盘，慎用）

```bash
sudo mkfs.ext4 /dev/nvme1n1p1
```

### 7.3 挂载并加入开机自动挂载

```bash
sudo mkdir -p /mnt/ssd
sudo mount /dev/nvme1n1p1 /mnt/ssd
sudo blkid /dev/nvme1n1p1
```

将 UUID 写入 `/etc/fstab`（示例）：

```fstab
UUID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx /mnt/ssd ext4 defaults,nofail 0 2
```

验证：

```bash
sudo umount /mnt/ssd
sudo mount -a
df -h | grep /mnt/ssd
```

### 7.4 给 Jellyfin 增加 SSD 映射

编辑 `docker-compose.yml`，在 `jellyfin.volumes` 追加：

```yaml
- /mnt/ssd/media:/media/ssd:ro
```

重启：

```bash
sudo docker compose up -d jellyfin
```

然后在 Jellyfin 库中添加多个路径，例如同一个 TV 库同时包含：

- `/media/cloud/quark/TV`
- `/media/local/TV`
- `/media/ssd/TV`

---

## 8. 权限与共享目录说明（你关心的点）

### 8.1 挂载新磁盘会不会有权限问题？

会，常见在这三种情况：

- 目录 owner/group 和容器运行 UID/GID 不一致
- 磁盘文件系统是 NTFS/exFAT，Linux 权限模型不完整
- rclone 挂载参数缺少 `--allow-other` 或 uid/gid 映射

推荐策略：

- 本地数据盘优先 `ext4/xfs`
- 统一容器用户：`PUID=1000`, `PGID=1000`
- 对需要写入的挂载目录执行：

```bash
sudo chown -R 1000:1000 <目录>
sudo chmod -R u+rwX,g+rwX <目录>
```

### 8.2 同一个文件夹/磁盘能给多个容器吗？

可以，完全支持。

推荐按“写入方/读取方”分权：

- 下载器（qBittorrent）挂载 `rw`
- 媒体库（Jellyfin）挂载 `ro`

示例：

```yaml
qbittorrent:
  volumes:
    - /srv/media/incoming:/media/incoming

jellyfin:
  volumes:
    - /srv/media/incoming:/media/incoming:ro
```

这就是生产中最常见、最安全的共享方式。

### 8.3 把挂载网盘直接给 Jellyfin

支持，当前 compose 已经包含：

```yaml
- ${CLOUD_MOUNT_ROOT}:/media/cloud:ro
```

也就是宿主机 `/srv/cloud`（rclone 挂载点）会映射到 Jellyfin 的 `/media/cloud`。  
你只需要在 Jellyfin 后台给媒体库增加路径，例如：

- `/media/cloud/quark/TV`
- `/media/cloud/alipan/Movies`

验证容器内是否可见：

```bash
sudo docker compose exec jellyfin ls -lah /media/cloud
```

### 8.4 网盘写入数据（可写场景）

支持，但要区分两类：

1. 普通文件复制/整理：可以写入网盘挂载目录（`/srv/cloud/...`）。
2. BT 直接下载到网盘：不推荐，随机写多，容易触发云盘限速/失败。

推荐方案（生产更稳）：

- qBittorrent 写本地盘：`/srv/downloads`
- 下载完成后再用 `rclone move/copy` 推送到网盘

示例（手动推送）：

```bash
sudo rclone move /srv/downloads openlist:/quark/downloads --progress --transfers 4 --checkers 8
```

如果你明确要“容器直接写网盘目录”，也可以把目录以 `rw` 挂给写入容器，例如：

```yaml
qbittorrent:
  volumes:
    - /srv/cloud/quark:/downloads-cloud
```

然后在 qBittorrent 里把保存路径改成 `/downloads-cloud`。  
同时建议保留 Jellyfin 对同目录 `:ro` 只读挂载。

---

## 9. 故障排查（你日志里的两个典型错误）

### 9.1 OpenList: `Current user does not have write and/or execute permissions`

处理：

```bash
sudo mkdir -p /srv/docker/openlist
sudo chown -R 1000:1000 /srv/docker/openlist
sudo chmod -R u+rwX,g+rwX /srv/docker/openlist
sudo docker compose up -d --force-recreate openlist
```

并确认 `docker-compose.yml` 是：

```yaml
- ${OPENLIST_DATA}:/opt/openlist/data
```

### 9.2 Watchtower: `client version 1.25 is too old`

处理：

- 保持 compose 中有：

```yaml
environment:
  - DOCKER_API_VERSION=1.44
```

- 然后重建：

```bash
sudo docker compose up -d --force-recreate watchtower
```

---

## 10. 重新部署（两种模式）

### 10.1 保留数据重装（推荐）

```bash
cd /srv/arkstack
sudo docker compose down --remove-orphans
sudo docker compose pull
sudo docker compose up -d --build
```

### 10.2 全量清空重装（危险）

```bash
cd /srv/arkstack
sudo docker compose down -v --remove-orphans
# 确认你不需要旧数据后再执行
sudo rm -rf /srv/docker/caddy /srv/docker/openlist /srv/docker/jellyfin /srv/docker/qbittorrent
```

然后回到“第 4 章 从零部署”。

---

## 11. 常用运维命令

```bash
# 查看状态
sudo docker compose ps

# 查看日志
sudo docker compose logs -f caddy
sudo docker compose logs -f openlist
sudo docker compose logs -f jellyfin
sudo docker compose logs -f qbittorrent
sudo docker compose logs -f watchtower

# 重启单服务
sudo docker compose up -d --force-recreate openlist

# 拉取并更新
sudo docker compose pull
sudo docker compose up -d

# 查看 Caddy 是否含 cloudflare dns 模块
sudo docker compose exec caddy caddy list-modules | rg cloudflare
```

---

## 12. 安全建议

- `CF_DNS_API_TOKEN` 只给最小权限：`Zone.DNS:Edit` + `Zone:Read`
- OpenList WebDAV 端口仅本地监听（当前已是 `127.0.0.1:25244`）
- Jellyfin 对网盘目录建议 `:ro` 只读
- 公网场景建议叠加 Fail2ban / CrowdSec / Cloudflare Access
- qBittorrent 首次登录后立即修改管理员密码
