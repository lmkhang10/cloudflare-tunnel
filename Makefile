# Cloudflare Tunnel Kit — shortcuts dễ nhớ
.DEFAULT_GOAL := help

NPM ?= npm
CLI := node dist/cli/main.js
URL ?= http://127.0.0.1:8000
NAME ?= my-project
HOSTNAME ?=

.PHONY: help setup global build test init doctor ui quick create start stop status

help: ## Xem các lệnh
	@printf "Cloudflare Tunnel Kit\n\n"
  @printf "  make setup              Cài dependency và build\n"
  @printf "  make global             Cài CLI global (cf-tunnel và cftunnel)\n"
	@printf "  make init               Wizard text-only\n"
	@printf "  make ui                 Mở live UI local\n"
	@printf "  make quick URL=...      Preview quick tunnel\n"
	@printf "  make create NAME=...    Preview named tunnel\n"
	@printf "  make doctor             Kiểm tra môi trường\n"
	@printf "  make test               Chạy test\n"

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

quick: build ## Preview quick tunnel
	$(CLI) quick --url "$(URL)" --dry-run

create: build ## Preview named tunnel
	$(CLI) create --url "$(URL)" --name "$(NAME)" $(if $(HOSTNAME),--hostname "$(HOSTNAME)") --dry-run

start: build ## Start named tunnel
	$(CLI) start --name "$(NAME)"

stop: build ## Stop named tunnel
	$(CLI) stop --name "$(NAME)"

status: build ## Xem trạng thái named tunnel
	$(CLI) status --name "$(NAME)"
