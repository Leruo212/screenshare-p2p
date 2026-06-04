# ScreenShare P2P v2

朋友之间一键共享屏幕。无需云服务器，浏览器直连，跨网络工作。

## 怎么用

**入口 URL**（公网，朋友能直接打开）：
```
https://leruo212.github.io/screenshare-p2p/screenshare.html
```
把这个 URL 收藏书签。每次想共享屏幕就从书签进入。

**主叫方（你）**：
1. 打开上面那个 URL
2. 点 "创建房间" → 立刻得到一个 12 位房间号 + 分享链接（链接形如 `…/screenshare.html#Xxxx-Yyyy-Zzzz`）
3. 把这个链接发给朋友（微信、QQ、邮件都行）
4. 等朋友连上后，点 "开始共享" → 选屏幕/窗口/标签页 → 完成
5. 想停止：点 "停止共享" 或直接关掉浏览器标签

**被叫方（朋友）**：
1. 收到链接后点击（默认浏览器打开，无需安装任何东西）
2. 自动连接，弹出"等待主机共享..."提示
3. 主机开始共享后，立刻看到画面 + 听到系统声音

## 浏览器要求

- **Chrome 100+ / Edge 100+ / Firefox 100+**（桌面版）
- 不支持 Safari
- 需要 `getDisplayMedia` API（浏览器自带）

## 网络架构

```
你的浏览器 ←→ GitHub Pages（HTML 静态托管，免费）
你的浏览器 ←→ PeerJS 公共 broker（只交换握手信令，看不到屏幕内容）
你的浏览器 ←→ 朋友的浏览器（WebRTC P2P，端到端加密的屏幕流）
```

- **GitHub Pages** 托管 HTML，朋友能从任何网络打开
- **PeerJS broker** 只看到"用户 A 想连到房间 xyz"，**看不到也解不开**屏幕数据
- **WebRTC P2P** 媒体流在你的电脑和朋友的电脑之间直连

## 安全模型

| 谁 | 看到什么 |
|---|---|
| 朋友 | 你共享的屏幕 + 系统音频（你授权了） |
| PeerJS broker | 你的 IP、房间号、"用户 A 想连到房间 xyz" — **看不到也解不开**屏幕数据 |
| 任何其他人 | 你的 12 位房间号 62¹² ≈ 3×10²¹ 组合，暴力破解不可能 |

类比：broker 是个介绍所，只看到"你登记想找对象"，看不到婚后家庭隐私。

## 限制（v1 已知）

- 停止共享后，**需要重新创建房间**才能再次共享（MediaConnection 单次使用）
- 不支持语音（麦克风输入）
- 不支持远程控制
- 不支持手机端（iOS Safari 屏幕捕获受限）
- 如果双方都是"严格对称 NAT"（少见，多见于企业网关），可能连不上 — 解法：一方用 VPN/Tailscale/ZeroTier 创造虚拟局域网

## 失败排查

- **朋友点链接后一直是"正在连接..."** → 检查双方网络；如果反复失败，让其中一方装个 Tailscale
- **浏览器弹出"无法访问屏幕"** → 用户拒绝了屏幕共享权限，重新点"开始共享"会再次询问
- **看不到声音** → 浏览器选择屏幕时，下面要勾上"分享标签页音频"（仅 Chrome 支持系统音频）

## 开发者说明

```bash
npm install   # 装 vitest + jsdom
npm test      # 跑所有 115 个测试
npm run build # 重新生成 screenshare.html
```

源码在 `src/`，每个模块独立可测。`build.js` 把 ESM 源码转成单一 inline 脚本（因为 `file://` 不支持 `type="module"`）。

### 重新部署

修改源码后：
1. `npm run build` 重新生成 `screenshare.html`
2. `git add screenshare.html && git commit -m "..." && git push`
3. GitHub Pages 1 分钟内自动更新

