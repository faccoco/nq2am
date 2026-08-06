# 匹配算法删除记录

记录匹配算法（`src/apple/*`）的逐步删改，方便回溯每次"删了什么、为什么、影响了哪里"。
原始基线：`beb01c0` `feat: improve Apple recording matching`（scoring v2 / recording-first 流水线）。

## 状态图例

- 🟡 计划中：已排查影响面，待确认边界后再动手。
- ✅ 已删除：已完成并保持构建通过。
- ↩️ 已回退：撤销了某次删除。

---

## ✅ [已删除] 匹配算法进一步瘦身（查询词、级联裁决、歧义间隔、平局打破、封面相似度、ISRC 跨店桥接）

**时间**：本次会话
**动机**：把匹配算法降到最简——只用曲名检索，按单一分数阈值裁定状态，去掉所有“启发式选冠军”和近分转人工复核的旁路。

### 删除的机制

1. **查询词拼接**：不再用「曲名 + 首位歌手」拼查询，`processTrack` 直接拿 `track.originalName` 去 Apple 搜索。
2. **级联裁决**：删除阈值下的时长兜底（`chooseByDurationSimilarity`）、不可区分重复选择（`chooseIndistinguishableDuplicate`）、专辑相似度选择（`chooseByAlbumSimilarity`）。以及配套的 `hasEquivalentDuration`/`isEquivalentCandidate`/`matchesSourceAlbum`/`retainCandidates`/`sharedRecordingIsrc`。
3. **歧义间隔与平局打破**：删除最高分与次高分的近分判断；最高分达到 `threshold` 后直接选中排序第一的候选，不再产生新的 `ambiguous` 结果。对应的 `ambiguousGap` 偏好已从 types/server/web/i18n 移除；服务端仅兼容读取并丢弃旧配置。`explicitRank` 仅保留作分数完全相同时的确定性排序提示。`ambiguous` 状态仍保留，用于读取和刷新历史报告。
4. **封面相似度**：整个 `src/apple/artwork.ts` 删除（`ArtworkComparator`/`createArtworkComparator`/`chooseByCoverSimilarity`/`CandidateSimilarity`）；`matchSingleTrack` 不再接收 `chooseCover`；移除 `artworkComparatorFactory`、`artwork` 阶段日志、`artworkTimeoutMs` 偏好（types/server/web/i18n/tests）。
5. **ISRC 跨店桥接**：删除 `resolveCandidateId`、`AppleApiSession.songsByIsrc` 与 `appleSongsByIsrc` 导出；`resolveAppleMusicTrackIds` 改为同步、直接收集已匹配候选 id（不再需要 session/storefront/concurrency）；`createAppleMusicPlaylistFromReport` 不再探测 accountStore。`AppleCandidate.addableId` 字段移除；`AppleRequestOperation` 去掉 `"isrc"`；`mergePreservedCandidateFields` 删除。

### `matchSingleTrack` 现在的逻辑

分数 → 排序 → 取前 N：无结果或最高分 < `threshold` → `not_found`；否则 → `matched`（最高分）。前两名分差不再参与裁决。

### 受影响的文件

- 代码：`src/apple/matcher.ts`（重写决策部分）、`src/apple/api.ts`、`src/apple/artwork.ts`（删）、`src/types.ts`、`src/index.ts`。
- 偏好/UI：`server/preferences.ts`、`web/src/types.ts`、`web/src/components/MatchingSettings.tsx`、`web/src/i18n/locales/{en,zh}/settings.json`、`web/src/i18n/locales/{en,zh}/match.json`（上一轮已理）。
- 用户可见文案修正：删除歧义间隔设置及其 tooltip；匹配说明改为“最高分过阈值即选中”；`src/types.ts` isrc 注释去掉“用于跨店桥接”。
- spec：`openspec/specs/apple-match-request-failure-handling/spec.md` 删除已不可能触发的「封面比较超时」场景，并把成功重试结果收窄为 `matched | not_found`。
- 测试：删 `tests/real-songs.test.ts` + `tests/fixtures/real-songs-same-recording.json`（为旧专辑相似度 GT 而设的回归周定）、`package.json` 的 `test:real` 脚本；重写/精简 `tests/apple.test.ts`、`tests/apple-performance.test.ts` 中依赖已删机制的用例，并覆盖零分差候选也直接选中第一名。

