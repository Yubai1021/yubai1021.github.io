# 命运轮盘回归测试

在仓库根目录运行，要求 Node.js 18 或更新版本，无需安装依赖：

```sh
node --test games/life/tests/wheel.test.cjs
```

默认执行 8 项测试，另有 1 项原版行为对照需要提供基线文件。测试使用内存 DOM、虚拟定时器和内存 localStorage，不接触浏览器中的真实存档。它执行页面中的真实游戏函数和事件数据；浏览器实际动画另外按下文检查。

## 修复前问题复现

基线为提交 `4bf7b28b06e106b54a9385275d1f45bb5dda4079` 的 `games/life/index.html`。可用以下命令导出 UTF-8 原始文件（适用于 PowerShell 等终端）：

```sh
node -e "require('node:fs').writeFileSync('life-before-fix.html',require('node:child_process').execFileSync('git',['show','4bf7b28b06e106b54a9385275d1f45bb5dda4079:games/life/index.html'],{maxBuffer:2*1024*1024}))"
```

在 PowerShell 中对原版运行最小回归用例：

```powershell
$env:LIFE_HTML = (Resolve-Path life-before-fix.html).Path
node --test --test-name-pattern '^regression:' games/life/tests/wheel.test.cjs
Remove-Item Env:LIFE_HTML
```

预期原版失败：现代世界线有 14 类，前三次 `Math.random()` 固定为 `[0, 0.5, 0.5]`。事件选中索引 0「学业」，原版轮盘却旋转八格，停在「名望」起始边界附近。修复版会停在「学业」扇区中央。

## 概率、进度和存档对照

```sh
node games/life/tests/wheel.test.cjs --baseline life-before-fix.html
```

预期 9 项全部通过。对照使用四个固定种子，每个种子执行 18 次普通/极速混合抽取和真实事件选择，经过现代、觉醒与修真世界，再结算人生并领取传承。逐次比较事件、人物状态、传承状态、两个存档内容和随机数消耗，要求与原版完全一致。

修复保留普通轮盘的原步数公式 `count*rand(3,4)+rand(3,count+1)`。该公式在给定起点时不会选到偏移两格的类别；此处保持原有概率，不重新调整游戏平衡。极速仍用 `rand(0,count-1)` 等概率抽类别，原先独立决定角度的第二次随机数改用于 140–160ms 动画时长，保证后续事件随机序列不变。

测试还覆盖：

- 每个极速目标与不同动画随机值；普通抽取的所有原步数组合。
- 连续混合抽取、所有实际修炼境界/道途/界门组合，类别数量扩大和缩小。
- 重复点击、阶段锁定、重抽、选择事件后进度与存档恢复。
- 超时看门狗与事件池异常兜底，只结算一次且与最终扇区一致。
- 人生完成次数和传承奖励重复调用时不重复增加。

## 浏览器复核

用本地测试副本和独立浏览器配置打开 `games/life/index.html`，创建新人生，按以下顺序检查：

1. 点「极速抽取」，比较顶部指针、抽中提示、轨迹末项和事件卡片类别；四者应一致，指针应位于扇区中央。
2. 使用「重新抽取」，再完成事件选择、继续人生；交替进行普通与极速抽取，确认没有错位或重复结算。
3. 在动画期间连续点击抽取按钮，只应出现一个事件。事件出现后两个抽取按钮保持禁用，按原流程选择或重抽。
4. 在测试页面控制台依次设置下表配置，再调用 `syncEraCategories(); resetWheelUI();`，分别抽取并检查指针。配置只用于本地测试世界线变化，不代表正常游戏解锁流程。
5. 将窗口宽度改为 390px，重复极速抽取；最后完成事件选择、刷新并继续人生，核对属性、抉择次数和传承记录。

示例配置命令：

```js
Object.assign(state, {
  era: 'cultivation', realmIndex: 1, cultivationPath: 'body',
  worldsUnlocked: false, pendingDaoChoice: false
});
syncEraCategories();
resetWheelUI();
```

| 配置 | 类别数量 |
| --- | --- |
| `era:'modern'` | 14 |
| `era:'awakening'` | 9 |
| `era:'cultivation', realmIndex:1, cultivationPath:'body', worldsUnlocked:false` | 5 |
| `era:'cultivation', realmIndex:1, cultivationPath:'sword', worldsUnlocked:false` | 6 |
| `era:'cultivation', realmIndex:2, cultivationPath:'body', worldsUnlocked:false` | 10 |
| `era:'cultivation', realmIndex:3, cultivationPath:'body', worldsUnlocked:false` | 12 |
| `era:'cultivation', realmIndex:3, cultivationPath:'body', worldsUnlocked:true` | 14 |

可在动画结束后用实际 CSS 变换独立反算指针指向：

```js
const matrix = new DOMMatrixReadOnly(getComputedStyle(wheel).transform);
const rotation = Math.atan2(matrix.b, matrix.a) * 180 / Math.PI;
const angle = ((-rotation % 360) + 360) % 360;
const visualIndex = Math.floor(angle / (360 / categories.length));
console.table({
  visual: categories[visualIndex],
  event: currentEvent.category,
  indexMatches: visualIndex === pointerIndex,
  centerError: Math.abs(angle - (visualIndex + 0.5) * 360 / categories.length)
});
```

`visual` 与 `event` 应一致，`indexMatches` 为 `true`，`centerError` 应小于 `0.001` 度。运行时位置变量不进入存档，存档键和格式无需迁移。

2026-10-22 验证：Node 测试及基线对照 9/9 通过；Edge 155 浏览器 12 次检查通过，覆盖普通、极速、连续切换、上述类别数和 390px 手机宽度，无页面脚本错误。
