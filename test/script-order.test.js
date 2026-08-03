import { describe, it, expect } from 'vitest';
import { computeAfterAnchor } from '../client/src/scriptOrder.js';

// 计算"after 锚点"：拖到目标脚本下面时，应插到"目标之后、同组"的下一条脚本之前。
describe('computeAfterAnchor', () => {
  const scripts = [
    { id: 'a', group: 'G1' },
    { id: 'b', group: 'G1' },
    { id: 'c', group: 'G1' },
    { id: 'x', group: 'G2' },
    { id: 'y', group: 'G2' },
  ];

  it('返回目标之后同组的下一脚本 id（before 模式的上层 beforeId）', () => {
    // 把某脚本拖到 'a' 下面 → 应插到 'b' 之前
    expect(computeAfterAnchor(scripts, 'a')).toBe('b');
    expect(computeAfterAnchor(scripts, 'b')).toBe('c');
  });

  it('目标是组内最后一条 → 返回 null（上层追加到组末尾）', () => {
    expect(computeAfterAnchor(scripts, 'c')).toBeNull();
    expect(computeAfterAnchor(scripts, 'y')).toBeNull();
  });

  it('跨越分组不会拿到其他组的脚本', () => {
    // 'c' 之后同组无其他 → null，即便数组后面还有 G2 的脚本
    expect(computeAfterAnchor(scripts, 'c')).toBeNull();
  });

  it('excludeId：跳过被拖脚本自身（同组相邻场景）', () => {
    // 被拖脚本 'b' 紧邻 'a' 下方，拖 'a' 到 'a' 自身下面无意义，但验证排除逻辑：
    // 若目标是 'a' 且被拖的是 'b'，anchor 应跳过 'b' 取 'c'
    expect(computeAfterAnchor(scripts, 'a', 'b')).toBe('c');
  });

  it('excludeId 不指向相邻时不影响结果', () => {
    expect(computeAfterAnchor(scripts, 'a', 'x')).toBe('b');
  });

  it('非法入参安全返回 null', () => {
    expect(computeAfterAnchor(null, 'a')).toBeNull();
    expect(computeAfterAnchor([], 'a')).toBeNull();
    expect(computeAfterAnchor(scripts, 'nope')).toBeNull();
    expect(computeAfterAnchor(scripts, null)).toBeNull();
  });
});