### 保留

- `threshold` / `explicitPreference`（仅等分排序定序）/ 评分体系（title/artist/album/duration/version）/ 请求调度与重试 / `refreshAppleMatchReportCandidates`（重算候选）/ `retry*` / `candidate.storefront` 与 `candidate.isrc`（仅作元数据，CandidateCard 仍可展示 storefront 徽标；现在恒为账号区）。
- `ambiguous` 状态与对应复核 UI 仅为历史报告兼容保留；新的自动匹配不会再产出该状态。

### 验证

- `pnpm run typecheck` ✅（含 web `tsc --noEmit`）
- `pnpm run lint` ✅（43 files）
- `pnpm run test` ✅（74 tests pass）
- 全仓 `rg` 残留检查 ✅（仅剩合法的封面 URL 展示、旧 `ambiguousGap` 配置迁移兼容，以及 openspec 历史变更文档）

### 备注

- `openspec/changes/optimize-apple-matching-latency/` 是引入这些机制的历史变更提案（现已部分被废）：其中的并发/请求节奏/调度器部分仍有效；封面比较、ISRC 跨店桥接、平局决胜相关需求已随本次删除失效，以本记录为准。

---

## ✅ [已删除] 原生搜索地区检测（native storefront detection）

**时间**：本次会话
**动机**：移除匹配算法里「检测原生搜索地区」这一步——不再根据假名/韩文/汉字把音轨路由到 jp/kr/cn 区先搜索、再通过 ISRC 桥接回账号区。现在一律在账号 storefront 搜索并评分。

### 删除的内容

- `src/apple/matcher.ts`
  - 删除 `detectStorefrontForTrack()`（按字符判定原生区域的函数）。
  - `processTrack()` 不再计算 `nativeStore`/`searchStore`，固定用 `accountStore` 搜索与评分；选中候选直接令 `selected.addableId = selected.id`，不再在匹配阶段做 ISRC 桥接，也不再产出 `isrc` 阶段日志。
  - `AppleMatchLogEvent.stage` 联合类型移除 `"isrc"`。
- `src/index.ts`：移除 `detectStorefrontForTrack` 导出。
- 偏好设置：移除 `nativeSearch` 与 `cjkDetection`（仅服务于该检测步骤，删除后即为死配置）。
  - `src/types.ts`（`MatchPreferences` + `DEFAULT_MATCH_PREFERENCES`）、`server/preferences.ts`（校验）、`web/src/types.ts`、`web/src/components/MatchingSettings.tsx`（开关 + CJK 判定下拉）、`web/src/i18n/locales/{en,zh}/settings.json`。
- UI：`web/src/components/ReviewCard.tsx` 移除「母语区域桥接」提示（`bridged` 标志 + `nativeNotice`），`web/src/i18n/locales/{en,zh}/match.json` 移除 `nativeNotice`。
- storefront tooltip 去掉「先去 JP/KR/CN 搜索再桥接」的过时描述（en/zh settings.json）。
- 测试：删掉 `detectStorefrontForTrack picks native region by script`（及仅它使用的 `track()` helper）、`native-store matching bridges only the automatically selected candidate`；多处 `nativeSearch: false` 覆盖项移除。

### 保留的内容

- `resolveCandidateId()`、`resolveAppleMusicTrackIds()`、`createAppleMusicPlaylistFromReport()`，以及候选上的 `addableId`/`storefront` 字段仍保留：作为创建歌单时把候选解析为可加入 catalog id 的通用机制（手动选中、历史报告的惰性解析）。这些在自动匹配流程里现已退化为「直接返回 `id`」，不影响行为。

### 验证

