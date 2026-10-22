# 随机人生模拟器 v2.1.0 回归测试

在仓库根目录运行，要求 Node.js 18 或更新版本，无需安装依赖：

```sh
node --test games/life/tests/story.test.cjs games/life/tests/wheel.test.cjs
```

默认执行 **16 项剧情/解锁测试和 8 项轮盘测试**，另有 1 项基线对照在未提供基线文件时跳过。测试执行页面中的真实游戏函数和事件数据，使用内存 DOM、虚拟定时器和内存 localStorage，不接触浏览器中的真实存档。实际布局和动画需另做浏览器复核。

## 剧情与渐进解锁：16 项

1. 新玩家初始只可普通抽取；极速、重抽和支线管理保持锁定，直接调用函数也不能绕过锁定或消耗随机数。
2. 第一次真实事件选择只解锁极速；至少两次选择后的失败可解锁重抽，同一选择重复处理不重复累计。
3. 前三次选择都成功时，第三次也会解锁重抽；解锁后的重抽正常计次。
4. 第一世正常结算解锁支线管理，轮回次数只加一次，下一世保留解锁。
5. 死亡后选择直接重生也完成剧情收束、计次和支线解锁，并删除本世存档；已结算后重生及重复调用均不重复计次。
6. 旧传承存档迁移保留已有功能、支线、永久属性、轮回次数和支线偏好。
7. 只有旧人生存档、没有传承存档时，也能迁移；连续两次实际初始化不丢解锁、不重置历史、不多计一世。已启用的已知隐藏支线保留，关闭或未知支线不凭空解锁。
8. 待选择事件和结果页都不能被普通/极速抽取覆盖；待选择时仍可明确重抽，结果页重抽不消耗次数或随机数。下一阶段恢复抽取。
9. 新解锁进度保存和重载后不变；重复渲染不赠送功能、不重写存档。
10. 缺失、`null` 或损坏的传承记录按新玩家处理，不意外获得全部功能。
11. 未来科技初始未开启；真实科技线索加上多次选择才触发专属解锁剧情，并在下一世进入可用配置，本世配置保持不变。
12. 童年每岁有不同场景，同一人生重载稳定，不同人生种子产生变化，不额外消耗游戏随机数。
13. 成年故事每岁最多追加一段，重复调用不重复追加，也不改变属性、抉择进度、事件历史或随机序列。
14. 真实选择留下后续回声，保留事件标题、具体选择和成败；到后续年份才发生，保存重载后继续。
15. 剧情状态重载和人生收束幂等，不重写旧年份，也不重复添加结尾。
16. 连续人物故事按幕推进，遵守年龄间隔且能自然收束；离开现代世界后不继续现代剧情，等待入道或死亡时不偷偷推进。

解锁进度为跨世记录。新玩家完成首次选择后才能测试极速，完成相应失败或第三次选择后才能测试重抽。每次选择最多新解锁一项；科技线索不保证同一回合立即开启未来科技。

## 轮盘：8 项

1. 最小回归：现代极速抽中「学业」时，视觉指针也停在「学业」。
2. 所有极速目标配合不同动画随机值，始终落在正确扇区中央。
3. 普通抽取保留原步数分布，最终索引、事件类别和扇区中央一致。
4. 连续混合抽取及各实际世界线、境界、道途、界门组合中，类别数量扩大和缩小后仍同步。
5. 连点和阶段锁定不排入额外动画、不消耗额外随机数。
6. 抽取、重抽、选择和重载保留进度及原存档键。
7. 超时看门狗和事件池异常兜底只结算一次，事件与停下的轮盘一致。
8. 人生完成次数和传承奖励不重复增加。

轮盘测试使用已迁移的旧玩家配置，使极速/重抽可用；新玩家功能锁由剧情测试单独验证。

## 修复前的轮盘问题复现

原始基线为提交 `4bf7b28b06e106b54a9385275d1f45bb5dda4079` 的 `games/life/index.html`。可用以下命令导出 UTF-8 文件（适用于 PowerShell 等终端）：

```sh
node -e "require('node:fs').writeFileSync('life-before-fix.html',require('node:child_process').execFileSync('git',['show','4bf7b28b06e106b54a9385275d1f45bb5dda4079:games/life/index.html'],{maxBuffer:2*1024*1024}))"
```

在 PowerShell 中对原版运行最小回归用例：

```powershell
$env:LIFE_HTML = (Resolve-Path life-before-fix.html).Path
node --test --test-name-pattern '^regression:' games/life/tests/wheel.test.cjs
Remove-Item Env:LIFE_HTML
```

