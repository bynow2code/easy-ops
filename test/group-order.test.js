import { describe, it, expect } from 'vitest';
import { computeGroupReorder } from '../client/src/groupOrder.js';

const G = ['Default', 'A', 'B', 'C'];

// 排序纯函数：被拖分组插入到目标分组之前；任何分组（含默认）可落任意位置。
describe('computeGroupReorder', () => {
  it('把靠前的分组拖到靠后（落在目标之前）', () => {
    expect(computeGroupReorder(G, 'A', 'C')).toEqual(['Default', 'B', 'A', 'C']);
  });

  it('把靠后的分组拖到靠前（落在目标之前）', () => {
    expect(computeGroupReorder(G, 'C', 'A')).toEqual(['Default', 'C', 'A', 'B']);
  });

  it('默认分组可移动到中间位置', () => {
    expect(computeGroupReorder(G, 'Default', 'B')).toEqual(['A', 'Default', 'B', 'C']);
  });

  it('默认分组可移动到倒数第二（落在最后一组之前）', () => {
    expect(computeGroupReorder(G, 'Default', 'C')).toEqual(['A', 'B', 'Default', 'C']);
  });

  it('拖到自身 → 原样返回（no-op）', () => {
    const r = computeGroupReorder(G, 'A', 'A');
    expect(r).toEqual(G);
  });

  it('目标不在列表 → 安全返回原顺序，不丢分组', () => {
    expect(computeGroupReorder(G, 'A', 'Z')).toEqual(G);
  });

  it('被拖分组为 null/空 → 安全返回原顺序', () => {
    expect(computeGroupReorder(G, null, 'A')).toEqual(G);
    expect(computeGroupReorder(G, '', 'A')).toEqual(G);
  });

  it('任意合法移动后：集合大小与元素不变（无丢失、无重复）', () => {
    for (const drag of G) {
      for (const target of G) {
        const r = computeGroupReorder(G, drag, target);
        expect(r).toHaveLength(G.length);
        expect([...r].sort()).toEqual([...G].sort());
      }
    }
  });

  // ---- before / after 语义：支持放到目标的"上面"或"下面" ----
  it("position='after'：拖到目标之后（放到目标下面）", () => {
    // 把 A 拖到 C 下面 → A 出现在 C 之后
    expect(computeGroupReorder(G, 'A', 'C', 'after')).toEqual(['Default', 'B', 'C', 'A']);
  });

  it("position='after'：把靠前分组拖到靠后组之下", () => {
    expect(computeGroupReorder(G, 'Default', 'A', 'after')).toEqual(['A', 'Default', 'B', 'C']);
  });

  it("position='after'：默认分组可落到末尾（拖到最后一组之下）", () => {
    expect(computeGroupReorder(G, 'Default', 'C', 'after')).toEqual(['A', 'B', 'C', 'Default']);
  });

  it("position 缺省 = 'before'（向后兼容既有调用）", () => {
    expect(computeGroupReorder(G, 'A', 'C')).toEqual(['Default', 'B', 'A', 'C']);
    expect(computeGroupReorder(G, 'A', 'C', 'before')).toEqual(['Default', 'B', 'A', 'C']);
  });

  it("position 非法值安全降级为 before", () => {
    expect(computeGroupReorder(G, 'A', 'C', 'whatever')).toEqual(['Default', 'B', 'A', 'C']);
  });
});