- `pnpm run typecheck` ✅（含 web `tsc --noEmit`）
- `pnpm run test` ✅（122 tests pass）
- `pnpm run lint` ✅（44 files）
- 全仓 `rg` 残留引用检查 ✅（仅 `openspec/changes/optimize-apple-matching-latency/design.md` 的历史设计段落已同步修正）

### 行为变化

非英文音轨不再去母语区先搜。匹配统一在账号 storefront 进行：`accountStore` 由 `prefs.storefront` 指定，留空时自动探测。该步骤完成时其余裁决逻辑未变；歧义间隔与封面相似度后来在“匹配算法进一步瘦身”阶段删除。

### 备注

- 已保存的 `preferences.json` 若含 `nativeSearch`/`cjkDetection`，`getPreferences()` 会因未知键校验失败而回退到默认值（与上次 recording-first 回退的处理方式一致）。

---

## ✅ [已删除] recording-first 重构整体回退（撤销 `beb01c0`）

**时间**：本次会话
**方式**：`git revert --no-commit --no-edit beb01c0`（回退到工作区，未提交，可审查）
**动机**：移除 scoring v2 的整套"录音优先"逻辑——版本面（facet）判断、录音分组、多查询检索级联、艺术家非对称比较+别名表、`score_rejected`/`reviewThreshold`/`scoringVersion` 双阈值与状态体系、回放校准工具。匹配算法回到 v1 候选级单阈值评分。

### 删除的文件（原为 `beb01c0` 新增）

- `src/apple/recordingMetadata.ts` —— 标题解析、版本面分类（live/remix/remaster…）
- `src/apple/recordingResolution.ts` —— 录音分组 + 双阈值决策
- `src/apple/retrieval.ts` —— 多查询检索级联
- `src/apple/artistAliases.ts` —— 人工审核别名表
- `src/apple/replay.ts` + `scripts/apple-match-replay.ts` —— 离线回放/校准
- `tests/apple-recording-matching.test.ts`、`tests/fixtures/apple-matching-v1-baseline.json`、`tests/fixtures/apple-recording-patterns.json`
- `openspec/changes/archive/2026-08-04-improve-apple-recording-matching/`（整目录）、`openspec/specs/apple-candidate-retrieval/`、`openspec/specs/apple-recording-resolution/`

### 还原到旧版的文件（原为 `beb01c0` 修改）

`src/apple/matcher.ts`、`src/apple/scoring.ts`、`src/apple/requestFailure.ts`、`src/index.ts`、`src/matchFilters.ts`、`src/reviewCollapse.ts`、`src/types.ts`、`server/preferences.ts`、`server/routes/match.ts`、`server/state.ts`、`package.json`、`biome.json`，以及 web 侧 `web/src/types.ts`、`pages/MatchPage.tsx`、`components/{MatchingSettings,ReviewCard}.tsx`、i18n（en/zh 的 match.json、settings.json），相关测试（`apple.test.ts`、`apple-performance.test.ts`、`match-filters.test.ts`、`match-route.test.ts`、`preferences.test.ts`、`request-failure.test.ts`）。

> 注：`openspec/specs/apple-match-request-failure-handling/spec.md` 的修改也一并回退（该能力随本次状态体系一起改的）。

### 验证

- `pnpm run typecheck` ✅
- `pnpm run test` ✅（124 tests pass）
- `pnpm run lint` ✅（44 files, no fixes）
- 全仓 `rg` 残留引用检查 ✅ 无残留

### 回退完成时的匹配行为（v1，随后继续简化）

每个 Apple 候选独立按 title/artist/album/duration/version 加权打分；当时仍要求最高分过 `threshold` 且与第二名保持足够分差。后续“匹配算法进一步瘦身”已删除分差裁决，当前只保留单阈值判断。状态集合仍兼容 `not_implemented | matched | not_found | ambiguous | request_failed`（无 `score_rejected`）。

### 备注

- 原始设计文档仍保留在 git 历史 `beb01c0` 中，可随时 `git show beb01c0` 查看。
- 回退未提交，停留在工作区/暂存区，待你确认后再 commit。

---

## 🟡 计划中

（暂无）
