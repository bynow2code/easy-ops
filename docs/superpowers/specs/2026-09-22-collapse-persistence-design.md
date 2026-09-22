# 侧栏折叠状态跨重启持久化 设计规格

日期:2026-09-22
状态:已批准(用户选定方案 A:存入 Settings)

## 背景与问题

侧栏目录的展开/折叠状态存在 `Sidebar.tsx` 的 `useState`(`collapsedIds: ReadonlySet<string>`):
会话内正确记忆(搜索强制展开、选中自动展开祖先链均不影响),但**应用重启后全部回到展开态**。

用户需求:点击展开/收缩后,重启应用应保持上次的样子。

## 方案 A(已选定):存入 Settings,跟随既有先例

`Settings` 增加 `collapsedGroupIds: string[]`,与 `mainSplitRatio`(分栏比例)同一套持久化模式。

### 数据链路

| 环节 | 做法 |
|---|---|
| 类型 | `types.ts` 的 `Settings` 增加 `collapsedGroupIds: string[]`,注释标明「设备本地 UI 状态,不随导入导出迁移」 |
| 默认值 | `settings.ts` 的 `DEFAULT_SETTINGS` 增加 `collapsedGroupIds: []`;读盘合并 `{ ...DEFAULT_SETTINGS, ...read() }` 使旧配置零迁移回落 |
| 写入校验 | `settings.update` 增加 `collapsedGroupIds` 分支:非数组忽略,数组内只保留字符串 id |
| 渲染层读入 | Sidebar 挂载时 `settings.get()` → 初始化 `collapsedIds` → 置 `collapsedLoaded = true` |
| 渲染层写回 | `collapsedIds` 变化后防抖 300ms `settings.update`,与分栏比例同款「loaded 门 + 防抖」;写盘前用 `useAppStore.getState().groups` 过滤已删除目录的 id,防死 id 堆积 |
| 导入/导出 | `filterPortableSettings` 是白名单式重建,新字段**不加入**即天然不迁移;返回对象补 `collapsedGroupIds: []`(导入配置后目录全换,旧折叠 id 重置) |

### 交互不变(明确不做)

- 搜索强制展开、选中自动展开祖先链、`toggleGroup` 的搜索态忽略——全部只影响内存态,不动持久化;
- 新目录默认展开(不在集合内即展开);
- 不存进 scripts.json,不进导入导出,不做每目录时间戳;
- 读设置失败时放弃持久化(不写盘),本会话折叠退化为纯内存态——**绝不把降级空集合落盘覆盖已存数据**;
- **设置写盘失败的统一策略**:全部静默降级(内存态保留 + console.error 留痕),不弹 toast——
  折叠态与布局比例写回均已按此实现;写失败不推进基线,下次变更或重启自然重试;
- 若未来加入「恢复上次选中」:选中恢复会触发祖先链自动展开、部分撤销存储折叠,属"可见性优先"语义,实现时需回写本规格。

## 测试影响

- `tests/renderer/sidebar.test.tsx`:`setupApi` 需补 `settings.get/update` mock(Sidebar 开始消费 settings API);
  新增 2 条用例:①settings 带 `collapsedGroupIds: ['g1']` 时挂载即折叠对应目录;②折叠后防抖写回被调用且参数正确。
- `tests/main/transfer.test.ts`:SETTINGS fixture 补新字段(typecheck 强制)。
- `tests/main/settings-store.test.ts`:补 update 校验用例(非数组忽略/字符串过滤)。

## 实现落点

`src/shared/types.ts`、`src/main/store/settings.ts`、`src/main/store/transfer.ts`(一行)、
`src/renderer/src/components/Sidebar.tsx`、上述三个测试文件。改动集中,规格即计划。
