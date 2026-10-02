# 本地岗位看板

默认入口为 [打开岗位看板](http://localhost:8420/dashboard.html)，实际地址以本地设置为准。首次使用先运行仓库根目录的 `python3 scripts/setup.py` 创建空白数据，再按 `J/dashboard/看板使用说明.md` 启动看板。

## 浏览和选岗

复用同一工作区的数据，不另建数据库。查看今日新增、全部机会、P1、收藏或按城市/公司/状态筛选。今日新增指发现日期，不等同于发布日期。收藏仅存在当前浏览器 localStorage，不表示晋升或申请批准。

用户继续处理某个预备岗位时使用其明确提供的 lead_id，再进入申请模式。页面定期读取最新文件，刷新不会执行新的找岗扫描。

## 检查服务

可运行技能检查器 `--mode dashboard --check-dashboard --check-schedules`，或只读 GET 本工作区看板的 `/api/overview`。检查 datasets 的 preliminary/jobs/daily/followUp 数组、对应 sources 文件名、generatedAt、today、schedules 和 warnings，并与当前本地数据比较。

请求被工具权限限制时只说明无法访问，不能据此断定服务已停止。自动化 ACTIVE 仅代表启用，实际执行结果看数据更新时间和摘要。未配置自动化时 schedules 为空是正常状态。

本包启动器只在前台启动本地服务，不安装登录启动项，不接管其他工作区服务。端口冲突时不要关闭已有程序或将其误认作本工作区；按使用说明选择空闲端口。用户只是查看同步结果时给链接即可，不擅自启动网站或弹浏览器。

## 维护

`dashboard-data.js` 聚合本地数据和显式绑定的任务元数据；`dashboard-model.js` 计算视图；`dashboard-ui.js`/`dashboard.css` 渲染；`server.js` 提供本地接口。

现有写接口用于结果状态和日历，不是晋升或自动申请接口。只读健康检查不能调用写接口。修改网站后，在 J 下运行 `node --test dashboard/dashboard-model.test.js dashboard/dashboard-data.test.js`；界面改动应额外做浏览器核验。

本服务仅供本机使用，公开仓库不等于公开托管个人数据。不要把运行时 CSV、邮件跟进或个人材料部署到公网。
