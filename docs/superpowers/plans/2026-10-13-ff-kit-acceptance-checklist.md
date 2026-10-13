# ff-kit — Checklist nghiệm thu

Dùng checklist này để review checkout ff-kit trên máy/workspace thử nghiệm riêng. Không chạy trong Tiniweb và không dùng secret hoặc tài khoản production.

## 0. Trạng thái hiện tại

- [x] Theo roadmap: P1–P4 đã triển khai; P5 local acceptance đã được ghi nhận hoàn tất.
- [x] Kiểm tra mới trong checkout hiện tại: full suite 204 tests (203 pass, 1 skip, 0 fail); worker suite 29 pass; build và `git diff --check` pass.
- [x] `ff-worker@0.1.0` tarball cài được vào thư mục tạm và `npx --package=<tarball> ff-worker --help` in đúng help.
- [ ] Claude Code interactive smoke chưa làm; `/ff-init` chưa được chạy thực tế trên máy khác.
- [ ] `ff-worker` chưa publish npm. Vì `ff worker start` gọi `npx ff-worker@<version>`, full worker acceptance qua lệnh này chưa thể đạt trước khi package có ở registry mà máy thử dùng được.

## Chạy smoke test trước khi public

Các bước dưới đây dùng fixture trong `/private/tmp`; không chạy trên Tiniweb. Cần checkout ff-kit hiện tại trên máy test. Repo hiện còn thay đổi chưa commit, vì vậy máy khác phải nhận đúng working tree này (copy checkout hoặc commit/push trước). Thay `KIT` bằng đường dẫn checkout trên máy đang thử và dùng một đường dẫn `SMOKE` mới nếu fixture cũ đã tồn tại.

### A. Dựng workspace fixture

```sh
export KIT="/Users/cafrotos/Workspaces/ff-kit"
export SMOKE="/private/tmp/ff-kit-smoke"
export npm_config_cache="$SMOKE/.npm-cache"
mkdir -p "$SMOKE/web" "$SMOKE/ff-e2e" "$SMOKE/trellocards" "$SMOKE/worktrees"
cat > "$SMOKE/CLAUDE.md" <<'EOF'
# ff-kit smoke workspace
Đây là workspace giả để nghiệm thu ff-kit. Không kết nối dịch vụ production.
EOF
cd "$SMOKE/web"
git init -b main
git config user.name "ff-kit smoke"
git config user.email "ff-kit-smoke@example.invalid"
cat > package.json <<'EOF'
{"name":"ff-kit-smoke-web","version":"1.0.0","scripts":{"build":"node -e \"console.log('build ok')\"","test":"node -e \"console.log('test ok')\""}}
EOF
git add package.json
git commit -m "Create smoke fixture"
```

`ff-e2e/` cần tồn tại trước `/ff-init` theo tiền điều kiện trong skill; để rỗng ở bước này. Repo fixture có nhánh `main`; khi init hỏi nhánh, chọn `main` cho base/ship. Chọn không cấu hình task source/worker và auth `none` nếu các câu hỏi đó xuất hiện. Không tự bịa URL app; nếu init bắt buộc URL nhưng fixture không có app, dừng và ghi lại câu hỏi/lỗi đó.

### B. Nạp plugin local và chạy `/ff-init`

```sh
cd "$SMOKE"
claude --plugin-dir "$KIT"
```

- [ ] Trong Claude, xác nhận `/ff-init`, `/ff-understand`, `/ff-build`, `/ff-verify` và `/ff-worker` hiện ra.
- [ ] Chạy `/ff-init`, trả lời chỉ theo fixture. Nó phải tạo `ff.config.yaml`, lock, `.ff.env.example`, cập nhật hướng dẫn và báo cáo; không bật worker.
- [ ] Rà diff trong `$SMOKE`; chỉ chấp nhận thay đổi ở fixture. Xác nhận không có secret và không có đường dẫn Tiniweb.
- [ ] Nếu báo `ff: command not found`, ghi smoke plugin là **chưa đạt**. Để tiếp tục chẩn đoán CLI riêng, thoát và mở phiên tạm bằng `PATH="$KIT/bin:$PATH" claude --plugin-dir "$KIT"`; PATH injection chỉ là workaround local, không tính là chứng minh máy khác cài xong dùng được.

