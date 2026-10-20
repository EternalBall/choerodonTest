# Choerodon Pro Upload / Attachment

源码：[components-pro/upload](https://github.com/open-hand/choerodon-ui/tree/master/components-pro/upload)、[attachment](https://github.com/open-hand/choerodon-ui/tree/master/components-pro/attachment)。  
HZero / 业务表单更常见 **Attachment**（桶、UUID、分片）；导入导出按钮有时只是 `Upload` 包一层。

| 组件 | 前缀 | 典型场景 |
|------|------|----------|
| **Upload** | `.c7n-pro-upload` | 简单选文件上传；`action` URL |
| **Attachment** | `.c7n-pro-attachment` | 表单附件字段；`bucketName` / `storageCode` / `attachmentUUID` |

## Upload DOM

```
.c7n-pro-upload
  └── .c7n-pro-upload-select
        └── input[type=file]          # opacity:0 盖在按钮上
.c7n-pro-upload-list
  └── .c7n-pro-upload-list-item
        ├── .c7n-pro-upload-list-item-name
        ├── .c7n-pro-upload-list-item-progress
        └── .c7n-pro-upload-list-item-remove
```

`uploadImmediately` 默认 true：选完即传。false 时组件自带上传按钮。

## Attachment DOM

```
.c7n-pro-attachment
  ├── .c7n-pro-attachment-header
  │     └── .c7n-pro-attachment-header-buttons   # 上传/下载全部等
  ├── .c7n-pro-attachment-list[-card]
  │     └── .c7n-pro-attachment-list-item
  │           ├── .c7n-pro-attachment-list-item-name / -link
  │           └── .c7n-pro-attachment-list-item-buttons  # download / remove（hover 显）
  └── .c7n-pro-attachment-drag                   # Dragger 虚线框
```

`viewMode`: `list` | `popup` | `none`；`listType`: `text` | `picture` | `picture-card`。  
删除可配 `removeConfirm`（Popconfirm）。`uploadImmediately` / `removeImmediately` 控制是否立刻打后端。

## 源码识别

- `<Upload action="/…/upload" />` → `action` 即上传 URL（可写 api）  
- `<Attachment bucketName … />` / Field `type: attachment` → 全局 `attachment` 配置拼 URL  
- 工具栏「导入」：常 `Upload` + 自定义 `action`；「导出」多为下载链接/按钮，不是本组件  

## 分析产物

```yaml
field_rules:
  - name: files
    control: attachment     # upload | attachment
operations:
  - id: detail_upload_file
    type: update
    fields: [files]
    api: /v1/.../upload...  # 有字面量才写
```

## 自动化步骤

Playwright 对隐藏 file input：

1. 定位 `input[type=file]`（在 upload-select / attachment 内）  
2. `setInputFiles(path)`（**不要**依赖系统文件对话框人工点选）  
3. 等列表出现 `.c7n-pro-upload-list-item` / `.c7n-pro-attachment-list-item`  
4. 若需断言接口：`clickExpectApi` 或 wait response（url 来自源码）  
5. 删除：hover item → 点 remove；若有 Popconfirm 再确定  

Dragger：同样对内部 `input[type=file]` setInputFiles，或把文件放到 drop 目标（优先 setInputFiles）。

```yaml
uploadInput:
  css: .c7n-pro-upload-select input[type="file"]
attachmentRoot:
  css: .c7n-pro-attachment
attachmentListItem:
  css: .c7n-pro-attachment-list-item
```

## 常见误判

| 错误 | 正确 |
|------|------|
| 点「上传」期望系统对话框可自动化 | 用 `setInputFiles` |
| Attachment 当普通 Modal 上传 | 列表/按钮在字段内，未必开 Modal |
| 未配置 api 就猜 OSS 路径 | api-binding：无字面量留空 |
| 与 Message「上传成功」toast 混为 successToast「成功」 | 按实际文案断言 |
