# Choerodon 旧版 Tree / Transfer / Upload / ImageCrop（choerodon-ui，非 Pro）

源码模块：`components/tree`、`components/transfer`、`components/upload`、`components/image-crop`（`components/index.tsx` 导出：Tree:128、Transfer:126、Upload:142、ImageCrop:72）。  
类名前缀 `c7n`（`components/configure/default.tsx:96`），各组件用 `getPrefixCls(suffix)` 拼成 `c7n-<suffix>`：tree/index.tsx:229、transfer/index.tsx:432、upload/Upload.tsx:380、image-crop/index.tsx:230。  
机器可读：建议键见各节末尾，汇总在 `kit-choerodon-legacy-tree-transfer.yaml`（尚未合入 `platform/choerodon/kit.yaml`）。

## 旧版 vs Pro 区分

| 维度 | 旧版（本文） | Pro（已有 playbook） |
|------|--------------|----------------------|
| JSX 导入路径 | `import { Tree, Transfer, Upload, ImageCrop } from 'choerodon-ui'` | `import { Transfer, Upload } from 'choerodon-ui/pro'` |
| 类名前缀 | `c7n-tree` / `c7n-transfer` / `c7n-upload` / `c7n-image-crop` | `c7n-pro-transfer` / `c7n-pro-upload`（树下拉为 `c7n-pro-tree-select`） |
| 是否绑定 DataSet | 否：四个目录均无 DataSet 引用，靠 `dataSource` / `targetKeys` / `fileList` / `onChange` 受控 | 是：Field `type` / `lookupCode` / `dataSet` |
| 同名 Pro playbook | Tree 展示节见 [choerodon-tree.md](./choerodon-tree.md)（其 Tree 小节即 `.c7n-tree`，本篇不重复）；ImageCrop 无 Pro 版 | Transfer 见 [choerodon-transfer-screening.md](./choerodon-transfer-screening.md)；Upload 见 [choerodon-upload.md](./choerodon-upload.md) |

---

## Tree

