/** 带文案按钮的语义键名：纯字母文案直接用，常见中文文案查表；查不到返回 undefined（交给 LLM 命名） */
const TEXT_KEYS: Record<string, string> = {
  编辑: 'Edit', 取消: 'Cancel', 保存: 'Save', 新建: 'Create', 删除: 'Delete', 返回: 'Back', 确定: 'Ok',
  关闭: 'Close', 确认: 'Confirm', 提交: 'Submit', 重置: 'Reset', 状态变更: 'ChangeStatus', 新增: 'Add',
  查询: 'Query', 打印: 'Print', 导出: 'Export', 导入: 'Import', 提交审批: 'SubmitApproval', 审批: 'Approve',
  审核: 'Review', 发布: 'Publish', 修改: 'Modify', 退回: 'SendBack', 解绑: 'Unbind', 合并: 'Merge',
  拆分: 'Split', 登录: 'Login', 历史查询: 'HistoryQuery', 取消指定: 'CancelAppoint', 另存为: 'SaveAs',
  保存并新建下一条: 'SaveAndNext', 保存并提交: 'SaveAndSubmit', 提交并打印: 'SubmitAndPrint',
  重新打印: 'Reprint', 审批信息查看: 'ViewApproval', 数据上传: 'UploadData', 下载: 'Download', 上传: 'Upload',
  复制: 'Copy', 刷新: 'Refresh', 搜索: 'Search', 展开: 'Expand', 收起: 'Collapse', 更多: 'More',
  应用至所有行: 'ApplyToAllRows', 清空: 'Clear', 清除: 'Purge', 创建: 'Establish', 创建单据: 'CreateDoc',
  创建送货单: 'CreateDelivery', 查看历史版本: 'ViewHistoryVersion', 生成报告: 'GenerateReport',
};

export function buttonKeyFromText(text: string): string | undefined {
  const t = text.trim();
  if (/^[A-Za-z]{2,24}$/.test(t)) return `btn${t.charAt(0).toUpperCase()}${t.slice(1)}`;
  const e = TEXT_KEYS[t];
  return e ? `btn${e}` : undefined;
}
