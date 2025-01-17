SHELL := bash

help:
	@echo 'Please see the makefile for available targets.'

###
# Backend targets
###

build-backend: venv
	@source venv/bin/activate \
		&& pushd backend \
		&& PRESTIGE_SECRET_KEY=unused PRESTIGE_CORS_ORIGINS= DATABASE_URL='sqlite://:memory:' python manage.py collectstatic

serve-backend: venv
	@source venv/bin/activate \
		&& cd backend \
		&& set -o allexport \
		&& source env.sh \
		&& PYTHONUTF8=1 python manage.py runserver 127.0.0.1:3041

changepassword: venv
	@source venv/bin/activate \
		&& cd backend \
		&& set -o allexport \
		&& source env.sh \
		&& PYTHONUTF8=1 python manage.py changepassword "$$(read -e -r -p 'Email: '; echo $$REPLY)"

lint-backend: venv/bin/flake8
	@source venv/bin/activate \
		&& cd backend \
		&& flake8 . --extend-exclude venv --select=E9,F63,F7,F82 --show-source --statistics

test-backend: venv
	@source venv/bin/activate \
		&& cd backend \
		&& PRESTIGE_UNIVERSE=test \
			python manage.py test

makemigrations migrate: venv
	@source venv/bin/activate \
		&& cd backend \
		&& set -o allexport \
		&& source env.sh \
		&& python manage.py $@

venv/bin/flake8: | venv
	@source venv/bin/activate && pip install flake8

###
# Frontend targets
###

build-frontend: frontend/node_modules
	@cd frontend && NODE_ENV=production PRESTIGE_BACKEND=$${PRESTIGE_BACKEND:-/api} \
		npx parcel build src/index.html --dist-dir dist --no-autoinstall --no-source-maps --no-cache

serve-frontend: frontend/node_modules
	@cd frontend && NODE_ENV=development PRESTIGE_BACKEND=$${PRESTIGE_BACKEND:-/api} \
		npx parcel serve src/index.html --dist-dir dist-serve --port 3040

lint-frontend: frontend/node_modules
	@cd frontend && npx tsc --noEmit --project . && npx eslint --report-unused-disable-directives src

test-frontend: frontend/node_modules
	@cd frontend && npx jest

frontend/node_modules: frontend/node_modules/make_sentinel

frontend/node_modules/make_sentinel: frontend/package.json frontend/yarn.lock
	@if [[ frontend/package.json -nt frontend/yarn.lock ]]; then \
			cd frontend && yarn install; \
		else \
			cd frontend && yarn install --frozen-lockfile; \
		fi
	@touch $@

update-browserslist:
	@cd frontend && \
		npx browserslist@latest --update-db

###
# Documentation
###

serve-docs: venv
	@source venv/bin/activate \
		&& cd docs \
		&& PYTHONPATH=. mkdocs serve --dev-addr 127.0.0.1:3042

build-docs: venv
	@source venv/bin/activate \
		&& cd docs \
		&& PYTHONPATH=. mkdocs build

###
# End-to-end Testing
###

test-e2e: venv e2e-tests/drivers/chromedriver
	@rm -rf e2e-tests/shots
	@source venv/bin/activate \
		&& cd e2e-tests \
		&& python3 run.py

e2e-tests/drivers/chromedriver:
	@export CHROME_VERSION="$$((google-chrome --version || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --version) | cut -f 3 -d ' ' | cut -d '.' -f 1)" \
		&& VERSION="$$(curl --silent --location --fail --retry 3 http://chromedriver.storage.googleapis.com/LATEST_RELEASE_$$CHROME_VERSION)" \
		&& OS="$$(if [[ $$(uname -s) = Linux ]]; then echo linux64; else echo mac64; fi)" \
		&& wget -c -nc --retry-connrefused --tries=0 -O chromedriver.zip https://chromedriver.storage.googleapis.com/$$VERSION/chromedriver_$$OS.zip
	@unzip -o -q chromedriver.zip
	@mkdir -p $$(dirname $@)
	@mv chromedriver $@
	@rm chromedriver.zip

###
# Miscellaneous / Project-wide targets
###

serve-proxy:
	@python3 proxy.py

venv: venv/make_sentinel

venv/make_sentinel: requirements.txt
	test -d venv || python3 -m venv --prompt prestige venv
	source venv/bin/activate && pip install -r requirements.txt
	touch $@

test-all: lint-frontend test-frontend test-backend test-e2e

outdated:
	cd frontend && yarn outdated

tmux-session:
	tmux new-session -d -c $$PWD -s prestige -n backend make serve-backend
	tmux new-window -c $$PWD -t prestige: -n frontend make serve-frontend
	tmux new-window -c $$PWD -t prestige: -n docs make serve-docs
	tmux new-window -c $$PWD -t prestige: -n proxy make serve-proxy
	tmux set-option remain-on-exit on

netlify: build-frontend
	# Copy favicon to hashless filename for docs to show the favicon.
	cp frontend/dist/favicon.*.ico frontend/dist/favicon.ico
	python3 -m pip install -r requirements.txt
	cd backend \
		&& PRESTIGE_SECRET_KEY=unused PRESTIGE_CORS_ORIGINS= DATABASE_URL='sqlite://:memory:' \
		python manage.py collectstatic
	mv backend/static frontend/dist/
	cd docs && PYTHONPATH=. mkdocs build
	mv docs/site frontend/dist/docs
	du -sh frontend/dist || true

.PHONY: help serve-backend lint-backend test-backend build-frontend serve-frontend lint-frontend test-frontend test-e2e test-all venv
