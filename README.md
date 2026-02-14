# ArkMedia Stack（独立多栈版）

面向 Debian/PVE 的家用媒体方案，默认组件：

- OpenList（网盘聚合）
- Emby（媒体库/播放）
- qBittorrent（下载）
- Caddy（统一 HTTPS 入口，Cloudflare DNS 证书）
- Watchtower（自动更新）
- rclone + systemd（把 OpenList 挂载到宿主机）

核心目标：

- 不依赖 80/443/8080
- 单域名 + 多端口访问
- 每个服务独立 `docker-compose.yml`，便于独立启停与维护

---

## 1. 目录结构

```text
/srv/arkstack
├── .env
├── gateway/
│   ├── docker-compose.yml
│   ├── Dockerfile.caddy
│   └── Caddyfile
├── openlist/
│   └── docker-compose.yml
├── emby/
│   └── docker-compose.yml
├── qbittorrent/
│   ├── docker-compose.yml
│   └── init/10-reverse-proxy.sh
├── watchtower/
│   └── docker-compose.yml
├── systemd/
│   ├── rclone-openlist-root.service
│   └── rclone-openlist-drive@.service
└── scripts/
    ├── stack.sh
    ├── add-mount.sh
    └── reset-stack.sh
```

---

## 2. 前置要求

- Debian 12/13
- 已接入 Cloudflare 的域名（如 `pve.example.com`）
- 路由器/防火墙放行你自定义端口（示例：8443/2053/2096）

---

## 3. 安装 Docker 与基础工具

```bash
curl -fsSL https://get.docker.com -o install-docker.sh
sudo sh install-docker.sh
sudo systemctl enable --now docker
sudo docker --version
sudo docker compose version

sudo apt update
sudo apt install -y rclone fuse3 curl
sudo sed -i 's/^#user_allow_other/user_allow_other/' /etc/fuse.conf
```

如果你当前就是 root 用户，去掉命令前的 `sudo` 即可。

---

## 4. 部署步骤

### 4.1 拉取代码并配置环境变量

```bash
sudo mkdir -p /srv/arkstack
sudo chown -R "$USER:$USER" /srv/arkstack
cd /srv/arkstack
sudo git clone https://github.com/RaylenZed/arkmedia-stack.git .
cp .env.example .env
```

编辑 `.env`，至少修改这些项：

- `BASE_DOMAIN`
- `ACME_EMAIL`
- `CF_DNS_API_TOKEN`
- `PUID/PGID`
- `OPENLIST_UID/OPENLIST_GID`
- 各服务公网端口：`EMBY_HTTPS_PORT`、`QBIT_HTTPS_PORT`、`OPENLIST_HTTPS_PORT`

### 4.2 初始化目录（一条命令）

```bash
sudo mkdir -p \
  /srv/docker/{caddy/data,caddy/config,openlist,emby/config,qbittorrent} \
  /srv/media/{local,incoming} \
  /srv/downloads \
  /srv/cloud \
  /var/cache/rclone
```

### 4.3 初始化权限（默认 UID/GID 1000:1000）

```bash
sudo chown -R 1000:1000 /srv/docker/openlist /srv/docker/emby /srv/docker/qbittorrent /srv/downloads /srv/media/incoming
sudo chmod -R u+rwX,g+rwX /srv/docker/openlist /srv/docker/emby /srv/docker/qbittorrent /srv/downloads /srv/media/incoming
sudo chmod 755 /srv /srv/docker /srv/media /srv/cloud /var/cache/rclone
```

如果你在 `.env` 设置的不是 `1000:1000`，上面命令也换成对应 UID/GID。

### 4.4 创建共享 Docker 网络（只需一次）

```bash
source .env
sudo docker network create "${ARK_NETWORK}" 2>/dev/null || true
```

### 4.5 启动所有独立栈

```bash
sudo ./scripts/stack.sh up
sudo ./scripts/stack.sh ps
```

---

## 5. 访问地址（同域名，不同端口）

假设：`BASE_DOMAIN=pve.example.com`

- Emby：`https://pve.example.com:8443`
- qBittorrent：`https://pve.example.com:2053`
- OpenList：`https://pve.example.com:2096`

Cloudflare 里添加 A 记录：

- `pve.example.com -> VPS IP`

建议先灰云（DNS only）验证；若开橙云，端口请使用 Cloudflare 支持的 HTTPS 端口。

---

## 6. 首次初始化

### 6.1 OpenList

1. 打开 `https://pve.example.com:2096`
2. 创建管理员
3. 添加网盘（夸克/阿里云盘/OneDrive 等）

### 6.2 Emby

1. 打开 `https://pve.example.com:8443`
2. 创建管理员
3. 添加媒体库路径（可多路径）：
- `/media/local/TV`
- `/media/cloud/quark/TV`
- `/media/incoming`

### 6.3 qBittorrent

1. 打开 `https://pve.example.com:2053`
2. 用户名：`admin`
3. 临时密码查看：

```bash
sudo docker compose --env-file /srv/arkstack/.env -f /srv/arkstack/qbittorrent/docker-compose.yml logs qbittorrent | rg -i "temporary password|administrator password"
```

登录后请立即修改密码。

---

## 7. OpenList + rclone 挂载网盘到本地

### 7.1 配置 rclone（写入统一配置文件）

```bash
sudo mkdir -p /etc/rclone
sudo rclone config
```

建议 remote 参数：

- name: `openlist`
- type: `webdav`
- url: `http://127.0.0.1:25244/dav`（如果你改了 `.env` 的 `OPENLIST_LOCAL_PORT`，这里也同步改）
- vendor: `other`
- user/password: OpenList WebDAV 账号

