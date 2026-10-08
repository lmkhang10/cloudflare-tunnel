# Cloudflare Tunnel Kit — shortcuts dễ nhớ
.DEFAULT_GOAL := help

NPM ?= npm
CLI := node dist/cli/main.js
URL ?= http://127.0.0.1:8000
NAME ?= my-project
HOSTNAME ?=
PROJECT ?=
BUMP ?= patch

.PHONY: help setup global build test init doctor ui tray daemon daemon-stop autostart quick create start stop status npm-login publish-check publish release

help: ## Xem các lệnh
	@printf "Cloudflare Tunnel Kit\n\n"
	@printf "  make setup              Cài dependency và build\n"
	@printf "  make global             Cài CLI global (cf-tunnel và cftunnel)\n"
	@printf "  make init               Wizard text-only\n"
	@printf "  make ui                 Mở live UI (chạy ngầm qua background service)\n"
	@printf "  make tray               Cài/chạy app menu bar (Electron)\n"
	@printf "  make daemon             Bật background service (daemon-stop để tắt)\n"
	@printf "  make autostart          Bật chạy cùng hệ thống (macOS launchd)\n"
	@printf "  make quick URL=...      Preview quick tunnel\n"
	@printf "  make create NAME=...    Preview named tunnel\n"
	@printf "  make doctor             Kiểm tra môi trường\n"
	@printf "  make test               Chạy test\n"
	@printf "  make start PROJECT=id    Start project đã lưu (stop/status tương tự)\n"
	@printf "\nPublish npm:\n"
	@printf "  make npm-login           Đăng nhập npm (npm login)\n"
	@printf "  make publish-check       Test + xem trước nội dung package (dry-run)\n"
	@printf "  make publish             Publish version hiện tại lên npm\n"
	@printf "  make release [BUMP=patch|minor|major]  Bump version, publish, push tag\n"

setup: ## Cài dependency và build
	$(NPM) install
	$(NPM) run build

global: build ## Đóng gói và cài CLI global từ source hiện tại
	$(NPM) pack
	$(NPM) install --global ./cloudflare-tunnel-kit-$(shell node -p "require('./package.json').version").tgz

build: ## Build package
	$(NPM) run build

test: ## Chạy test
	$(NPM) test

init: build ## Mở wizard text-only
	$(CLI) init

doctor: build ## Kiểm tra môi trường
	$(CLI) doctor

ui: build ## Chạy live UI trên localhost
	$(CLI) ui

tray: build ## Cài/chạy app menu bar
	$(CLI) tray

daemon: build ## Bật background service
	$(CLI) daemon start

daemon-stop: build ## Tắt background service và mọi tunnel
	$(CLI) daemon stop

autostart: build ## Bật chạy cùng hệ thống (macOS)
	$(CLI) autostart enable

quick: build ## Preview quick tunnel
	$(CLI) quick --url "$(URL)" --dry-run

create: build ## Preview named tunnel
	$(CLI) create --url "$(URL)" --name "$(NAME)" $(if $(HOSTNAME),--hostname "$(HOSTNAME)") --dry-run

start: build ## Start project đã lưu
	$(CLI) start --project "$(PROJECT)"

stop: build ## Stop project đã lưu
	$(CLI) stop --project "$(PROJECT)"

status: build ## Xem trạng thái project đã lưu
	$(CLI) status --project "$(PROJECT)"

npm-login: ## Đăng nhập npm
	$(NPM) login

publish-check: test ## Test + xem trước package sẽ publish
	@$(NPM) whoami >/dev/null || (echo "Chưa đăng nhập npm. Chạy: make npm-login" && exit 1)
	$(NPM) pack --dry-run

publish: publish-check ## Publish version hiện tại lên npm
	@test -z "$$(git status --porcelain)" || (echo "Working tree chưa sạch, commit trước khi publish." && exit 1)
	$(NPM) publish --access public

release: ## Bump version (BUMP=patch|minor|major), publish, push commit + tag
	@test -z "$$(git status --porcelain)" || (echo "Working tree chưa sạch, commit trước khi release." && exit 1)
	$(MAKE) publish-check
	$(NPM) version $(BUMP) -m "chore: bump version to %s"
	$(NPM) publish --access public
	git push --follow-tags
