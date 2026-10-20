#!/usr/bin/env python3
"""对已生成的 suite.yaml 做「测试数据绑定」后处理（物料维护用）。

动机：LLM 生成的用例都是「列表取第一行」，而 UAT 列表顺序不固定，且会修改真实物料。
处理：
  1. 固定执行顺序（先 CREATE 建 autotest 物料，后续用例依赖它；Playwright 为单 worker 顺序执行）
  2. 需要进入详情的用例：先按编码 ${TEST_DATA_PREFIX}${ATA_RUN_ID} 查询，再用 match 精确点开
  3. COPY 的目标编码改为独立编码（避免与源物料同码触发覆盖确认）
  4. 依赖业务数据的用例（默认辅单位需已有主辅单位换算行）打 needs-data 标签并移除，避免误报
用法：python3 scripts/bind_testdata.py cases/generated/<slug>/suite.yaml
"""
import copy
import sys
import yaml

CODE = '${ENV.TEST_DATA_PREFIX}${ENV.ATA_RUN_ID}'
COPY_CODE = '${ENV.TEST_DATA_PREFIX}C${ENV.ATA_RUN_ID}'
ORDER = [
    'QUERY', 'DETAIL', 'CREATE', 'UPDATE', 'COPY',
    'SITE_ASSIGNMENT', 'SITE_ASSIGNMENT_CREATE', 'SITE_ASSIGNMENT_UPDATE',
    'SITE_ASSIGNMENT_DELETE_LINE', 'SITE_PROPERTIES',
]
SKIP = {'SET_DEFAULT_SECONDARY_UOM'}  # 需要已有主辅单位换算数据
NEED_BIND = {'UPDATE', 'COPY', 'SITE_ASSIGNMENT', 'SITE_ASSIGNMENT_CREATE',
             'SITE_ASSIGNMENT_UPDATE', 'SITE_ASSIGNMENT_DELETE_LINE', 'SITE_PROPERTIES'}


def op_of(case_id: str) -> str:
    # TC_FEAT_XXXXXXXX_<OP>
    parts = case_id.split('_', 3)
    return parts[3] if len(parts) == 4 else case_id


def main(path: str) -> None:
    suite = yaml.safe_load(open(path, encoding='utf-8'))
    cases = {op_of(c['id']): c for c in suite['cases']}
    query_step = next(
        s for s in cases['QUERY']['steps'] if s['action'] == 'tableFilterQuery'
    )
    out = []
    for op in ORDER:
        c = copy.deepcopy(cases[op])
        if op in NEED_BIND:
            steps = c['steps']
            idx = next(i for i, s in enumerate(steps) if s['action'] == 'openDetailRow')
            q = copy.deepcopy(query_step)
            q['name'] = '按测试物料编码查询'
            q['args']['fields'] = [
                {'name': 'materialCode', 'label': '物料编码', 'control': 'text', 'value': CODE}
            ]
            steps.insert(idx, q)
            steps[idx + 1]['args']['match'] = CODE
        if op == 'COPY':
            for s in c['steps']:
                for f in (s.get('args') or {}).get('fields', []) or []:
                    if f.get('name') == 'targetMaterialCode':
                        f['value'] = COPY_CODE
        out.append(c)
    suite['cases'] = out
    yaml.safe_dump(suite, open(path, 'w', encoding='utf-8'), allow_unicode=True, sort_keys=False)
    print(f'已绑定测试数据: {len(out)} 个用例；移除(需业务数据): {sorted(SKIP)}')


if __name__ == '__main__':
    main(sys.argv[1])
