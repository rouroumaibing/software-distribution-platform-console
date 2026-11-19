# console golden set（元验证 / §4.8）

# 用途：验证"验证体系本身"能否发现已知 bug。样本用真实事故/缺口复现当时的仓库状态，
# 每例带一句话答案；只有正确描述该 bug 的 finding 才计分（见评分口径）。
# 本文件是固定评测集骨架：样本条目已按报告实证填入，回放执行与持续度量须在组织侧落地。

schema_version: 1

# 评分口径（§4.8）：finding 必须命中该例的一句话答案才算命中；
# 报出任意无关问题不计分（防 recall 虚高）。分级 Important / Nit / Pre-existing 分开统计。
scoring:
  hit_rule: "finding 正确描述 answer_key 所指 bug 才计 1 分；其他 finding 不计分"
  severity_labels: [Important, Nit, Pre-existing]
  recall_stages: [raw, after_verify, final]

# 数据集隔离：调参集从固定集分离，评价只用固定集。
sets:
  fixed: "本文件 golden_cases（不随调参改动）"
  tuning: "governance/golden-set.tuning.md（另行维护，不参与正式评分）"
  stop_rule: "调到再调即过拟合固定集时停止"

# 持续度量（review the reviewers）：一次性 golden set 不算齐，须长期统计三项。
continuous_metrics:
  - "merged 后被 revert 的数量"
  - "maintainer 合入前拒绝的数量"
  - "体量相当且一直干净的变更对照组"

# 固定集样本：来自 2026-11-18 console 审计报告实证缺口（真实可复查）。
# status=pending 表示回放尚未在组织侧执行；本文件只固化样本与答案口径。
golden_cases:
  - id: GC-01
    source: "S9 / 审计报告发现3"
    answer_key: "CI 注释声明 7 套件且引用不存在的 docs/ci-build-pipeline.md，与 test 脚本实际 8 套件漂移"
    severity: Nit
    status: pending
  - id: GC-02
    source: "S6 / D2"
    answer_key: "8 套 smoke 均为源码/配置文本断言，非行为级单测，注释声称全量契约覆盖言过其实"
    severity: Important
    status: pending
  - id: GC-03
    source: "S8 / D4b"
    answer_key: "前端交互仓库无视觉基线与异常态驱动清单，界面回归只能看 Timeout 无法定位"
    severity: Important
    status: pending
  - id: GC-04
    source: "S3 / D7"
    answer_key: "无 verify manifest，done 靠自述而非真跑系统的可观测状态与证据落点"
    severity: Important
    status: pending

# bug finder 回放（§4.7 第二法）：已知事故 PR 用 3 个 finder 回放，≥2 命中才算可检测。
bug_finder_replay:
  rule: "3 个独立 bug finder 对同一事故 diff 回放；≥2 命中算可检测；小 diff 漏检优先转 REVIEW 规则"
  status: pending