### C. Dựng e2e và kiểm tra CLI

Sau khi `/ff-init` đã tạo config:

```sh
cd "$SMOKE"
"$KIT/bin/ff" doctor
"$KIT/bin/ff" e2e-scaffold --dir ff-e2e
cd "$SMOKE/ff-e2e"
npx playwright test --list
```

`e2e-scaffold` chạy `npm install` và tải dependency. Không chạy `npx playwright install chromium` trừ khi muốn tải browser; doctor có thể tiếp tục báo nhóm e2e đỏ vì thiếu browser. Nhóm core phải xanh. Worker có thể đỏ vì không cấu hình adapter/credential; đó là kỳ vọng của fixture.

### D. Chạy `npx` với package tarball local

```sh
cd "$KIT/ff-worker"
npm run build
npm pack --pack-destination "$SMOKE" --cache "$npm_config_cache"
npx --yes --cache "$npm_config_cache" --package="$SMOKE/ff-worker-0.1.0.tgz" ff-worker --help
```

Kỳ vọng: in `Dùng: ff-worker --config <ff.config.yaml>`. Đây là smoke test package đã đóng gói và entrypoint qua `npx`; nó không truy cập npm registry. Tarball smoke đã được xác nhận chạy trong checkout hiện tại.

### E. Giới hạn trước khi public

`/ff-worker start` khởi chạy supervisor, và supervisor gọi chính xác `npx ff-worker@<version>`. Vì vậy tarball local ở bước D không kiểm tra được luồng supervisor này. Muốn nghiệm thu trọn worker **trước khi public**, cần một registry thử nghiệm/private registry hoặc bổ sung cơ chế test-only cho supervisor nhận package tarball; chưa có sẵn trong repo. Không đánh dấu worker end-to-end đạt chỉ dựa trên `--help`.

## 1. Chuẩn bị bản thử

- [ ] Lấy checkout ff-kit sạch trên máy thử nghiệm; ghi lại commit SHA và `git status`.
- [ ] Xác nhận checkout có `.claude-plugin/plugin.json`, `hooks/hooks.json`, `skills/`, `agents/`, `commands/`, `bin/ff` và bundle `dist/`.
- [ ] Xác nhận không có thay đổi nào được thực hiện trong Tiniweb.
- [ ] Cài đúng phiên bản Node.js tối thiểu trong `package.json`; kiểm tra `node --version`, `claude --version` và `tmux -V` nếu thử worker.
- [ ] Dùng workspace fixture mới, chứa hai repo Git giả hoặc repo thử có thể bỏ đi. Không dùng repo dự án thật.
- [ ] Không đưa secret thật vào fixture. Adapter `console` đủ cho kiểm tra worker cơ bản.

## 2. Kiểm tra gói plugin và CLI

- [ ] Cài dependency phát triển trong checkout, chạy `npm test` và `npm run build`.
- Kỳ vọng: test pass theo suite hiện tại; có thể có một test Playwright skip nếu dependency Playwright chưa được cài ở checkout.
- [ ] Chạy `./bin/ff help`.
- Kỳ vọng: hiện help tiếng Việt và các lệnh dự kiến; không lỗi thiếu module.
- [ ] Kiểm tra `dist/` được build từ source hiện tại và không còn bundle cũ.
- [ ] Build và pack `ff-worker`; cài/chạy CLI từ tarball trong thư mục tạm, ví dụ `npm exec --yes --package /đường/dẫn/ff-worker-0.1.0.tgz -- ff-worker --help`.
- Kỳ vọng: package tarball chứa bundle runtime và README; lệnh `ff-worker` chạy được từ package đã pack, không dựa vào source checkout.
- [ ] Chạy Claude Code với plugin local từ checkout, ví dụ `claude --plugin-dir /đường/dẫn/tuyệt/đối/ff-kit`.
- [ ] Trong phiên Claude mới, xác nhận các skill `/ff-init`, `/ff-understand`, `/ff-build`, `/ff-verify`, command `/ff-worker` và hook được nhận diện.
- [ ] Thoát phiên, mở lại một lần để xác nhận plugin vẫn nạp được từ cùng checkout.

