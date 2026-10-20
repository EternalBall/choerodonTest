# 操作手册（Playbooks）

**组件知识**：Choerodon / HZero 上「某类 UI 怎么操作、怎么从源码认 API」，供 **分析**（识别元操作）与 **生成**（元操作 → suite 时定位与 keyword 转换）注入 LLM，并供人工参阅。

**不包含**：功能路径描述、`meta_ops`/`flows` 编排、截图报告约定（见 [docs/meta-ops-flows.md](../../docs/meta-ops-flows.md)、[docs/screenshot.md](../../docs/screenshot.md)）。

## 索引

| 文件 | 主题 |
|------|------|
| [choerodon-table.md](./choerodon-table.md) | Table 壳 / 分页 / 勾选 / 工具栏（总册） |
| [choerodon-table-filterBar.md](./choerodon-table-filterBar.md) | 列表动态筛选条（filterBar） |
| [choerodon-table-queryBar.md](./choerodon-table-queryBar.md) | professionalBar / advancedBar / queryBar 对照 |
| [choerodon-create-detail.md](./choerodon-create-detail.md) | 新建 / 详情 / 编辑状态机 |
| [choerodon-table-row-edit.md](./choerodon-table-row-edit.md) | 表头编辑、增删行、行内 Lov/Switch、Popconfirm |
| [choerodon-modal.md](./choerodon-modal.md) | Modal / Drawer / Confirm |
| [choerodon-select.md](./choerodon-select.md) | Select / Lookup（与 Lov 区分） |
| [choerodon-lov.md](./choerodon-lov.md) | Lov（lovCode / Modal·Drawer·popup 选表） |
| [choerodon-date-picker.md](./choerodon-date-picker.md) | DatePicker（calendar-picker） |
| [choerodon-row-dropdown.md](./choerodon-row-dropdown.md) | 行内「更多」Dropdown / Menu |
| [choerodon-upload.md](./choerodon-upload.md) | Upload / Attachment |
| [choerodon-tabs.md](./choerodon-tabs.md) | Tabs（c7n-tabs） |
| [choerodon-tree.md](./choerodon-tree.md) | Tree / TreeSelect / Cascader |
| [choerodon-text-input.md](./choerodon-text-input.md) | TextField / TextArea / Password / Email·Url / IntlField / SecretField / AutoComplete / Mentions |
| [choerodon-number-input.md](./choerodon-number-input.md) | NumberField / Currency / PercentField / Range |
| [choerodon-check-radio-switch.md](./choerodon-check-radio-switch.md) | CheckBox / Radio / Switch / SelectBox / Segmented |
| [choerodon-date-time-ext.md](./choerodon-date-time-ext.md) | DateTimePicker / TimePicker |
| [choerodon-period-picker.md](./choerodon-period-picker.md) | Month / Quarter / Week / YearPicker |
| [choerodon-picker-misc.md](./choerodon-picker-misc.md) | ColorPicker / IconPicker / Rate |
| [choerodon-transfer-screening.md](./choerodon-transfer-screening.md) | Transfer / Screening |
| [choerodon-form.md](./choerodon-form.md) | Form / Output / Button / Row·Col |
| [choerodon-performance-table.md](./choerodon-performance-table.md) | PerformanceTable / Board |
| [choerodon-rich-content.md](./choerodon-rich-content.md) | RichText / CodeArea / Picture / Typography / OverflowTip |
| [choerodon-feedback.md](./choerodon-feedback.md) | Message / Notification / Spin / Progress / Skeleton / Tooltip |
| [page-states.md](./page-states.md) | 页面状态与就绪条件 |
| [row-action.md](./row-action.md) | 行内动作（Radio/Switch 等，非页头保存） |
| [api-binding.md](./api-binding.md) | 从源码抽取 API 字面量 |

### 旧版组件（choerodon-ui，非 Pro，类名前缀 `c7n-`）

| 文件 | 主题 |
|------|------|
| [choerodon-legacy-input.md](./choerodon-legacy-input.md) | 旧版输入框：input、input-number、auto-complete |
| [choerodon-legacy-select.md](./choerodon-legacy-select.md) | 旧版下拉/级联/树选择：select、cascader、tree-select |
| [choerodon-legacy-check.md](./choerodon-legacy-check.md) | 旧版勾选/单选/开关/评分/滑块：checkbox、radio、switch、rate、slider |
| [choerodon-legacy-date.md](./choerodon-legacy-date.md) | 旧版日期/时间/日历：date-picker、time-picker、calendar |
| [choerodon-legacy-table.md](./choerodon-legacy-table.md) | 旧版表格/分页/列表：table、pagination、list |
| [choerodon-legacy-form-button.md](./choerodon-legacy-form-button.md) | 旧版表单/按钮/图标选择：form、button、icon-select、icon |
| [choerodon-legacy-tree-transfer.md](./choerodon-legacy-tree-transfer.md) | 旧版树/穿梭框/上传/裁剪：tree、transfer、upload、image-crop |
| [choerodon-legacy-overlay.md](./choerodon-legacy-overlay.md) | 旧版弹窗/气泡/提示/下拉菜单：modal、popconfirm、popover、tooltip、dropdown |
| [choerodon-legacy-feedback.md](./choerodon-legacy-feedback.md) | 旧版消息/通知/警告/结果/加载：message、notification、alert、result、spin |
| [choerodon-legacy-status.md](./choerodon-legacy-status.md) | 旧版进度/骨架/徽标/标签/头像：progress、skeleton、badge、tag、avatar |
| [choerodon-legacy-nav.md](./choerodon-legacy-nav.md) | 旧版标签页/菜单/步骤条/面包屑/锚点：tabs、menu、steps、breadcrumb、anchor |
| [choerodon-legacy-layout.md](./choerodon-legacy-layout.md) | 旧版布局/栅格/卡片/折叠面板/分割线：layout、row、col、card、collapse、divider |
| [choerodon-legacy-display.md](./choerodon-legacy-display.md) | 旧版时间轴/统计/走马灯/条码/水印：timeline、statistic、carousel、bar-code、water-mark |
| [choerodon-legacy-misc.md](./choerodon-legacy-misc.md) | 旧版固钉/回到顶部/触发器：affix、back-top、trigger |

- **运行时定位**：`platform/choerodon/kit.yaml`（`platformKit` 合并进用例元素）
- **分析阶段**：`ata analyze` 经 `loadPlaybooks()` 加载本目录全部 `*.md`（除 README），注入 DeepSeek 提示词；目录为空则分析失败（ADR 0007/0008）