保存后拷贝到固定位置：

```bash
sudo install -m 600 -o root -g root /root/.config/rclone/rclone.conf /etc/rclone/rclone.conf
sudo rclone --config /etc/rclone/rclone.conf lsd openlist:
```

### 7.2 挂载单网盘（挂根目录）

```bash
cd /srv/arkstack
sudo cp systemd/rclone-openlist-root.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now rclone-openlist-root
sudo systemctl status rclone-openlist-root
```

### 7.3 挂载多个网盘（推荐）

```bash
sudo mkdir -p /srv/cloud/{quark,alipan,onedrive}
cd /srv/arkstack
sudo cp systemd/rclone-openlist-drive@.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now rclone-openlist-drive@quark
sudo systemctl enable --now rclone-openlist-drive@alipan
sudo systemctl enable --now rclone-openlist-drive@onedrive
```

验证：

```bash
sudo systemctl status rclone-openlist-drive@quark
sudo systemctl status rclone-openlist-drive@alipan
sudo systemctl status rclone-openlist-drive@onedrive
ls -lah /srv/cloud
```

---

## 8. 给容器追加挂载目录（交互式）

```bash
cd /srv/arkstack
sudo ./scripts/add-mount.sh
```

脚本会：

1. 选择 stack
2. 选择 service
3. 输入宿主机路径与容器路径
4. 设置 `rw/ro`
5. 自动生成对应 stack 的 `docker-compose.override.yml`
6. 仅重建目标 service

说明：

- 不会删除原有数据
- 如果挂载到容器已有内容目录，会“覆盖显示”（不是删除）

---

## 9. SSD 挂载与多媒体目录

### 9.1 新增 SSD

```bash
sudo lsblk -f
sudo mkfs.ext4 /dev/nvme1n1p1
sudo mkdir -p /mnt/ssd
sudo mount /dev/nvme1n1p1 /mnt/ssd
sudo blkid /dev/nvme1n1p1
```

把 UUID 写入 `/etc/fstab` 后验证：

```bash
sudo umount /mnt/ssd
sudo mount -a
df -h | grep /mnt/ssd
```

### 9.2 Emby 扫描多个来源

在 Emby 媒体库里直接加多个路径即可，例如：

- `/media/local/TV`
- `/media/cloud/quark/TV`
- `/media/ssd/TV`

如果要把 SSD 映射给 Emby，可执行 `add-mount.sh`，或手工给 `/srv/arkstack/emby/docker-compose.override.yml` 添加：

```yaml
services:
  emby:
    volumes:
      - /mnt/ssd/media:/media/ssd:ro
```

然后重建 Emby：

```bash
sudo ./scripts/stack.sh restart emby
```

---

## 10. 增加其他业务并接入 SSL（例如 Dify）

1. 新建独立目录（如 `/srv/dify`）和独立 compose。
2. 让它加入同一个外部网络 `ARK_NETWORK`。
3. 在 `/srv/arkstack/gateway/Caddyfile` 增加一个端口反代块。
4. 重启 gateway。

示例 Caddy 片段：

```caddy
{$BASE_DOMAIN}:{$DIFY_HTTPS_PORT} {
    reverse_proxy dify-web:3000
}
```

重启：

```bash
sudo ./scripts/stack.sh restart gateway
```

---

## 11. 运维命令

### 11.1 全栈管理

```bash
sudo ./scripts/stack.sh up
sudo ./scripts/stack.sh down
sudo ./scripts/stack.sh pull
sudo ./scripts/stack.sh ps
sudo ./scripts/stack.sh logs gateway
sudo ./scripts/stack.sh logs qbittorrent
```

### 11.2 单栈管理（示例）

```bash
sudo ./scripts/stack.sh restart emby
sudo ./scripts/stack.sh restart openlist
```

### 11.3 一键重置（危险）

```bash
cd /srv/arkstack
sudo ./scripts/reset-stack.sh
```

---

## 12. 常见问题

### 12.1 OpenList 报权限错误

```bash
cd /srv/arkstack
source .env
sudo mkdir -p "$OPENLIST_DATA"
sudo chown -R "$OPENLIST_UID:$OPENLIST_GID" "$OPENLIST_DATA"
sudo chmod -R u+rwX,g+rwX "$OPENLIST_DATA"
sudo ./scripts/stack.sh restart openlist
```

### 12.2 qBittorrent 无样式/401

本仓库已内置 `qbittorrent/init/10-reverse-proxy.sh` 自动写入反代兼容配置。

如果仍异常：

```bash
sudo ./scripts/stack.sh restart qbittorrent
sudo ./scripts/stack.sh restart gateway
sudo docker compose --env-file /srv/arkstack/.env -f /srv/arkstack/qbittorrent/docker-compose.yml logs qbittorrent --tail=120
```

并用浏览器无痕窗口访问。

### 12.3 证书失败

优先检查：

- `BASE_DOMAIN` 是否解析到 VPS
- `CF_DNS_API_TOKEN` 权限是否包含 `Zone.DNS:Edit` + `Zone:Read`
- Cloudflare 是否限制了对应端口

查看网关日志：

```bash
sudo ./scripts/stack.sh logs gateway
```

---

## 13. 安全建议

- Cloudflare Token 最小权限
- OpenList WebDAV 仅本地监听（127.0.0.1）
- 媒体目录优先 `:ro`
- 公网建议叠加 Fail2ban/CrowdSec/Cloudflare Access
