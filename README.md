# 拾光相框

[打开拾光相框](https://img.hackx64.eu.org/)

一个免费的中文照片相框工具，面向想轻松装饰生活照、旅行照和家庭合影的用户。选照片、挑相框、保存，三个步骤即可完成。

- 36 款 Canvas 相框，覆盖素雅、花卉、节庆、旅行和纪念。
- 默认保留完整照片和原图比例。相框四边等宽，开口随照片比例变化，全景长图和窄竖图也不会出现过宽的边。也可自选成品比例、旋转、铺满，并在预览图上拖动照片调整裁剪位置。
- 可点按钮选图，电脑上也可以把照片拖到页面任意位置，或复制后按 Ctrl+V 粘贴。
- 支持浏览器可以打开的静态图片格式。HEIC／HEIF 能否打开取决于设备和浏览器。
- 成品为高清 JPG，最长边 4096 像素。iPhone 和 iPad 上主按钮是「保存到相册」，打开系统分享菜单；其他设备以下载为主，支持时也可分享。
- 所有照片处理都在浏览器内完成，无需登录。访问统计由访客自行开启，统计事件不包含照片、文件名和相框选择详情。

## 本地运行

```sh
python3 -m http.server 4173 --bind 127.0.0.1 --directory docs
```

打开 [本地预览](http://127.0.0.1:4173)。发布目录为 `docs/`，无需构建或安装前端依赖。相框配色和定义在 `docs/assets/frames.js`，实时预览和成品共用 `docs/assets/render.js`。修改任何脚本或样式后，把 `index.html` 和各模块 import 中的 `?v=` 版本号统一加一，避免缓存拿到新旧混合的文件。

## 部署

GitHub 仓库的 **Settings → Pages → Build and deployment** 使用 **Deploy from a branch**，选择 `main` 和 `/docs`。推送到 `main` 后，GitHub Pages 会自动重新发布。

自定义域名使用 `img.hackx64.eu.org`。先在 GitHub 的账号设置中验证域名，再在仓库 Pages 设置中填写自定义域名。Cloudflare DNS 中将 `img` 的 CNAME 指向 `txdywy.github.io`。验证并签发 GitHub Pages 证书时先用 DNS only，HTTPS 可用后启用 Cloudflare 代理，并通过匹配该主机名的 Configuration Rule 将源站 TLS 设为 Strict。静态文件使用 Cloudflare 默认缓存行为，HTML 保持可重新验证。参阅 [GitHub Pages 自定义域名](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site)。

GA4 的 Web 数据流衡量 ID 配置在 `docs/assets/analytics.js`。统计只在生产域名且访客允许后运行，记录页面访问、选图、选框、生成成品、点击下载和系统分享操作。网站可观察到的最后一步取决于浏览器，用户能否在相册或下载文件夹找回成品由真机测试验证。

## 验证保存流程

在鸿蒙浏览器、Android Chrome、iPhone Safari 和微信内置浏览器各用一张测试合影走一遍：打开网站、选图、挑选两款相框、确认两端人物完整、保存、退出网页、从设备中找到并打开成品。记录设备、浏览器版本和实际保存位置。换图失败后再验证一次重试。平板覆盖横竖屏，电脑覆盖键盘操作。

## 设计参考

使用清晰对比度、大点击区域、文字和图标合用的按钮、支持键盘操作的控件，且保留浏览器放大功能。参阅 [W3C 适老化 Web 指南](https://www.w3.org/WAI/older-users/developing/)和 [W3C 点击目标尺寸](https://www.w3.org/WAI/WCAG22/Understanding/target-size-enhanced)。

示例照片由内置图像生成工具制作，画面为一位身穿粉色开衫的女士在中式花园杜鹃花旁微笑。