源码：[components/tree](https://github.com/open-hand/choerodon-ui/tree/master/components/tree)  
基础展开 / 选中 / 勾选操作见 [choerodon-tree.md](./choerodon-tree.md)；本节补充旧版 rc-tree 类名与 DirectoryTree 差异。

### DOM

```
.c7n-tree[.c7n-tree-show-line|.c7n-tree-directory]       # tree/index.tsx:229
  └── .c7n-tree-treenode[-selected|-disabled|-switcher-open|-switcher-close|-checkbox-checked]
        ├── span.c7n-tree-switcher[.c7n-tree-switcher-noop]  # 叶子为 noop（rc-components/tree/TreeNode.tsx:370）
        │     └── span.c7n-tree-switcher-loading-icon         # 异步加载中（tree/index.tsx:191）
        ├── span.c7n-tree-checkbox[-checked|-indeterminate]  # checkable 时（TreeNode.tsx:408-411）
        └── span.c7n-tree-node-content-wrapper[.c7n-tree-node-selected]   # TreeNode.tsx:447,485
              └── span.c7n-tree-title                        # TreeNode.tsx:476
```

`Tree.DirectoryTree`（静态属性，tree/index.tsx:157）根上额外带 `c7n-tree-directory`（DirectoryTree.tsx:249）。

### 源码识别

1. JSX：`<Tree treeData onSelect onCheck>`、`Tree.TreeNode`、`Tree.DirectoryTree`；无 DataSet。
2. `checkable` → 出现 `.c7n-tree-checkbox`；`loadData` → 展开时出现 `.c7n-tree-switcher-loading-icon`。
3. `showLine` → 根节点追加 `.c7n-tree-show-line`（tree/style/index.less 的 `&-show-line`）。
4. 与 Table `mode="tree"`（行内展开）不是同一控件，见 [choerodon-table.md](./choerodon-table.md)。

### 分析产物

```yaml
field_rules:               # 仅当树节点值写入表单字段时；旧版无 DataSet，需功能层给 css
  - name: deptId
    control: legacy_tree
```

### 自动化步骤

1. 限定容器：用页面内容区或 `legacyTreeRoot` 收窄，避免多棵树冲突。
2. 展开父节点：`click` `treeSwitcher`（已排除 noop），限定到 `legacyTreeNodeRow` 且 `hasText` 父节点文案；`assertVisible` 子节点。
3. 选中节点：`click` `treeNodeContent`，`hasText` 节点文案；`assertVisible` `treeNodeSelected`。
4. 勾选：`click` `legacyTreeCheckbox`，限定到对应 `legacyTreeNodeRow`。
5. 异步加载：先 `click` 展开，`waitFor` `legacyTreeSwitcherLoading` 消失，再点子节点。
6. 无专用关键字，以上用 click / assertVisible / waitFor 组合。

```yaml
# kit（建议新增；treeRoot / treeSwitcher / treeNodeContent / treeNodeSelected 已存在，不重复）
legacyTreeNodeRow:
  css: .c7n-tree-treenode
legacyTreeCheckbox:
  css: .c7n-tree-checkbox
  note: 必须 within legacyTreeNodeRow
legacyTreeSwitcherLoading:
  css: .c7n-tree-switcher-loading-icon
legacyTreeDirectory:
  css: .c7n-tree-directory
```

---

## Transfer

源码：[components/transfer](https://github.com/open-hand/choerodon-ui/tree/master/components/transfer)  
与 Pro Transfer 的关键差异：旧版箭头是**带文案的按钮**（默认 `>` / `<`），Pro 是无文案图标按钮；旧版左右两列共用同一类名 `c7n-transfer-list`。
### DOM

```
div.c7n-transfer                                            # transfer/index.tsx:452-457
  ├── div.c7n-transfer-list[.c7n-transfer-list-with-footer]  # 左列（index.tsx:464）
  │     ├── div.c7n-transfer-list-header                      # list.tsx:288
  │     │     ├── 全选 .c7n-checkbox（Checkbox 默认前缀，checkbox/Checkbox.tsx:96）
  │     │     ├── span.c7n-transfer-list-header-selected      # 「n/m 项」
  │     │     └── span.c7n-transfer-list-header-title         # titles[0]
  │     ├── div.c7n-transfer-list-body[.c7n-transfer-list-body-with-search]   # list.tsx:256
  │     │     ├── div.c7n-transfer-list-body-search-wrapper > input.c7n-transfer-list-search   # showSearch
  │     │     ├── <<待核实：列表容器标签（ul/div）>> .c7n-transfer-list-content
  │     │     │     └── li.c7n-transfer-list-content-item[-highlight|-disabled]   # item.tsx:26-28
  │     │     │           ├── .c7n-checkbox
  │     │     │           └── span（render 内容）
  │     │     └── div.c7n-transfer-list-body-not-found        # 列表为空（list.tsx:269）
  │     └── div.c7n-transfer-list-footer                      # footer 渲染（list.tsx:273）
  ├── div.c7n-transfer-operation                              # 中间按钮组（index.tsx:489）
  │     ├── button（左移，operations[1] = '<'）                 # 先渲染
  │     └── button（右移，operations[0] = '>'）
  ├── div.c7n-transfer-list                                   # 右列（index.tsx:500）
  └── div.c7n-transfer-sort                                   # sortable 时（index.tsx:527）
```

无可移动项时按钮禁用（operation.tsx:43-53）。

### 源码识别

1. JSX：`<Transfer>`，`dataSource` 必填，`targetKeys` 决定右列；无 DataSet。
2. `showSearch` → 左列出现搜索框；`sortable` → 出现 `.c7n-transfer-sort`，按钮文案默认 `∧` / `∨`。
3. `lazy` 默认 `{}`（react-lazy-load，list.tsx:61）：**视口外条目不在 DOM**，大数据需滚动后再查找；`lazy={false}` 可关闭。

### 分析产物

```yaml
field_rules:
  - name: categories
    control: legacy_transfer   # 双列穿梭；Pro 同名字段为 transfer
```

### 自动化步骤

1. 左列定位：`legacyTransferLeftList`；右列：`legacyTransferRightList`（`:nth-of-type` 区分，DOM 顺序 1 / 3）。
2. 勾选左列条目：`click` `legacyTransferItem`，限定 `legacyTransferLeftList`，`hasText` 文案。
3. 右移：`click` `legacyTransferMoveRightBtn`（默认文案 `>`，可用 hasText 校验）。
4. 验证：`assertVisible` `legacyTransferItem`，限定 `legacyTransferRightList`。
5. 搜索（showSearch）：`fill` `legacyTransferSearchInput`，限定左列，`value` 为关键字。
6. 左移：先在右列勾选，再 `click` `legacyTransferMoveLeftBtn`。

```yaml
# kit（建议新增；与 Pro 的 transferXxx 键不重名）
legacyTransferRoot:
  css: .c7n-transfer
legacyTransferLeftList:
  css: .c7n-transfer > .c7n-transfer-list:nth-of-type(1)
legacyTransferRightList:
  css: .c7n-transfer > .c7n-transfer-list:nth-of-type(3)
legacyTransferItem:
  css: .c7n-transfer-list-content-item
  note: 必须 within 列表使用
legacyTransferHeaderCheckbox:
  css: .c7n-transfer-list-header .c7n-checkbox
  note: 必须 within 列表使用
legacyTransferSearchInput:
  css: .c7n-transfer-list-search
legacyTransferMoveRightBtn:
  css: .c7n-transfer-operation > button:nth-of-type(2)
  note: 默认文案 '>'；operations 自定义时以 hasText 为准
legacyTransferMoveLeftBtn:
  css: .c7n-transfer-operation > button:nth-of-type(1)
  note: 默认文案 '<'
legacyTransferSort:
  css: .c7n-transfer-sort
```

---

## Upload

源码：[components/upload](https://github.com/open-hand/choerodon-ui/tree/master/components/upload)  
Pro Upload 与 Attachment 见 [choerodon-upload.md](./choerodon-upload.md)。旧版 `<Upload>` 的列表项前缀是 `c7n-upload-list-item`，Pro 是 `c7n-pro-upload-list-item`，不要混用。

### DOM

```
div.c7n-upload.c7n-upload-select[.c7n-upload-select-<listType>|.c7n-upload-select-popup-<listType>|.c7n-upload-disabled|.c7n-upload-drag-btn]   # Upload.tsx:585-594
  └── input[type=file]                  # 隐藏，由 rc-upload 渲染 <<待核实：rc-components/upload/Upload.jsx 中 input 外层类名>>

div.c7n-upload.c7n-upload-drag[-uploading|-hover|-disabled]     # Dragger，Upload.tsx:555-559
  └── .c7n-upload-drag-container > …                            # Upload.tsx:569

div.c7n-upload-list.c7n-upload-list-<text|picture|picture-card>[.c7n-upload-list-drag]   # UploadList.tsx:470-473
  └── div.c7n-upload-list-item[-done|-error|-uploading]         # UploadList.tsx:439-440
        ├── span.c7n-upload-list-item-name                      # 文件名
        ├── span.c7n-upload-list-item-info-filesize            # showFileSize
        ├── div.c7n-upload-list-item-progress                  # 上传中
        └── span.c7n-upload-list-item-action-remove             # picture-card 删除（UploadList.tsx:334）
```

`picture-card` 的操作区为 `.c7n-upload-actions` > `.c7n-upload-other-actions`（UploadList.tsx:406-414）。文本模式下删除按钮类名 <<待核实：text 模式 remove 的类名>>。

### 源码识别

1. JSX：`<Upload action="…">`、`<Upload.Dragger>`（upload/index.tsx:8）。`action` 为必选 URL，**不得猜测**，无字面量则留空并参考 api-binding。
2. `listType` 决定列表形态；`viewMode="popup"` 时选择按钮是 `.c7n-upload-select-popup-<listType>`。
3. `dragUploadList` 开启拖拽排序（`.c7n-upload-list-drag`）。
4. 无 DataSet；需与 Pro `<Upload>`（`.c7n-pro-upload-*`）区分。

### 分析产物

```yaml
field_rules:
  - name: attachments
    control: legacy_upload     # 旧版无 DataSet；action 有字面量才写到 operations
```

### 自动化步骤

Playwright 对隐藏 file input 直接 `setInputFiles`（与 [choerodon-upload.md](./choerodon-upload.md) 一致）；`setInputFiles` 不是 suite 关键字 <<待核实：suite 是否有文件上传关键字>>。

1. `setInputFiles` 到 `legacyUploadFileInput`（限定到上传区）。
2. 等待完成：`waitFor` `legacyUploadListItemDone`，`hasText` 文件名。
3. 上传失败：`assertVisible` `legacyUploadListItemError`。
4. 接口断言：若需断言请求，用 `waitFor` 响应，URL 取 `action` 字面量。
5. 删除（picture-card）：`click` `legacyUploadRemoveBtn`，hover 列表项后可见。

```yaml
# kit（建议新增；uploadInput / uploadListItem 为 Pro 键，不重复）
legacyUploadRoot:
  css: .c7n-upload
legacyUploadFileInput:
  css: .c7n-upload input[type="file"]
  note: 待核实 input 外层，选择器需在运行页面确认
legacyUploadDragger:
  css: .c7n-upload-drag
legacyUploadListItem:
  css: .c7n-upload-list-item
legacyUploadListItemDone:
  css: .c7n-upload-list-item-done
legacyUploadListItemError:
  css: .c7n-upload-list-item-error
legacyUploadRemoveBtn:
  css: .c7n-upload-list-item-action-remove
  note: 仅 picture-card；text 模式待核实
```

---

## ImageCrop

源码：[components/image-crop](https://github.com/open-hand/choerodon-ui/tree/master/components/image-crop)  
无 Pro 版同名 playbook。内部使用 Pro NumberField 作为比例输入框（image-crop/index.tsx:4,562,568），其 DOM 见 [choerodon-number-input.md](./choerodon-number-input.md)。

### DOM

```
div.c7n-modal.c7n-image-crop-modal                       # wrapClassName，index.tsx:518（modal 前缀 <<待核实>>）
  ├── .c7n-modal-body
  │     ├── .c7n-image-crop-container > .c7n-image-crop-media   # react-easy-crop classes 映射，index.tsx:182
  │     └── .c7n-image-crop-control                          # index.tsx:532
  │           ├── .c7n-image-crop-btn-actual-size            # 1:1 按钮（index.tsx:553）
  │           └── .c7n-image-crop-aspect-input               # showAspectInput（index.tsx:561）
  │                 ├── .c7n-image-crop-aspect-input-width   # Pro NumberField，suffixCls 'input-number'
  │                 ├── span.c7n-image-crop-aspect-input-divider  # "/"
  │                 └── .c7n-image-crop-aspect-input-height
  └── .c7n-modal-footer                                      # 确定 / 取消按钮，文案 <<待核实：locale imageCrop>>

# 头像版 ImgCrop.AvatarUploader（index.tsx:598）
.c7n-avatar-crop-dragger                                     # image-crop/style/index.less 的 @image-avatar-prefix-cls
.avatar-modal                                                # 无前缀，avatarUpload.tsx:487
```

`ImgCrop` 引入了 `Upload`（index.tsx:11）；子节点作为触发器、选图后弹出裁剪 Modal 的具体流程 <<待核实：index.tsx 中 Upload 的挂载位置>>。

### 源码识别

1. JSX：`<ImageCrop aspect shape onOk={({url, blob, area}) => …}>`（demo/basic.md），子节点为触发按钮；`ImageCrop.AvatarUploader` 为头像版。
2. `showAspectInput` → 出现比例输入；`rotate` / `zoom` / `grid` 分别影响控制区内容。
3. 无 DataSet；`modalVisible` 可受控。
4. 头像版 `.avatar-modal` 无前缀，勿用 `c7n-` 选择器。

### 分析产物

```yaml
field_rules:
  - name: avatarUrl
    control: legacy_image_crop   # 裁剪结果写回字段；无 DataSet
```

### 自动化步骤

1. 点击触发器（子节点）；等待 `legacyImageCropModal` 可见。
2. 选图：`setInputFiles` 到触发器内的 file input <<待核实：ImgCrop 包裹的 Upload input 位置>>。
3. 比例：`fill` `legacyImageCropAspectWidth` / `legacyImageCropAspectHeight`，`press` Tab 提交 <<待核实：NumberField 提交时机>>。
4. 1:1：`click` `legacyImageCropActualSize`。
5. 确定：`click` `.c7n-modal-footer` 内确定按钮；`assertVisible` 弹窗消失，若配置 `serverCrop` 则 waitFor 对应请求。

```yaml
# kit（建议新增）
legacyImageCropModal:
  css: .c7n-image-crop-modal
legacyImageCropActualSize:
  css: .c7n-image-crop-btn-actual-size
legacyImageCropAspectWidth:
  css: .c7n-image-crop-aspect-input-width input
legacyImageCropAspectHeight:
  css: .c7n-image-crop-aspect-input-height input
legacyAvatarCropDragger:
  css: .c7n-avatar-crop-dragger
```

---

## 常见误判

| 错误 | 正确 |
|------|------|
| 旧版 Transfer 箭头按 Pro 的 `icon-navigate_next` 定位 | 旧版为文案按钮 `>` / `<`，用 `.c7n-transfer-operation > button:nth-of-type(n)` |
| 认为点击条目即搬移 | 点击只切换勾选，需点箭头 |
| 左右列都写 `.c7n-transfer-list` 不收窄 | 用 `legacyTransferLeftList` / `legacyTransferRightList` |
| 旧版 Upload 列表用 `c7n-pro-upload-list-item` | 旧版为 `c7n-upload-list-item` |
| 旧版 Tree 用 `c7n-pro-tree-select` | 展示树为 `c7n-tree`；下拉树见 choerodon-tree.md |
| Transfer 大列表直接找不到项 | 默认 lazy，需滚动 |
| ImageCrop 头像弹窗用 `.c7n-image-crop-modal` | 头像版为 `.avatar-modal` |