## 3. Kiểm tra khởi tạo workspace fixture

- [ ] Làm theo `INSTALL.md` trong fixture; tạo `CLAUDE.md` và bộ e2e hoặc chọn bộ e2e fixture có sẵn.
- [ ] Gọi `/ff-init`; cung cấp lựa chọn cho các giá trị fixture còn mơ hồ.
- [ ] Hoàn tất `/ff-init` trên workspace fixture mới, sau đó chạy `ff doctor` và rà toàn bộ diff do init tạo. Chỉ kiểm tra file tĩnh hoặc test fixture không thay cho bước interactive này.
- [ ] Xem diff các file mà init tạo/sửa: `ff.config.yaml`, lock, `.ff.env.example`, `CLAUDE.md`, `.claude/settings.json`, `.gitignore`.
- [ ] Xác nhận config chỉ chứa giá trị có nguồn hoặc được user chọn; không có path/branch/lệnh đặc thù Tiniweb.
- [ ] Xác nhận `.ff.env.example` chỉ có key rỗng và hướng dẫn; không có credential.
- [ ] Xác nhận `/ff-init` không đọc/in `.ff.env`, không bật worker, không sửa file ngoài fixture.
- [ ] Chạy `./bin/ff doctor` trong fixture.
- Kỳ vọng: nhóm core xanh; worker/e2e có thể báo thiếu dependency/key tương ứng nhưng không làm hỏng lệnh core.
- [ ] Thử config sai trong fixture riêng; xác nhận doctor báo lỗi rõ ràng và `ff cfg get` không tiếp tục với core config đỏ.

## 4. Kiểm tra workflow và Gate

- [ ] Tạo task giả trong `cards_dir`; chạy `/ff-understand` và xác nhận dossier/ledger có nguồn gốc rõ ràng.
- [ ] Đi qua Gate A bằng câu hỏi `AskUserQuestion`; chọn `Cần sửa` trước, xác nhận task chưa được ghi nhận duyệt.
- [ ] Chỉnh nội dung rồi duyệt Gate A; xác nhận bản ghi Gate được tạo trong `.ff/gates/` và marker phản ánh trạng thái.
- [ ] Sửa artifact sau khi duyệt; xác nhận hash không còn khớp và trạng thái trở về chưa duyệt.
- [ ] Thử ghi trực tiếp vào `.ff/` bằng thao tác bị guard quản lý; xác nhận guard chặn.
- [ ] Thử `ff ship-approve` và `ff relock` trong fixture; xác nhận cần xác nhận người dùng, không được approve chỉ vì agent gọi lệnh.
- [ ] Thử hỏi Gate trong các mode quyền Claude dự định hỗ trợ; ghi lại phiên bản Claude, mode, payload hook và kết quả. Nếu hook không nhận câu trả lời hoặc không chặn được, ghi rõ giới hạn và mở issue trước khi coi Gate smoke đạt.
- [ ] Không thực hiện push, ship, migration hoặc gọi dịch vụ ngoài trong fixture.

## 5. Kiểm tra e2e trong fixture

- [ ] Chạy `ff e2e-scaffold` vào thư mục rỗng; xác nhận file template được tạo và không có `.git` lồng bên trong.
- [ ] Chạy lại vào thư mục đã có nội dung; xác nhận lệnh từ chối ghi đè và giữ nguyên file.
- [ ] Nếu Playwright có sẵn, chạy `npx playwright test --list` trong bộ e2e fixture.
- [ ] Chạy `ff doctor`; xác nhận thiếu Playwright/auth được xếp vào nhóm e2e, không làm đỏ core.
- [ ] Không cài browser hoặc tải dependency ngoài nếu chưa chủ động cho phép trên máy thử.

## 6. Kiểm tra worker tùy chọn

