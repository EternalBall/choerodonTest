# 步骤截图约定

报告里的步骤截图用于人工核对，**不要用 `fullPage: true` 作为默认**。

## 为何 fullPage 会「样式不对」

Playwright `page.screenshot({ fullPage: true })` 会滚动拼接整页：

- **fixed / sticky**（Choerodon Modal Drawer、页头）常被贴到长图底部或错位
- **flex / filterBar / 宽表** 在 stitch 时放大镜、清除图标可能跑到输入框下方，列也对不齐

真机 UI 往往正常，只是报告图失真。

## 约定

| 场景 | 写法 |
|------|------|
| 默认（列表/详情/表单/抽屉打开后） | `screenshot: true` → **仅视口**（`fullPage: false`），含 overlay 与背后页面 |
| 关闭截图 | `screenshot: false` |
| 只要某个控件（少用） | `screenshot: { target: feat_xxx.copyDrawer }` |
| 确需整页（无 overlay） | `screenshot: { fullPage: true }`（慎用） |

```yaml
- name: 打开复制抽屉
  action: click
  args:
    target: feat_xxx.copyBtn
  ready:
    visible: feat_xxx.copyDrawer
  screenshot: true   # 视口：右侧抽屉 + 详情上下文
```

实现：`tests/config-driven.spec.ts` 的 `normalizeScreenshot`。
