# mod 长期结构

部署时执行: `node mod/inject.mjs`

- modules/ → 复制到 src/mod/
- assets/adminPage.html → 整文件覆盖 src/views/adminPage.html
- inject.mjs 对上游文件打锚点补丁

覆盖本目录到仓库根目录的 mod/ 即可。