- [ ] Chỉ làm phần này nếu máy thử có `tmux`; dùng channel `console` và Trello test board riêng với credential tạm. Không nối Trello/Rocket.Chat production.
- [ ] Xác nhận package `ff-worker@<version>` mà `ff worker start` yêu cầu đã có trong registry cấu hình cho máy thử; tarball smoke ở bước 2 chỉ xác nhận artifact chạy, không chứng minh `npx ff-worker@<version>` tải được.
- [ ] Nếu chưa publish, không đánh dấu worker end-to-end đạt. Sau khi user duyệt phát hành, publish bản thử/prerelease vào registry thử nghiệm (hoặc package version dành riêng cho nghiệm thu), rồi xác minh `npx ff-worker@<version> --help` tải và chạy được trên máy sạch.
- [ ] Dùng workspace fixture có Trello test board và credential tạm để chạy `/ff-worker start` qua supervisor/npx; xác nhận trạng thái ready, poll được nguồn task thử, rồi dừng worker. Không dùng board hoặc credential production.
- [ ] Chạy `/ff-worker start`; xác nhận doctor gate, session tmux đúng tên, trạng thái ready và báo đủ thông tin vận hành.
- [ ] Chạy `ff worker status` và `ff worker logs`; xác nhận không lộ token/secret.
- [ ] Xác nhận HTTP chỉ bind `127.0.0.1`, endpoint từ chối request thiếu/sai bearer token và chấp nhận token hợp lệ.
- [ ] Sửa config hợp lệ; xác nhận worker reload/restart theo thiết kế và giữ task state.
- [ ] Thử config không hợp lệ; xác nhận config đang chạy được giữ nguyên và có thông báo lỗi.
- [ ] Chạy `/ff-worker stop`; xác nhận chỉ session worker của fixture dừng, không kill session khác.
- [ ] Xác nhận file `.ff/worker.json` có quyền hạn chế phù hợp và không đưa token vào log/output.

## 7. Kiểm tra đóng gói và tính tổng quát

- [ ] Chạy `npm pack --dry-run` trong `ff-worker/`; kiểm tra danh sách file chỉ gồm artefact runtime cần phát hành.
- [ ] Rà skills, agents, commands, hooks và config để tìm path, branch, lệnh hoặc tên riêng của Tiniweb.
- [ ] Xác nhận README/INSTALL mô tả rõ dependency tùy chọn, cách cấu hình worker và cách cập nhật.
- [ ] Ghi các lỗi, ảnh chụp/log đã lọc secret, phiên bản Node/Claude và commit SHA vào báo cáo nghiệm thu.
- [ ] Dọn fixture và worker do chính lượt test tạo ra; không xóa dữ liệu người dùng hoặc session không thuộc fixture.

## Điều kiện đạt

- [ ] Plugin local nạp được trên máy khác; CLI và hook chạy từ bundle đã build.
- [ ] `/ff-init` tạo workspace fixture hợp lệ, không lộ secret và không tự bật worker.
- [ ] Gate A/B/C chỉ được ghi nhận qua luồng người dùng; sửa artifact làm mất hiệu lực hash duyệt.
- [ ] Guard chặn các thao tác bị cấm; lệnh nhạy cảm vẫn đòi user xác nhận.
- [ ] E2E scaffold không ghi đè; doctor phân nhóm lỗi đúng.
- [ ] Nếu nghiệm thu worker: package đã được lấy qua đúng registry bằng `npx`, lifecycle qua `/ff-worker start`, loopback auth, reload và stop đều đạt trong fixture.
- [ ] Không có thay đổi nào trong Tiniweb; mọi lỗi nghiệm thu có ghi lại và được xử lý hoặc chấp nhận rõ ràng.

## Sau nghiệm thu

- [ ] Review diff cuối và quyết định commit/tag bản ff-kit.
- [ ] Dry-run/tarball smoke không thay cho kiểm tra `npx ff-worker@<version>` qua registry. Publish prerelease/package lên registry thử nghiệm trước; chỉ publish bản chính thức sau review và quyết định phát hành.
- [ ] Local `--plugin-dir` chứng minh checkout plugin nạp được; nếu muốn cài plugin cho máy khác qua marketplace thì cần kiểm tra riêng quy trình phân phối marketplace.
