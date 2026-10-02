# JobHunt Assistant · 求职助手

把官网选岗、岗位预筛、申请准备和结果跟进串在一起的求职 Agent 工作流，配有可调用技能和本地岗位看板。个人资料与申请记录保存在使用者自己的电脑中，公开仓库提供代码、流程和空白模板。

适用于 Codex，也可以交给能够读取技能文件、浏览网站并操作本地文件的其他 Agent。浏览器、Gmail 和定时任务能力由运行环境提供；本仓库不会自行登录网站或启动投递。

## 能做什么

| 流程 | 行为 |
| --- | --- |
| 官网选岗 | 从企业官方招聘来源查找岗位，按个人目标核对方向、地点和资格 |
| 岗位预筛 | 去重并写入预备岗位池，记录匹配依据、疑点和下一步 |
| 申请准备 | 按用户指定的 `lead_id` 推进，复用已确认资料，准备定向材料与表单 |
| 提交与核验 | 用户审阅具体申请并明确批准后提交；有成功证据才记为 `Submitted` |
| Gmail 跟进 | 只读匹配已有申请的邮件，更新笔试、面试、拒绝或录用结果 |
| 本地看板 | 查看岗位、状态和待办，维护已有申请的结果与日程 |

预筛、转入岗位池、填表上传、最终提交分别执行。技能不猜测成绩、学历时间、工作许可或个人贡献，登录及必要验证由用户完成。

## 开始使用

需要 **Python 3.10+** 和 **Node.js 20+**，不需要安装 npm 包。读取 Codex 定时任务的 TOML 配置需要 Python 3.11+；Python 3.10 仍可初始化和检查本地文件。

```sh
git clone https://github.com/jedichan/jobhunt-assistant.git
cd jobhunt-assistant
python3 scripts/setup.py
```

初始化只创建当前仓库中缺失的文件：5 份个人配置、空白岗位 CSV、邮箱同步状态和技能设置。重复运行会保留已有内容，不安装全局技能、不创建定时任务，也不访问浏览器或邮箱。

按自己的实际情况填写：

- `JobHuntBot/candidate_profile.json`：身份、教育、目标和已确认事实。
- `JobHuntBot/application_rules.md`：选岗偏好和投递规则。
- `JobHuntBot/resume_routing.md`：不同岗位使用的简历路径。
- `JobHuntBot/answer_bank.md`：已确认的常见问题答案。
- `JobHuntBot/experience_bank.md`：可追溯的经历、项目与贡献。

将简历等私人材料保存在 `JobHuntBot/my-materials/`。未知事实留空，实际使用时再补齐。

### 调用技能

在 Agent 对话中提供本机的**绝对路径**，例如：

> 读取 `/你的完整路径/jobhunt-assistant/JobHuntBot/skills/jobhunt-assistant/SKILL.md`，按我的规则预筛今天的官网岗位。

Codex 用户如需全局发现，可明确执行：

```sh
python3 scripts/setup.py --install-skill
```

该命令会在 `$CODEX_HOME/skills`（未设置时为 `~/.codex/skills`）创建技能链接。已有同名技能指向其他工作区，或存在同名目录时会拒绝覆盖。**已有本地使用者无需替换原安装、规则或自动化**；原工作区可继续照常使用。

安装后可说：

> 使用 $jobhunt-assistant 按我的目标城市和方向预筛岗位，只看官方招聘来源。
>
> 使用 $jobhunt-assistant 准备 lead_id 为 `prelim-example` 的申请，完成后给我审阅。
>
> 使用 $jobhunt-assistant 只读同步已投递申请的 Gmail 结果。

技能的 `settings.json` 保存工作区绝对路径；移动仓库后手动更新其中的 `workspace_root`。它是本地文件，不提交到 Git。

### 打开岗位看板

```sh
sh JobHuntBot/dashboard/start-dashboard.sh
```

在浏览器打开 [本地岗位看板](http://localhost:8420/dashboard.html)，保持启动窗口运行。停止时按 `Ctrl+C`。启动器不会自动打开浏览器，也不会持久运行。若端口已被占用，启动会失败，不会复用或修改原服务。可改用另一个端口：

```sh
JOBHUNT_PORT=8421 sh JobHuntBot/dashboard/start-dashboard.sh
```

改用端口后，将本地技能 `settings.json` 的 `dashboard_url` 同步改为 `http://localhost:8421/dashboard.html`。

看板读取本地 CSV；筛选岗位和同步邮件仍由 Agent 执行。公开仓库不包含真实申请数据。

### 按需安排定时任务

初始化后的自动化配置为空。可向支持定时任务的 Codex 请求创建，例如每天 **18:00** 同步 Gmail、**20:00** 预筛岗位，时间与时区由你指定；这些只是示例，默认均未启用。

> 按北京时间每天 20:00 使用这个工作区预筛官网岗位，每天 18:00 只读同步已有申请的 Gmail 结果。复用同用途的现有任务，不重复创建。

创建后的实际任务 ID 可记录在技能 `settings.json` 的 `automation_ids` 中（`screen` / `gmail`）。定时预筛不自动授权后续申请或最终提交。

## 数据与隐私

`.gitignore` 排除了个人配置、技能本地设置、运行 CSV、邮箱状态、材料、报告、常见凭据和缓存。`JobHuntBot/templates/` 中只保留可复制的空白模板。

公开分享时检查 Git 的暂存文件与历史；忽略规则不会移除已经跟踪或提交过的内容。不要强制加入私人文件，也不要将整个工作目录打包后直接上传。Gmail 同步只保留必要状态，不发送邮件、不下载附件，也不从结果邮件进入申请流程。

## 项目结构与检查

```text
JobHuntBot/
  skills/jobhunt-assistant/  技能入口与按场景加载的参考
  references/               选岗、申请和结果同步流程
  templates/                空白个人配置与 CSV 模板
  dashboard/                本地看板代码与使用者运行数据
scripts/
  setup.py                  不覆盖已有文件的初始化器
  test_setup.py             临时目录中的初始化与隔离检查
```

```sh
python3 -m unittest discover -s scripts -p 'test_*.py'
node --test JobHuntBot/dashboard/*.test.js
python3 JobHuntBot/skills/jobhunt-assistant/scripts/inspect_context.py --mode dashboard
```

检查器只读取输入文件和结构；添加 `--check-dashboard` 可核对正在运行的本地接口。检查通过不等于岗位已筛选或申请已提交。

采用 [MIT 许可证](LICENSE)。