预期原版失败：现代世界线有 14 类，前三次 `Math.random()` 固定为 `[0, 0.5, 0.5]`。事件选中索引 0「学业」，原版轮盘却旋转八格，停在「名望」起始边界附近。修复版会停在「学业」扇区中央。退出复现后务必移除 `LIFE_HTML`，再运行 v2.1.0 测试。

## 同随机序列的玩法与存档对照

可使用增加剧情前、已修复轮盘的 v2.0.0 HTML 作为基线：

```sh
node games/life/tests/wheel.test.cjs --baseline life-wheel-fixed.html
```

`life-wheel-fixed.html` 为自行保存的升级前文件路径。也可直接使用上面导出的原始版本，原始版本的视觉问题不影响此项玩法对照：

```sh
node games/life/tests/wheel.test.cjs --baseline life-before-fix.html
```

提供基线后，轮盘测试预期 **9/9 通过**。对照使用种子 `1、7、42、20261022`，每个种子进行 18 次普通/极速混合抽取和真实事件选择，经过现代、觉醒与修真世界，再完成人生结算和传承领取。

逐次比较事件、人物玩法状态、传承状态、`pointerIndex`、随机数消耗，以及两个存档中对应的玩法字段。v2.1.0 有意新增剧情与解锁记录，因此比较时从状态和解析后的存档中排除 `narrative`、`storyProgress`、`storyProgressSeenChoices`、`storyProgressVersion` 和 `yearlyLog`，其余字段仍须一致。不是整份存档逐字节相同；被排除的新增内容由上述 16 项剧情测试验证。

修复保留普通轮盘原步数公式 `count*rand(3,4)+rand(3,count+1)`。在实际游戏的类别数量下，该公式给定起点时不会选到偏移两格的类别；此处保留原概率，不调整游戏平衡。极速仍用 `rand(0,count-1)` 等概率抽类别，原先独立决定角度的第二次随机数改用于 140–160ms 动画时长，后续事件随机序列保持一致。新增叙事使用自己的确定性选文逻辑，不调用游戏的 `Math.random()`。

## 浏览器手动复核

使用**独立浏览器配置或无痕窗口**，打开本地测试副本。不要在平时游玩的线上页面清空 localStorage，也不要在真实存档上运行下面的世界线配置命令。迁移测试请把旧存档副本放入隔离测试来源，保留原件。

1. **新手解锁。** 创建新人生，确认初始只可普通抽取。完成第一次事件选择，确认出现解锁剧情并获得极速；先点继续进入下一阶段，再使用极速。继续选择，验证失败分支或第三次选择才解锁重抽，支线管理仍需第一世结束。
2. **指针与事件。** 普通和极速交替抽取，比较顶部指针、抽中提示、轨迹末项、事件卡片类别，四者应一致且指针位于扇区中央。解锁重抽后，在选择前使用一次重抽再完成选择，确认抉择只增加一次。
3. **流程保护。** 动画中连续点击，只出现一个事件；待选择时普通/极速按钮不可覆盖事件，结果页也不能再抽或消耗重抽次数。按正常继续流程进入下一阶段后恢复抽取。
4. **人生故事。** 查看童年、成年连续剧情和选择后的后续回声；人物与前文相接，内容符合年龄及世界线。刷新或重复打开回顾不重复追加剧情，结尾只出现一次。切换觉醒/修真后不再继续现代人物故事。
5. **轮回与迁移。** 分别用正常结算和死亡后直接重生结束第一世，确认支线管理解锁、轮回次数只加一次。用旧 meta、只有旧 life 两种隔离存档各刷新两次，确认功能、隐藏支线、属性和既有进度保留；新存档刷新后不额外解锁。
6. **世界线变化。** 在隔离页面控制台依次设置下表配置，再调用 `syncEraCategories(); resetWheelUI();`。分别抽取并反算指针位置。配置只用于几何验证，不代表正常游戏解锁流程；测试极速前仍须先完成一次真实选择。
7. **手机与重载。** 将视口宽度设为 390px，完成普通/极速抽取、选择、继续人生，检查解锁提示和回顾可阅读、按钮可操作。保存后刷新，核对属性、抉择次数、轮回记录与解锁进度。

世界线配置示例：

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

动画结束后，可用实际 CSS 变换独立反算指针指向：

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

`visual` 与 `event` 应一致，`indexMatches` 为 `true`，`centerError` 应小于 `0.001` 度。

原存档键 `random_life_legacy_save_v1` 和 `random_life_legacy_meta_v1` 保留；v2.1.0 在其中增加叙事与解锁字段，并自动迁移旧记录，不要求用户清档。运行时轮盘角度不写入存档。

## 本次验证记录

2026-10-22：剧情/解锁 **16/16**、默认轮盘 **8/8**、可选同随机序列基线对照 **1/1** 通过；真实浏览器 **7 项检查通过**，已验证 **390px** 手机视口。
