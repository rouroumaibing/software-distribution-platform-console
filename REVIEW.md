# console REVIEW 判卷清单（§4.3）。
# 条目三要素：触发器（可从 diff 判定）× 检查内容 × 背后事故/依据。
# 每次评审只核对触发器命中的条目。

## 判卷条目

| # | 触发器（从 diff 判定） | 检查内容 | 依据 |
| --- | --- | --- | --- |
| C1 | 改动 `.github/workflows/*.yml` | 门禁 step 未被删、未被改成 `continue-on-error`；来源取目标分支 | RT-02 / RT-17 |
| C2 | 改动 `src/utils/permission.ts` / `credential.ts` | 权限与凭据判定未被弱化；有对应 smoke 断言 | R-PRC-007 |
| C3 | 新增/改动 `scripts/*-smoke.mjs` | 断言针对真实源码（import 源码）而非硬编码文本镜像；套件计入 `pnpm test` | D2 / S6 |
| C4 | commit message 含 `Verified:` | method 在白名单 `e2e|unit|property|differential|manual|none`；证据路径存在 | §4.2 |
| C5 | 改动 `verify.yaml` / `governance/redlines.yaml` | done 判据仍指向真实可观测状态；阈值未被放宽 | VP-01 / RT-05 |
| C6 | 新增前端界面组件 | 有对应视觉基线（sha256 / 稳定时刻）与异常态用例映射 | §4.10 |
| C7 | 测试文件出现 `skip` / `sleep` / 重跑 | 有根因说明；无"重跑到绿"绕过 | R-VER-009 |

## 判卷独立性（五条机制）

1. **规则来源**：本清单从 base 分支读取，PR 内对本文件的修改不影响本次审判；文件列入 `protected_paths`。
2. **绑定 commit**：评审结果绑定 commit sha；评审期间推新提交即作废重审。
3. **code owner 写检查**：清单由代码 owner 编写并迭代到"owner 会拦的它也拦"。
4. **拉人说 why**：升级给人时必须说明触发了哪条规则、附哪份证据，不让人从 diff 倒推。
5. **单一 reviewer、多轮累积**：不堆叠第二个 reviewer；调优本清单本身，每轮喂前轮上下文与历史失败，从头重查不作为默认。

## 规则清理（prune）

判卷条目与红线不是只增不减。季度评审时按下列触发逐条复核，删除或合并的条目记入 `governance/miss-log.md`：

- 触发器连续两个季度未命中任何 diff：降级观察或删除，避免清单膨胀稀释命中率。
- 检查内容已被静态门（`lint` / `static_risk_check` / E2E）覆盖且门常驻：判卷清单不再重复，保留门本身。
- 依据指向的事故已通过规则修复、且同类 miss 在固定集回放中连续为零：可删除该事故条目。
- 新增条目须带可判定触发器与事故依据；只有文字、无法从 diff 判定的条目不入库。

清理执行由 code owner 在季度评审完成，删除项连同理由写入 miss-log 的 prune 段；本清单从 base 分支读取，PR 内的删除不影响当次审判。
