default:
    @just --list

install:
    npm install

run:
    npm run dev

test:
    npm test

test-watch:
    npm run test:watch

check:
    npm run check

build:
    npm run build

run-app:
    npm run tauri:dev

build-app:
    npm run tauri:build
